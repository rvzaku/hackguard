"""Propensity-model training pipeline (WS-A).

Trains the payer-recovery propensity model on Lending Club loan-level
outcomes and writes a versioned artifact + metrics + eval report:

    <out>/
        model.json        XGBoost booster (native JSON, feature names pinned)
        meta.json         version, features, base rate, data provenance, params
        metrics.json      held-out AUC / PR-AUC / Brier / ECE / calibration
                          curve / baseline comparison (constant + simple rules)
        eval_report.md    human-readable evaluation report

Usage (from services/scoring, via scripts/train-model.sh):
    uv run python ../../models/propensity/train.py \
        [--sample N] [--full-data] [--out DIR] [--version ID] [--seed S]

Data: Lending Club public loan file 2007-2011 (LoanStats3a.csv.zip,
sha256 pinned — see docs/DATA.md). Downloaded once into models/.cache/
(override the cache dir with SCORING_LC_CACHE, or point at a local copy
with SCORING_LC_DATA_PATH).

Labels (docs/MODEL.md): the cohort is every loan that went delinquent at
least once post-issuance (mths_since_last_delinq present OR late fees
accrued). Label 1 ("cured") = loan later reached Fully Paid; label 0 = the
loan charged off. This is the payer-recovery analogy: among payers who fell
behind, who recovered versus never recovered.

Determinism: fixed seed everywhere, hist tree method, single-deterministic
thread config; a given (sample size, seed) reproduces byte-identical
metrics.json apart from `trainedAt`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "services" / "scoring" / "src"))

import numpy as np
import pandas as pd
import xgboost as xgb

from scoring.preprocessing import FEATURE_NAMES, IMPUTED_MEDIANS

DATA_URL = "https://resources.lendingclub.com/LoanStats3a.csv.zip"
DATA_SHA256 = "9af5ac078f1a22879ed026fb5ba394c9f76badd917e97b6d9ec59f34f535db69"
DEFAULT_VERSION = "propensity-v1.0.0"
DEFAULT_CACHE = REPO_ROOT / "models" / ".cache"

PARAMS: dict[str, object] = {
    "objective": "binary:logistic",
    "eval_metric": ["logloss", "auc", "aucpr"],
    "tree_method": "hist",
    "max_depth": 4,
    "eta": 0.1,
    "min_child_weight": 5.0,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "lambda": 1.0,
}
NUM_BOOST_ROUND = 400
EARLY_STOPPING_ROUNDS = 30


# --------------------------------------------------------------------------
# Data acquisition + preparation
# --------------------------------------------------------------------------

def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_data(cache_dir: Path) -> Path:
    """Return a verified LoanStats3a.csv, downloading if needed."""
    override = os.environ.get("SCORING_LC_DATA_PATH")
    if override:
        csv_path = Path(override)
        if _sha256(csv_path) != DATA_SHA256:
            raise SystemExit(f"SCORING_LC_DATA_PATH file fails sha256 pin: {csv_path}")
        return csv_path

    cache_dir.mkdir(parents=True, exist_ok=True)
    csv_path = cache_dir / "LoanStats3a.csv"
    if csv_path.is_file() and _sha256(csv_path) == DATA_SHA256:
        return csv_path
    zip_path = cache_dir / "LoanStats3a.csv.zip"
    print(f"downloading {DATA_URL} ...")
    urllib.request.urlretrieve(DATA_URL, zip_path)  # noqa: S310 - pinned URL
    with zipfile.ZipFile(zip_path) as zf:
        zf.extract("LoanStats3a.csv", cache_dir)
    zip_path.unlink()
    if _sha256(csv_path) != DATA_SHA256:
        csv_path.unlink(missing_ok=True)
        raise SystemExit("downloaded LoanStats3a.csv fails sha256 pin — refusing to use")
    return csv_path


def _emp_length_to_years(v: object) -> float | None:
    if not isinstance(v, str):
        return None
    v = v.strip()
    if v in ("", "n/a"):
        return None
    if v.startswith("<"):
        return 0.5
    m = re.match(r"(\d+)", v)
    return float(m.group(1)) if m else None


def load_cohort(csv_path: Path) -> pd.DataFrame:
    """Build the delinquent cohort with recovery labels and model features.

    Cohort: loans with post-issuance delinquency evidence (mths_since_last_
    delinq present or late fees > 0) AND a terminal status (Fully Paid /
    Charged Off, incl. the 2007-2011 'does not meet credit policy' variants).
    Label: 1 = cured (Fully Paid), 0 = never recovered (Charged Off).
    """
    df = pd.read_csv(csv_path, skiprows=1, low_memory=False)
    df = df[df["loan_amnt"].notna()].copy()

    delinquent = df["mths_since_last_delinq"].notna() | (
        pd.to_numeric(df["total_rec_late_fee"], errors="coerce").fillna(0) > 0
    )
    terminal = df["loan_status"].isin(
        [
            "Fully Paid",
            "Charged Off",
            "Does not meet the credit policy. Status:Fully Paid",
            "Does not meet the credit policy. Status:Charged Off",
        ]
    )
    coh = df[delinquent & terminal].copy()
    coh["label"] = coh["loan_status"].str.contains("Fully Paid").astype(int)

    coh["amount_log"] = np.log1p(coh["loan_amnt"].astype(float))
    coh["int_rate"] = (
        pd.to_numeric(coh["int_rate"].astype(str).str.rstrip("%"), errors="coerce")
    )
    coh["term_months"] = (
        coh["term"].astype(str).str.extract(r"(\d+)")[0].astype(float)
    )
    coh["emp_length_years"] = coh["emp_length"].map(_emp_length_to_years)
    for col in ("dti", "delinq_2yrs", "inq_last_6mths", "open_acc", "total_acc"):
        coh[col] = pd.to_numeric(coh[col], errors="coerce")
    coh["revol_util"] = pd.to_numeric(
        coh["revol_util"].astype(str).str.rstrip("%"), errors="coerce"
    )
    return coh


def feature_matrix(coh: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Assemble the FEATURE_NAMES-ordered matrix, imputing training medians.

    Imputation uses the exact constants in scoring.preprocessing — the same
    constants the serving side uses — so train/serve imputation cannot drift.
    """
    cols = {
        "amount_log": coh["amount_log"],
        "int_rate": coh["int_rate"],
        "term_months": coh["term_months"],
        "emp_length_years": coh["emp_length_years"],
        "dti": coh["dti"],
        "delinq_2yrs": coh["delinq_2yrs"],
        "inq_last_6mths": coh["inq_last_6mths"],
        "revol_util": coh["revol_util"],
        "open_acc": coh["open_acc"],
        "total_acc": coh["total_acc"],
    }
    missing = [c for c in FEATURE_NAMES if c not in cols]
    if missing:
        raise SystemExit(f"feature assembly missing columns: {missing}")
    mat = np.column_stack([cols[c].to_numpy(dtype=np.float64) for c in FEATURE_NAMES])
    for j, name in enumerate(FEATURE_NAMES):
        med = IMPUTED_MEDIANS.get(name)
        if med is None:
            continue  # amount_log / int_rate are always observed
        nan_idx = np.isnan(mat[:, j])
        mat[nan_idx, j] = med
    return mat, coh["label"].to_numpy(dtype=np.int64)


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------

def roc_auc(y: np.ndarray, s: np.ndarray) -> float:
    """Rank-based AUC (handles ties via mid-ranks)."""
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(s) + 1)
    # average ranks within tie groups
    sorted_s = s[order]
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and sorted_s[j + 1] == sorted_s[i]:
            j += 1
        if j > i:
            ranks[order[i : j + 1]] = (i + j + 2) / 2.0
        i = j + 1
    pos = y == 1
    n_pos, n_neg = int(pos.sum()), int((~pos).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return float((ranks[pos].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def pr_auc(y: np.ndarray, s: np.ndarray) -> float:
    """Average precision (step-integrated precision-recall)."""
    order = np.argsort(-s, kind="mergesort")
    y_sorted = y[order]
    tp = np.cumsum(y_sorted)
    fp = np.cumsum(1 - y_sorted)
    precision = tp / np.maximum(tp + fp, 1)
    return float((precision * y_sorted).sum() / max(y.sum(), 1))


def calibration_curve(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> list[dict]:
    """Equal-width probability bins: mean predicted vs observed frequency."""
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins: list[dict] = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p < hi) if i < n_bins - 1 else (p >= lo) & (p <= hi)
        n = int(mask.sum())
        bins.append(
            {
                "binLow": round(float(lo), 3),
                "binHigh": round(float(hi), 3),
                "count": n,
                "meanPredicted": round(float(p[mask].mean()), 5) if n else None,
                "observedRate": round(float(y[mask].mean()), 5) if n else None,
            }
        )
    return bins


def expected_calibration_error(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float:
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p < hi) if i < n_bins - 1 else (p >= lo) & (p <= hi)
        n = int(mask.sum())
        if n:
            ece += (n / len(p)) * abs(float(p[mask].mean()) - float(y[mask].mean()))
    return round(ece, 5)


def brier(y: np.ndarray, p: np.ndarray) -> float:
    return round(float(np.mean((p - y) ** 2)), 5)


def evaluate(name: str, y: np.ndarray, s: np.ndarray, base_rate: float) -> dict:
    """Metrics for one scoring function on the held-out test set."""
    auc = roc_auc(y, s)
    if math.isnan(auc):
        auc = 0.5
    return {
        "name": name,
        "auc": round(auc, 4),
        "prAuc": round(pr_auc(y, s), 4),
        "brier": brier(y, s) if s.min() >= 0 and s.max() <= 1 else None,
        "liftVsConstantAuc": round(auc - 0.5, 4),
        "liftVsConstantPrAuc": round(pr_auc(y, s) - base_rate, 4),
    }


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=None, help="stratified subsample size (CI smoke mode)")
    ap.add_argument("--full-data", action="store_true", help="use the entire cohort (default)")
    ap.add_argument("--out", type=Path, default=None, help="output artifact dir")
    ap.add_argument("--version", default=DEFAULT_VERSION)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    out_dir: Path = args.out or (REPO_ROOT / "models" / "registry" / args.version)
    seed = args.seed
    rng = np.random.RandomState(seed)

    csv_path = ensure_data(Path(os.environ.get("SCORING_LC_CACHE", str(DEFAULT_CACHE))))
    coh = load_cohort(csv_path)
    n_full = len(coh)

    if args.sample is not None and not args.full_data:
        # stratified subsample, seeded — deterministic for a given (N, seed)
        parts = [
            g.sample(min(len(g), max(1, round(args.sample * len(g) / n_full))), random_state=seed)
            for _, g in coh.groupby("label")
        ]
        coh = pd.concat(parts).sample(frac=1.0, random_state=seed).reset_index(drop=True)
    print(f"cohort: {len(coh)} rows (of {n_full}), cure rate {coh['label'].mean():.4f}")

    X, y = feature_matrix(coh)

    # 60/20/20 train/val/test, stratified, seeded. Early stopping watches the
    # validation split only; the test split is touched exactly once.
    idx = rng.permutation(len(y))
    n_train = int(0.6 * len(y))
    n_val = int(0.2 * len(y))
    tr, va, te = idx[:n_train], idx[n_train : n_train + n_val], idx[n_train + n_val :]

    dtrain = xgb.DMatrix(X[tr], label=y[tr], feature_names=list(FEATURE_NAMES))
    dval = xgb.DMatrix(X[va], label=y[va], feature_names=list(FEATURE_NAMES))
    dtest = xgb.DMatrix(X[te], label=y[te], feature_names=list(FEATURE_NAMES))

    booster = xgb.train(
        {**PARAMS, "seed": seed},
        dtrain,
        num_boost_round=NUM_BOOST_ROUND,
        evals=[(dtrain, "train"), (dval, "val")],
        early_stopping_rounds=EARLY_STOPPING_ROUNDS,
        verbose_eval=False,
    )
    print(f"trained {booster.num_boosted_rounds()} rounds (best iter {booster.best_iteration})")

    p_test = booster.predict(dtest)
    y_test = y[te]
    base_rate = float(y_test.mean())

    # --- baselines: constant + simple deterministic rules -------------------
    fi = {name: i for i, name in enumerate(FEATURE_NAMES)}
    rules: dict[str, np.ndarray] = {
        "constant_base_rate": np.full(len(y_test), base_rate, dtype=np.float64),
        "rule_delinq_2yrs_eq_0": (X[te][:, fi["delinq_2yrs"]] == 0).astype(np.float64),
        "rule_int_rate_le_13": (X[te][:, fi["int_rate"]] <= 13.0).astype(np.float64),
        "rule_dti_le_15": (X[te][:, fi["dti"]] <= 15.0).astype(np.float64),
        "rule_sum_of_three": (
            (X[te][:, fi["delinq_2yrs"]] == 0).astype(np.float64)
            + (X[te][:, fi["int_rate"]] <= 13.0).astype(np.float64)
            + (X[te][:, fi["dti"]] <= 15.0).astype(np.float64)
        ),
    }
    baselines = [evaluate(name, y_test, s, base_rate) for name, s in rules.items()]
    model_eval = evaluate("xgboost_propensity_v1", y_test, p_test, base_rate)

    metrics = {
        "modelVersion": args.version,
        "trainedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "data": {
            "source": DATA_URL,
            "sha256": DATA_SHA256,
            "cohortRows": int(len(y)),
            "fullCohortRows": int(n_full),
            "sampleMode": args.sample if args.sample is not None and not args.full_data else None,
            "trainRows": int(len(tr)),
            "valRows": int(len(va)),
            "testRows": int(len(te)),
            "trainBaseRate": round(float(y[tr].mean()), 4),
            "testBaseRate": round(base_rate, 4),
        },
        "params": {**PARAMS, "num_boost_round": NUM_BOOST_ROUND,
                   "early_stopping_rounds": EARLY_STOPPING_ROUNDS,
                   "best_iteration": int(booster.best_iteration),
                   "seed": seed},
        "test": {
            "model": model_eval,
            "baselines": baselines,
            "calibrationCurve": calibration_curve(y_test, p_test),
            "expectedCalibrationError": expected_calibration_error(y_test, p_test),
        },
    }

    # --- write artifacts ----------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    booster.save_model(out_dir / "model.json")
    meta = {
        "version": args.version,
        "featureNames": list(FEATURE_NAMES),
        "baseRate": round(float(y[tr].mean()), 4),
        "trainedAt": metrics["trainedAt"],
        "dataSource": DATA_URL,
        "dataSha256": DATA_SHA256,
        "trainRows": int(len(tr)),
        "seed": seed,
        "params": metrics["params"],
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    (out_dir / "eval_report.md").write_text(render_report(metrics))
    print(f"artifacts written to {out_dir}")
    print(f"test AUC {model_eval['auc']}  PR-AUC {model_eval['prAuc']}  "
          f"ECE {metrics['test']['expectedCalibrationError']}")


def render_report(m: dict) -> str:
    """Human-readable evaluation report from the metrics dict."""
    d, t = m["data"], m["test"]
    model, base = t["model"], t["baselines"][0]
    lines = [
        f"# Eval report — {m['modelVersion']}",
        "",
        f"Trained {m['trainedAt']} | seed {m['params']['seed']} | "
        f"best iteration {m['params']['best_iteration']}",
        "",
        "## Data",
        f"- Source: {d['source']} (sha256 `{d['sha256'][:16]}...`)",
        f"- Delinquent cohort: {d['cohortRows']} rows"
        + (f" (sampled from {d['fullCohortRows']})" if d.get("sampleMode") else ""),
        f"- Split {d['trainRows']}/{d['valRows']}/{d['testRows']} (train/val/test, stratified)",
        f"- Test base rate (cured): {d['testBaseRate']}",
        "",
        "## Held-out test metrics",
        "",
        "| Scorer | AUC | PR-AUC | Brier | AUC lift vs constant |",
        "|---|---|---|---|---|",
    ]
    rows = [model] + t["baselines"]
    for r in rows:
        lines.append(
            f"| {r['name']} | {r['auc']} | {r['prAuc']} | "
            f"{r['brier'] if r['brier'] is not None else '—'} | "
            f"{r['liftVsConstantAuc']:+.4f} |"
        )
    lines += [
        "",
        f"Expected calibration error (10 bins): **{t['expectedCalibrationError']}**",
        "",
        "## Calibration curve (test)",
        "",
        "| Bin | Mean predicted | Observed rate | Count |",
        "|---|---|---|---|",
    ]
    for b in t["calibrationCurve"]:
        lines.append(
            f"| {b['binLow']:.1f}-{b['binHigh']:.1f} | "
            f"{b['meanPredicted'] if b['meanPredicted'] is not None else '—'} | "
            f"{b['observedRate'] if b['observedRate'] is not None else '—'} | "
            f"{b['count']} |"
        )
    lines += [
        "",
        "Baselines are simple deterministic rules on the same test split; "
        "the model's lift over them is the honest measure of added value. "
        "Methodology and limitations: docs/MODEL.md.",
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()

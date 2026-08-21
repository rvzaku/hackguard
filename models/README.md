# models/ — ML artifacts and training pipeline (WS-A)

## Layout

- `propensity/train.py` — one-file training pipeline (download → cohort →
  train → calibrate → evaluate vs baselines → write artifacts).
- `registry/propensity-v1.0.0/` — the **committed, pinned** model artifact:
  `model.json` (XGBoost booster), `meta.json` (version/features/provenance),
  `metrics.json` (held-out AUC/PR-AUC/Brier/ECE/calibration + baseline
  comparison), `eval_report.md` (human-readable report).
- `.cache/` — gitignored download cache for the training data.

## One-command reproduction

```bash
npm run model:train        # small-sample smoke train (CI mode) -> var/model-smoke
npm run model:train:full   # full cohort -> models/registry/propensity-v1.0.0
```

Both are seeded and deterministic: the full run reproduces the committed
artifact byte-for-byte (verified). Data download is SHA-256-pinned
(docs/DATA.md); override the cache with `SCORING_LC_CACHE` or supply a
local verified copy via `SCORING_LC_DATA_PATH`.

Methodology, feature mapping, and limitations: `docs/MODEL.md`.
Serving side: `services/scoring/src/scoring/` (registry loader, inference,
timing policy) — the feature mapping is shared code, so train/serve skew
is impossible by construction.

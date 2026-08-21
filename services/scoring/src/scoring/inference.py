"""Inference: propensity scoring + per-moment P(recover) + TreeSHAP values.

SHAP: TreeSHAP contributions are computed at request time via XGBoost's
native `pred_contribs` — the same algorithm shap.TreeExplainer runs for
XGBoost models (the shap library delegates to this code path). Values are
in margin (log-odds) space and sum to the model output margin, which matches
the shared contract's ShapContribution.description ("signed contribution to
P(recover) log-odds").
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import xgboost as xgb

from scoring.model_registry import ModelBundle
from scoring.policy import combine_p, timing_factor
from scoring.preprocessing import FEATURE_NAMES, payment_to_vector


def _sigmoid(x: float) -> float:
    # exp(-|x|) form: numerically stable for large |x|.
    if x >= 0:
        return 1.0 / (1.0 + float(np.exp(-x)))
    e = float(np.exp(x))
    return e / (1.0 + e)


def propensity_score(
    bundle: ModelBundle,
    amount_minor: int,
    decline_code: str,
    attempt: int,
    customer_tenure_days: int | None,
) -> tuple[float, np.ndarray]:
    """P(payer recovers | payment features) and the TreeSHAP matrix.

    Returns (propensity_probability, contributions) where contributions has
    shape (n_features + 1,): one log-odds contribution per feature plus the
    final bias term.
    """
    vector = payment_to_vector(amount_minor, decline_code, attempt, customer_tenure_days)
    dm = xgb.DMatrix(np.array([vector], dtype=np.float32), feature_names=list(FEATURE_NAMES))
    margin = float(bundle.booster.predict(dm, output_margin=True)[0])
    contribs = bundle.booster.predict(dm, pred_contribs=True)[0]
    return _sigmoid(margin), contribs


def top_shap(contribs: np.ndarray, k: int = 5) -> list[tuple[str, float]]:
    """Top-k (feature, contribution) pairs by absolute contribution.

    The trailing bias column of pred_contribs output is excluded.
    """
    feature_contribs = contribs[:-1]
    order = np.argsort(-np.abs(feature_contribs))[:k]
    return [(FEATURE_NAMES[i], float(feature_contribs[i])) for i in order]


def moment_recovery_prob(
    bundle: ModelBundle,
    propensity: float,
    attempt: int,
    scheduled_for: datetime,
    failure_ts: datetime,
    decline_code: str,
) -> tuple[float, float]:
    """(pRecover, timingFactor) for one candidate retry moment."""
    factor = timing_factor(attempt, scheduled_for, failure_ts, decline_code)
    return combine_p(propensity, factor), factor


def score_moments(
    bundle: ModelBundle,
    *,
    amount_minor: int,
    decline_code: str,
    attempt: int,
    customer_tenure_days: int | None,
    failure_ts: datetime,
    candidate_attempts: list[int],
    candidate_times: list[datetime],
) -> tuple[float, list[tuple[str, float]], list[float], list[float]]:
    """Score all candidate moments in one pass.

    Returns (propensity, shap_top5, p_recover_per_moment, timing_factors).
    """
    propensity, contribs = propensity_score(
        bundle, amount_minor, decline_code, attempt, customer_tenure_days
    )
    shap_top = top_shap(contribs, k=5)
    p_recover: list[float] = []
    factors: list[float] = []
    for mom_attempt, mom_time in zip(candidate_attempts, candidate_times, strict=True):
        p, f = moment_recovery_prob(
            bundle, propensity, mom_attempt, mom_time, failure_ts, decline_code
        )
        p_recover.append(p)
        factors.append(f)
    return propensity, shap_top, p_recover, factors

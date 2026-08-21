"""Inference tests: propensity + TreeSHAP + per-moment combination.

These run against the COMMITTED registry artifact (models/registry/
propensity-v1.0.0) — the same artifact the sidecar serves, pinned by version.
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from scoring import inference
from scoring.config import Settings
from scoring.model_registry import ModelBundle, ModelLoadError, get_bundle, load_bundle
from scoring.preprocessing import FEATURE_NAMES


@pytest.fixture(scope="module")
def bundle() -> ModelBundle:
    return get_bundle(Settings())


class TestRegistry:
    def test_pinned_version_loads(self, bundle: ModelBundle) -> None:
        assert bundle.version == "propensity-v1.0.0"
        assert list(bundle.meta.featureNames) == list(FEATURE_NAMES)

    def test_version_mismatch_rejected(self, tmp_path: Path) -> None:
        registry = Path(tmp_path) / "registry"
        registry.mkdir(parents=True)
        (registry / "other-version").mkdir()
        with pytest.raises(ModelLoadError):
            load_bundle(registry, "other-version")

    def test_missing_artifact_rejected(self, tmp_path: Path) -> None:
        with pytest.raises(ModelLoadError):
            load_bundle(Path(tmp_path), "does-not-exist")


class TestPropensity:
    def test_probability_in_range_and_deterministic(self, bundle: ModelBundle) -> None:
        kwargs = dict(amount_minor=4900, decline_code="insufficient_funds", attempt=1)
        p1, c1 = inference.propensity_score(bundle, customer_tenure_days=1460, **kwargs)  # type: ignore[arg-type]
        p2, c2 = inference.propensity_score(bundle, customer_tenure_days=1460, **kwargs)  # type: ignore[arg-type]
        assert 0.0 < p1 < 1.0
        assert p1 == p2
        assert np.allclose(c1, c2)

    def test_hard_decline_scores_lower_than_soft(self, bundle: ModelBundle) -> None:
        soft, _ = inference.propensity_score(
            bundle,
            amount_minor=4900,
            decline_code="insufficient_funds",
            attempt=1,
            customer_tenure_days=1460,
        )
        hard, _ = inference.propensity_score(
            bundle,
            amount_minor=4900,
            decline_code="stolen_card",
            attempt=1,
            customer_tenure_days=1460,
        )
        assert hard < soft

    def test_repeat_failure_proxy_is_negligible(self, bundle: ModelBundle) -> None:
        """The attempt->delinq_2yrs proxy carries almost no propensity signal.

        In the Lending Club cohort, delinq_2yrs was near-uninformative for
        cure (single-rule AUC 0.496, see metrics.json baselines), so the
        attempt number barely moves the propensity — retry-count effects are
        handled by the timing policy's published-prior decay instead. This
        test pins that honest property so a future retrain that changes it
        is a visible decision, not an accident.
        """
        first, _ = inference.propensity_score(
            bundle,
            amount_minor=4900,
            decline_code="generic",
            attempt=1,
            customer_tenure_days=1460,
        )
        fifth, _ = inference.propensity_score(
            bundle,
            amount_minor=4900,
            decline_code="generic",
            attempt=5,
            customer_tenure_days=1460,
        )
        assert abs(fifth - first) < 0.02


class TestShap:
    def test_top5_shape_and_additivity(self, bundle: ModelBundle) -> None:
        p, contribs = inference.propensity_score(
            bundle,
            amount_minor=4900,
            decline_code="insufficient_funds",
            attempt=1,
            customer_tenure_days=1460,
        )
        top = inference.top_shap(contribs, k=5)
        assert len(top) == 5
        names, values = zip(*top, strict=True)
        assert all(n in FEATURE_NAMES for n in names)
        # TreeSHAP additivity: contributions + bias sum to the output margin.
        margin = float(np.log(p / (1 - p)))
        assert float(contribs.sum()) == pytest.approx(margin, abs=1e-4)

    def test_top5_sorted_by_abs(self, bundle: ModelBundle) -> None:
        _, contribs = inference.propensity_score(
            bundle,
            amount_minor=4900,
            decline_code="do_not_honor",
            attempt=2,
            customer_tenure_days=None,
        )
        top = inference.top_shap(contribs, k=5)
        abss = [abs(v) for _, v in top]
        assert abss == sorted(abss, reverse=True)


class TestMomentScoring:
    def test_per_moment_probabilities(self, bundle: ModelBundle) -> None:
        f0 = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)
        prop, shap, p_recover, factors = inference.score_moments(
            bundle,
            amount_minor=4900,
            decline_code="insufficient_funds",
            attempt=1,
            customer_tenure_days=1460,
            failure_ts=f0,
            candidate_attempts=[2, 3],
            candidate_times=[f0 + timedelta(days=1), f0 + timedelta(days=3)],
        )
        assert 0.0 < prop < 1.0
        assert len(p_recover) == len(factors) == 2
        assert all(0.0 < p < 1.0 for p in p_recover)
        assert all(f > 0 for f in factors)

    def test_matches_manual_combination(self, bundle: ModelBundle) -> None:
        from scoring.policy import combine_p, timing_factor

        f0 = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)
        prop, _, p_recover, _ = inference.score_moments(
            bundle,
            amount_minor=4900,
            decline_code="generic",
            attempt=1,
            customer_tenure_days=None,
            failure_ts=f0,
            candidate_attempts=[2],
            candidate_times=[f0 + timedelta(days=2)],
        )
        expected = combine_p(prop, timing_factor(2, f0 + timedelta(days=2), f0, "generic"))
        assert p_recover[0] == pytest.approx(expected)

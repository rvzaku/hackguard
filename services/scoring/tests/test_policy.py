"""Unit tests for the timing policy (WS-A, >=80% coverage gate).

Every factor here encodes a published prior — the tests pin the *shape*
(monotonicity, bounds, anchoring) so the priors cannot silently change.
"""

from datetime import UTC, datetime, timedelta

import pytest

from scoring.policy import (
    attempt_factor,
    combine_p,
    decline_family_factor,
    hour_of_day_factor,
    payday_cycle_factor,
    recency_factor,
    timing_factor,
)


class TestAttemptFactor:
    def test_attempt_one_is_anchor(self) -> None:
        assert attempt_factor(1) == 1.0

    def test_monotonically_decreasing(self) -> None:
        factors = [attempt_factor(n) for n in range(1, 10)]
        assert all(a >= b for a, b in zip(factors, factors[1:], strict=False))
        # strictly decreasing until the floor (attempts >= 7)
        strict = [attempt_factor(n) for n in range(1, 7)]
        assert all(a > b for a, b in zip(strict, strict[1:], strict=False))

    def test_steep_drop_after_attempt_three(self) -> None:
        # Slicker: "gains drop fast after attempt three"
        assert attempt_factor(3) - attempt_factor(4) > 0.1

    def test_invalid_attempt_clamped(self) -> None:
        assert attempt_factor(0) == attempt_factor(1)


class TestHourFactor:
    def test_morning_is_best(self) -> None:
        assert hour_of_day_factor(datetime(2026, 8, 21, 9, 0)) == max(
            hour_of_day_factor(datetime(2026, 8, 21, h, 0)) for h in range(24)
        )

    def test_night_is_worst(self) -> None:
        assert hour_of_day_factor(datetime(2026, 8, 21, 3, 0)) == min(
            hour_of_day_factor(datetime(2026, 8, 21, h, 0)) for h in range(24)
        )

    def test_boundaries(self) -> None:
        assert hour_of_day_factor(datetime(2026, 8, 21, 6, 0)) > 1.0
        assert hour_of_day_factor(datetime(2026, 8, 21, 12, 0)) == 1.0
        assert hour_of_day_factor(datetime(2026, 8, 21, 23, 0)) < 1.0


class TestPaydayFactor:
    @pytest.mark.parametrize("day", [1, 3, 5, 15, 16])
    def test_on_cycle_boosted(self, day: int) -> None:
        assert payday_cycle_factor(datetime(2026, 8, day)) > 1.0

    @pytest.mark.parametrize("day", [8, 10, 20, 25])
    def test_off_cycle_neutral(self, day: int) -> None:
        assert payday_cycle_factor(datetime(2026, 8, day)) == 1.0

    @pytest.mark.parametrize("month_last_day", [28, 29, 30, 31])
    def test_month_end_boosted(self, month_last_day: int) -> None:
        # last day of a month whose length makes it the final day
        import calendar

        for month in range(1, 13):
            if calendar.monthrange(2026, month)[1] == month_last_day:
                assert payday_cycle_factor(datetime(2026, month, month_last_day)) > 1.0


class TestRecencyFactor:
    def test_within_window_flat(self) -> None:
        f0 = datetime(2026, 8, 1, tzinfo=UTC)
        assert recency_factor(f0, f0 + timedelta(days=0)) == 1.0
        assert recency_factor(f0, f0 + timedelta(days=10)) == 1.0

    def test_decay_after_window(self) -> None:
        f0 = datetime(2026, 8, 1, tzinfo=UTC)
        assert recency_factor(f0, f0 + timedelta(days=11)) < 1.0
        assert recency_factor(f0, f0 + timedelta(days=40)) < recency_factor(
            f0, f0 + timedelta(days=11)
        )

    def test_floor(self) -> None:
        f0 = datetime(2026, 8, 1, tzinfo=UTC)
        assert recency_factor(f0, f0 + timedelta(days=365)) >= 0.4

    def test_before_failure_treated_as_now(self) -> None:
        f0 = datetime(2026, 8, 1, tzinfo=UTC)
        assert recency_factor(f0, f0 - timedelta(days=5)) == 1.0


class TestDeclineFamilyFactor:
    def test_soft_rewards_speed_hard_penalizes(self) -> None:
        from scoring.preprocessing import DeclineFamily

        assert decline_family_factor(DeclineFamily.SOFT) > 1.0
        assert decline_family_factor(DeclineFamily.HARD) < 1.0
        assert decline_family_factor(DeclineFamily.REVIEW) == 1.0


class TestTimingFactor:
    def test_positive_and_deterministic(self) -> None:
        f0 = datetime(2026, 8, 1, tzinfo=UTC)
        a = timing_factor(1, f0 + timedelta(days=1), f0, "insufficient_funds")
        b = timing_factor(1, f0 + timedelta(days=1), f0, "insufficient_funds")
        assert a > 0
        assert a == b

    def test_later_attempts_score_lower(self) -> None:
        f0 = datetime(2026, 8, 1, tzinfo=UTC)
        m1 = timing_factor(1, f0 + timedelta(days=1), f0, "generic")
        m4 = timing_factor(4, f0 + timedelta(days=1), f0, "generic")
        assert m4 < m1


class TestCombineP:
    def test_neutral_factor_preserves_propensity(self) -> None:
        assert combine_p(0.7, 1.0) == pytest.approx(0.7)

    def test_factor_above_one_raises(self) -> None:
        assert combine_p(0.7, 1.5) > 0.7

    def test_factor_below_one_lowers(self) -> None:
        assert combine_p(0.7, 0.5) < 0.7

    def test_odds_space_semantics(self) -> None:
        # a factor of 2 doubles the recovery odds, not the probability
        p = 0.5
        out = combine_p(p, 2.0)
        assert out == pytest.approx(2.0 / 3.0)

    def test_extreme_inputs_clamped(self) -> None:
        assert 0.0 < combine_p(0.0, 100.0) < 1.0
        assert 0.0 < combine_p(1.0, 0.001) < 1.0

    def test_monotonic_in_factor(self) -> None:
        probs = [combine_p(0.6, f) for f in (0.5, 0.8, 1.0, 1.2, 2.0)]
        assert all(a <= b for a, b in zip(probs, probs[1:], strict=False))

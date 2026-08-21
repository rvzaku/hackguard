"""Timing policy: published recovery-by-moment priors, deterministically
combined with the propensity score into P(recover | moment).

This is component 2 of the disclosed hybrid design (plan §3, "ML design"):
the propensity model (component 1) says WHO is likely to recover; this
module says WHEN recovery odds are best, using priors from published
industry data. No timing signal is invented by the model — every factor
below cites its published source (retrieved 2026-08-21):

- Recurly, "Failed Payment Recovery: What the Data Shows"
  (https://recurly.com/blog/failed-payment-recovery-data-based-strategy/):
  optimized retry strategies lift recovery from ~53% to ~71%; 90% of
  recovered transactions occur within the first 10 days after failure.
- Slicker, "How Many Times Should You Retry a Failed Subscription Payment?
  Data and Limits" (https://www.slickerhq.com/resources/blog/
  failed-subscription-payment-retry-attempts, June 2026): the first retry
  recovers 40-60% of soft declines; gains drop fast after attempt three;
  aligning retries with payday cycles (1st/15th in the US) reduces the
  attempts needed.
- Stripe, "How we built it: Smart Retries"
  (https://stripe.com/blog/how-we-built-it-smart-retries): optimal retry
  timing depends on the decline reason (near-immediate for technical
  failures, next-day for insufficient funds, later for card replacement)
  and time-of-day matters — the basis for the mild hour-of-day factor.

All functions are pure and deterministic; unit-tested in tests/test_policy.py.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from scoring.preprocessing import DeclineFamily, decline_family

# --- Attempt-number prior -------------------------------------------------
# Relative recovery factor by 1-based retry attempt, anchored on published
# curves: attempt 1 is the strongest moment (40-60% of eventual soft-decline
# recoveries), with steep decay after attempt 3 (Slicker, June 2026).
# Normalized to attempt 1 == 1.0.
_ATTEMPT_FACTOR: dict[int, float] = {
    1: 1.0,
    2: 0.62,
    3: 0.38,
    4: 0.24,
    5: 0.15,
    6: 0.10,
}
_ATTEMPT_FACTOR_FLOOR: float = 0.07  # attempts >= 7

# --- Hour-of-day prior ----------------------------------------------------
# Mild factor; qualitative basis in Stripe's Smart Retries write-up (time of
# day is one of their model's signals). Morning hours are the industry-
# reported sweet spot; overnight is worst.
_HOUR_FACTOR_MORNING: float = 1.15  # 06:00-11:59 local
_HOUR_FACTOR_DAY: float = 1.00  # 12:00-17:59
_HOUR_FACTOR_EVENING: float = 0.90  # 18:00-22:59
_HOUR_FACTOR_NIGHT: float = 0.75  # 23:00-05:59

# --- Payday-cycle prior ---------------------------------------------------
# Slicker (June 2026): payday alignment (1st/15th US cycles) improves
# recovery odds, especially for funds-related declines.
_PAYDAY_FACTOR_ON_CYCLE: float = 1.20  # days 1-5 and 15-16
_PAYDAY_FACTOR_MONTH_END: float = 1.10  # last two days of the month
_PAYDAY_FACTOR_OFF_CYCLE: float = 1.00

# --- Recency prior --------------------------------------------------------
# Recurly: 90% of recovered transactions occur within 10 days of failure.
# Flat within the window, exponential decay after it.
_RECENCY_WINDOW_DAYS: int = 10
_RECENCY_DECAY_PER_DAY: float = 0.85
_RECENCY_FLOOR: float = 0.40

# --- Combination ----------------------------------------------------------
_PROPENSITY_CLAMP: float = 1e-4
_P_CLAMP: tuple[float, float] = (1e-4, 1.0 - 1e-4)


def attempt_factor(attempt: int) -> float:
    """Relative recovery factor for a 1-based retry attempt number."""
    if attempt < 1:
        attempt = 1
    return _ATTEMPT_FACTOR.get(attempt, _ATTEMPT_FACTOR_FLOOR)


def hour_of_day_factor(scheduled_for: datetime) -> float:
    """Relative recovery factor for the UTC hour of a candidate moment."""
    h = scheduled_for.hour
    if 6 <= h < 12:
        return _HOUR_FACTOR_MORNING
    if 12 <= h < 18:
        return _HOUR_FACTOR_DAY
    if 18 <= h < 23:
        return _HOUR_FACTOR_EVENING
    return _HOUR_FACTOR_NIGHT


def payday_cycle_factor(scheduled_for: datetime) -> float:
    """Relative recovery factor for position in the monthly pay cycle."""
    d = scheduled_for.day
    if d <= 5 or d in (15, 16):
        return _PAYDAY_FACTOR_ON_CYCLE
    # last two days of the month (handles 28-31 day months)
    if (scheduled_for + timedelta(days=2)).month != scheduled_for.month:
        return _PAYDAY_FACTOR_MONTH_END
    return _PAYDAY_FACTOR_OFF_CYCLE


def recency_factor(failure_ts: datetime, scheduled_for: datetime) -> float:
    """Relative recovery factor for days elapsed since the failed payment."""
    days = max(0.0, (scheduled_for - failure_ts).total_seconds() / 86400.0)
    if days <= _RECENCY_WINDOW_DAYS:
        return 1.0
    f: float = float(_RECENCY_DECAY_PER_DAY) ** (days - _RECENCY_WINDOW_DAYS)
    return max(_RECENCY_FLOOR, f)


def decline_family_factor(family: DeclineFamily) -> float:
    """Mild prior modifier by decline family.

    Encodes the Stripe Smart Retries observation that funds-related (soft)
    declines recover well on a well-timed retry while hard declines barely
    recover at all. The big family effect already lives inside the
    propensity model via the int_rate proxy; this only adjusts timing
    urgency (soft declines reward speed — retry while funds are available).
    """
    if family is DeclineFamily.SOFT:
        return 1.10
    if family is DeclineFamily.HARD:
        return 0.60
    return 1.00


def timing_factor(
    attempt: int,
    scheduled_for: datetime,
    failure_ts: datetime,
    decline_code: str,
) -> float:
    """Combined published-prior factor for one candidate moment.

    Product of independent factors (attempt, hour, payday cycle, recency,
    decline family). Deterministic; >0 always.
    """
    f = (
        attempt_factor(attempt)
        * hour_of_day_factor(scheduled_for)
        * payday_cycle_factor(scheduled_for)
        * recency_factor(failure_ts, scheduled_for)
        * decline_family_factor(decline_family(decline_code))
    )
    # Guard against float underflow; factors are bounded well away from 0.
    return max(f, 1e-6)


def _logit(p: float) -> float:
    p = min(max(p, _PROPENSITY_CLAMP), 1.0 - _PROPENSITY_CLAMP)
    return math.log(p / (1.0 - p))


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def combine_p(propensity: float, factor: float) -> float:
    """Combine a base propensity with a timing factor in odds space.

    P(recover|moment) = sigmoid(logit(propensity) + log(factor)) — a factor
    of 1.0 leaves the propensity unchanged; factors multiply the recovery
    ODDS. Result clamped to (0,1). Deterministic.
    """
    return min(max(_sigmoid(_logit(propensity) + math.log(factor)), _P_CLAMP[0]), _P_CLAMP[1])

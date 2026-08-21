"""Payment-feature preprocessing for the propensity model.

Pure, deterministic functions shared by training (models/propensity/train.py)
and serving (scoring.inference) so the loan→payment feature mapping cannot
drift between the two. The mapping itself is the disclosed analogy described
in docs/MODEL.md — the model is trained on Lending Club delinquent-loan
outcomes, and each payment feature is mapped to the loan feature it most
closely proxies:

    amountMinor          -> loan_amnt (log1p of dollars)
    attempt              -> delinq_2yrs (repeat-delinquency signal, capped)
    customer tenure days -> emp_length (years, capped at 10)
    decline code family  -> int_rate band (LC risk-tier proxy; soft declines
                            sit in low-rate bands, hard declines in high-rate
                            bands of the 2007-2011 Lending Club book)

Features with no payment-side analog (dti, revol_util, open_acc, total_acc,
inq_last_6mths, term_months) are imputed at the exact training-set medians
computed on the delinquent cohort (see IMPUTED_MEDIANS). Constant imputes
carry zero per-payment signal and zero SHAP contribution; this is disclosed
in docs/MODEL.md rather than hidden.
"""

import math
from enum import Enum

# Fixed feature order — must match the trained booster's feature_names exactly.
# Training asserts equality at build time; the registry loader re-asserts it.
FEATURE_NAMES: tuple[str, ...] = (
    "amount_log",
    "int_rate",
    "term_months",
    "emp_length_years",
    "dti",
    "delinq_2yrs",
    "inq_last_6mths",
    "revol_util",
    "open_acc",
    "total_acc",
)

# Training-set medians on the Lending Club delinquent cohort (2007-2011,
# n=16,834) for features unavailable in Stripe payment events. Training
# imports and uses these exact constants for imputation, so serve-time
# imputation is identical to train-time imputation by construction.
IMPUTED_MEDIANS: dict[str, float] = {
    "term_months": 36.0,
    "dti": 13.04,
    "inq_last_6mths": 1.0,
    "revol_util": 50.0,
    "open_acc": 9.0,
    "total_acc": 22.0,
    "emp_length_years": 4.0,
}

# Default customer tenure (days) when the caller supplies none — maps to the
# emp_length training median (4 years ≈ 1,460 days).
DEFAULT_CUSTOMER_TENURE_DAYS: int = 1460

# Maximum repeat-failure count fed to the delinq_2yrs proxy (training data
# caps at 39; the 95th percentile is ~2, so 10 is a generous clamp).
MAX_ATTEMPT_PROXY: int = 10


class DeclineFamily(Enum):
    """Stripe decline-code family, after the triage engine's categorization.

    SOFT: temporary conditions (funds, processing) — issuer may approve a
          later retry.
    REVIEW: issuer-discretion codes (e.g. do_not_honor) — outcome uncertain.
    HARD: issuer will not approve (fraud, stolen card, invalid instrument) —
          retry is pointless and, per Visa/Mastercard rules, fee-incurring.
          Suppression itself is the compliance engine's job (plan §2.4); the
          propensity model only reflects the lower recovery odds.
    """

    SOFT = "soft"
    REVIEW = "review"
    HARD = "hard"
    UNKNOWN = "unknown"


# Non-exhaustive map of Stripe decline codes (https://docs.stripe.com/api/
# charges/object#charge_object-failure_code) to families. Unlisted codes
# fall back to UNKNOWN.
_DECLINE_FAMILY_MAP: dict[str, DeclineFamily] = {
    # temporary / funds-timing — a later retry can genuinely succeed
    "insufficient_funds": DeclineFamily.SOFT,
    "try_again_later": DeclineFamily.SOFT,
    "processing_error": DeclineFamily.SOFT,
    "bank_account_restricted": DeclineFamily.SOFT,
    "currency_not_supported": DeclineFamily.SOFT,
    # issuer-discretion — retry sometimes works
    "do_not_honor": DeclineFamily.REVIEW,
    "generic": DeclineFamily.REVIEW,
    "reenter_transaction": DeclineFamily.REVIEW,
    "issuer_not_available": DeclineFamily.REVIEW,
    "card_velocity_exceeded": DeclineFamily.REVIEW,
    "restart_transaction": DeclineFamily.REVIEW,
    "temporary_suspending_violation": DeclineFamily.REVIEW,
    # issuer will not approve
    "do_not_try_again": DeclineFamily.HARD,
    "stolen_card": DeclineFamily.HARD,
    "lost_card": DeclineFamily.HARD,
    "fraudulent": DeclineFamily.HARD,
    "pickup_card": DeclineFamily.HARD,
    "restricted_card": DeclineFamily.HARD,
    "security_violation": DeclineFamily.HARD,
    "invalid_number": DeclineFamily.HARD,
    "incorrect_number": DeclineFamily.HARD,
    "incorrect_cvc": DeclineFamily.HARD,
    "invalid_cvc": DeclineFamily.HARD,
    "expired_card": DeclineFamily.HARD,
    "invalid_expiry_month": DeclineFamily.HARD,
    "invalid_expiry_year": DeclineFamily.HARD,
}


def decline_family(decline_code: str) -> DeclineFamily:
    """Classify a Stripe decline code; case-insensitive, never raises."""
    return _DECLINE_FAMILY_MAP.get(decline_code.strip().lower(), DeclineFamily.UNKNOWN)


# int_rate (percent APR) proxies per decline family, chosen from the Lending
# Club 2007-2011 rate bands (roughly 5.4%–28.99%): soft declines map into the
# low-rate (prime borrower) band, hard declines into the high-rate (deep
# subprime) band, review/unknown mid-band. These are risk-tier proxies, not
# interest-rate predictions — disclosed in docs/MODEL.md.
_FAMILY_RATE_PROXY: dict[DeclineFamily, float] = {
    DeclineFamily.SOFT: 12.0,
    DeclineFamily.REVIEW: 16.5,
    DeclineFamily.HARD: 23.0,
    DeclineFamily.UNKNOWN: 16.5,
}


def family_rate_proxy(family: DeclineFamily) -> float:
    """int_rate band proxy for a decline family."""
    return _FAMILY_RATE_PROXY[family]


def tenure_to_emp_length(tenure_days: int | None) -> float:
    """Customer tenure (days) -> emp_length years proxy, capped at 10."""
    if tenure_days is None:
        tenure_days = DEFAULT_CUSTOMER_TENURE_DAYS
    if tenure_days < 0:
        tenure_days = 0
    return min(10.0, tenure_days / 365.0)


def payment_to_vector(
    amount_minor: int,
    decline_code: str,
    attempt: int,
    customer_tenure_days: int | None,
) -> list[float]:
    """Map payment features to the model feature vector (FEATURE_NAMES order).

    Deterministic and side-effect free; `attempt` is the 1-based failed-
    attempt count for the invoice (attempt=1 -> delinq proxy 0).
    """
    med = IMPUTED_MEDIANS
    delinq_proxy = float(min(max(attempt - 1, 0), MAX_ATTEMPT_PROXY))
    return [
        math.log1p(amount_minor / 100.0),  # amount_log
        family_rate_proxy(decline_family(decline_code)),  # int_rate
        med["term_months"],
        tenure_to_emp_length(customer_tenure_days),  # emp_length_years
        med["dti"],
        delinq_proxy,  # delinq_2yrs
        med["inq_last_6mths"],
        med["revol_util"],
        med["open_acc"],
        med["total_acc"],
    ]

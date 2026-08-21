"""Unit tests for payment-feature preprocessing (WS-A, >=80% coverage gate)."""

import math

import pytest

from scoring.preprocessing import (
    DEFAULT_CUSTOMER_TENURE_DAYS,
    FEATURE_NAMES,
    IMPUTED_MEDIANS,
    MAX_ATTEMPT_PROXY,
    DeclineFamily,
    decline_family,
    family_rate_proxy,
    payment_to_vector,
    tenure_to_emp_length,
)


class TestDeclineFamily:
    def test_soft_codes(self) -> None:
        assert decline_family("insufficient_funds") is DeclineFamily.SOFT
        assert decline_family("try_again_later") is DeclineFamily.SOFT
        assert decline_family("processing_error") is DeclineFamily.SOFT

    def test_review_codes(self) -> None:
        assert decline_family("do_not_honor") is DeclineFamily.REVIEW
        assert decline_family("generic") is DeclineFamily.REVIEW

    def test_hard_codes(self) -> None:
        for code in ("stolen_card", "fraudulent", "expired_card", "incorrect_number"):
            assert decline_family(code) is DeclineFamily.HARD

    def test_case_insensitive_and_stripped(self) -> None:
        assert decline_family("  INSUFFICIENT_FUNDS ") is DeclineFamily.SOFT

    def test_unknown_code_falls_back(self) -> None:
        assert decline_family("some_future_code") is DeclineFamily.UNKNOWN


class TestFamilyRateProxy:
    def test_ordering_matches_risk(self) -> None:
        soft = family_rate_proxy(DeclineFamily.SOFT)
        review = family_rate_proxy(DeclineFamily.REVIEW)
        hard = family_rate_proxy(DeclineFamily.HARD)
        assert soft < review < hard

    def test_unknown_equals_review(self) -> None:
        assert family_rate_proxy(DeclineFamily.UNKNOWN) == family_rate_proxy(DeclineFamily.REVIEW)


class TestTenure:
    def test_none_defaults_to_median_analog(self) -> None:
        assert tenure_to_emp_length(None) == pytest.approx(DEFAULT_CUSTOMER_TENURE_DAYS / 365.0)

    def test_cap_at_ten_years(self) -> None:
        assert tenure_to_emp_length(365 * 100) == 10.0

    def test_negative_clamped_to_zero(self) -> None:
        assert tenure_to_emp_length(-50) == 0.0


class TestPaymentToVector:
    def test_feature_order_matches_names(self) -> None:
        vec = payment_to_vector(4900, "insufficient_funds", 1, 1460)
        assert len(vec) == len(FEATURE_NAMES)
        assert len(set(FEATURE_NAMES)) == len(FEATURE_NAMES)

    def test_amount_log_transform(self) -> None:
        vec = payment_to_vector(4900, "insufficient_funds", 1, 1460)
        assert vec[0] == pytest.approx(math.log1p(49.0))

    def test_soft_vs_hard_decline_differ_in_risk_proxy(self) -> None:
        soft = payment_to_vector(4900, "insufficient_funds", 1, 1460)
        hard = payment_to_vector(4900, "stolen_card", 1, 1460)
        assert soft[1] < hard[1]  # int_rate proxy

    def test_attempt_maps_to_delinq_proxy(self) -> None:
        v1 = payment_to_vector(4900, "generic", 1, 1460)
        v3 = payment_to_vector(4900, "generic", 3, 1460)
        assert v1[5] == 0.0
        assert v3[5] == 2.0

    def test_attempt_proxy_capped(self) -> None:
        v = payment_to_vector(4900, "generic", MAX_ATTEMPT_PROXY + 10, 1460)
        assert v[5] == float(MAX_ATTEMPT_PROXY)

    def test_imputed_features_use_training_medians(self) -> None:
        vec = payment_to_vector(4900, "generic", 1, 1460)
        assert vec[2] == IMPUTED_MEDIANS["term_months"]
        assert vec[4] == IMPUTED_MEDIANS["dti"]
        assert vec[7] == IMPUTED_MEDIANS["revol_util"]

    def test_deterministic(self) -> None:
        a = payment_to_vector(12345, "do_not_honor", 2, 720)
        b = payment_to_vector(12345, "do_not_honor", 2, 720)
        assert a == b

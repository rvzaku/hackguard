"""API smoke tests (scaffold examples — wired, not business logic)."""

from fastapi.testclient import TestClient

from scoring.config import Settings
from scoring.main import create_app


def make_client() -> TestClient:
    return TestClient(create_app(Settings(_env_file=None)))  # type: ignore[call-arg]


def test_healthz() -> None:
    r = make_client().get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["environment"] == "development"


def test_score_validates_against_shared_contract() -> None:
    """POST /v1/score accepts a PaymentFailedEvent and returns a valid Decision.

    The request/response models are generated from the same OpenAPI document
    the TS side produces (packages/contracts/openapi.json) — this is the
    frozen-boundary check.
    """
    r = make_client().post(
        "/v1/score",
        json={
            "stripeId": "evt_test_001",
            "customerId": "cus_test_001",
            "amountMinor": 4900,
            "currency": "usd",
            "declineCode": "insufficient_funds",
            "attempt": 1,
            "cardBrand": "visa",
            "ts": "2026-08-22T10:15:00Z",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["action"] in {"RETRY", "SUPPRESS", "ASK_CUSTOMER"}
    assert body["modelVersion"].startswith("propensity-")


def test_score_rejects_invalid_currency() -> None:
    r = make_client().post(
        "/v1/score",
        json={
            "stripeId": "evt_test_002",
            "customerId": "cus_test_002",
            "amountMinor": 100,
            "currency": "dollars",
            "declineCode": "do_not_honor",
            "attempt": 1,
            "cardBrand": "visa",
            "ts": "2026-08-22T10:15:00Z",
        },
    )
    assert r.status_code == 422

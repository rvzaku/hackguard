"""Contract-conformance tests: the Python side validates against the exact
OpenAPI document generated from @hackguard/contracts (single source of truth).

SCAFFOLD EXAMPLES — fixtures prove the boundary, not business logic.
"""

import json
from pathlib import Path
from typing import Any, cast

import pytest
from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[3]  # services/scoring/tests -> repo root
OPENAPI_PATH = REPO_ROOT / "packages" / "contracts" / "openapi.json"


@pytest.fixture(scope="module")
def schemas() -> dict[str, Any]:
    doc = json.loads(OPENAPI_PATH.read_text())
    return cast(dict[str, Any], doc["components"]["schemas"])


VALID_PAYMENT_FAILED_EVENT = {
    "stripeId": "evt_test_003",
    "customerId": "cus_test_003",
    "amountMinor": 2500,
    "currency": "eur",
    "declineCode": "expired_card",
    "attempt": 3,
    "cardBrand": "mastercard",
    "ts": "2026-08-22T09:00:00Z",
}


def validate(schemas: dict[str, Any], name: str, instance: Any) -> None:
    validator = Draft202012Validator(schemas[name])
    errors = sorted(validator.iter_errors(instance), key=lambda e: e.path)
    assert not errors, f"{name} conformance errors: {[e.message for e in errors]}"


def test_openapi_contract_exists(schemas: dict[str, Any]) -> None:
    assert {"PaymentFailedEvent", "Decision", "AuditEntry", "ReplayEvent"} <= set(schemas)


def test_payment_failed_event_conforms(schemas: dict[str, Any]) -> None:
    validate(schemas, "PaymentFailedEvent", VALID_PAYMENT_FAILED_EVENT)


def test_payment_failed_event_rejects_bad_currency(schemas: dict[str, Any]) -> None:
    bad = {**VALID_PAYMENT_FAILED_EVENT, "currency": "us"}
    assert Draft202012Validator(schemas["PaymentFailedEvent"]).is_valid(bad) is False


def test_audit_entry_conforms(schemas: dict[str, Any]) -> None:
    entry = {
        "seq": 7,
        "prevHash": "b" * 64,
        "hash": "c" * 64,
        "decisionRef": "pay_007",
        "actor": "MODEL",
        "ts": "2026-08-22T09:00:01Z",
    }
    validate(schemas, "AuditEntry", entry)
    assert Draft202012Validator(schemas["AuditEntry"]).is_valid({**entry, "actor": "BOT"}) is False


def test_decision_conforms(schemas: dict[str, Any]) -> None:
    decision = {
        "paymentId": "pay_003",
        "action": "ASK_CUSTOMER",
        "pRecover": 0.21,
        "shapTop": [{"feature": "attempt", "contribution": -0.3}],
        "ruleHits": [],
        "modelVersion": "propensity-v0.1.0",
    }
    validate(schemas, "Decision", decision)


def test_replay_event_conforms(schemas: dict[str, Any]) -> None:
    event = {
        "eventId": "rep_test_001",
        "kind": "PAYMENT_FAILED",
        "source": "stripe-test-capture",
        "capturedAt": "2026-08-22T09:00:00Z",
        "paymentFailed": VALID_PAYMENT_FAILED_EVENT,
    }
    validate(schemas, "ReplayEvent", event)

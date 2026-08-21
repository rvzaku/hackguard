"""API tests for the scoring sidecar, including the p95 latency gate.

WS-A acceptance: POST /v1/score/moments returns pRecover per moment +
shapTop5 + modelVersion; p95 latency < 200ms is asserted and logged.
"""

import time
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from scoring.config import Settings
from scoring.main import create_app

PAYMENT = {
    "stripeId": "evt_test_001",
    "customerId": "cus_test_001",
    "amountMinor": 4900,
    "currency": "usd",
    "declineCode": "insufficient_funds",
    "attempt": 1,
    "cardBrand": "visa",
    "ts": "2026-08-22T10:15:00Z",
}


def make_client() -> TestClient:
    return TestClient(create_app(Settings(_env_file=None)))  # type: ignore[call-arg]


def moments_payload() -> dict[str, Any]:
    base = datetime(2026, 8, 22, 10, 15, tzinfo=UTC)
    return {
        "payment": deepcopy(PAYMENT),
        "customerTenureDays": 410,
        "candidateMoments": [
            {
                "momentId": "m1",
                "attempt": 2,
                "scheduledFor": (base + timedelta(days=1)).isoformat(),
            },
            {
                "momentId": "m2",
                "attempt": 3,
                "scheduledFor": (base + timedelta(days=3)).isoformat(),
            },
            {
                "momentId": "m3",
                "attempt": 4,
                "scheduledFor": (base + timedelta(days=7)).isoformat(),
            },
        ],
    }


class TestHealthz:
    def test_ok(self) -> None:
        r = make_client().get("/healthz")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["modelVersion"] == "propensity-v1.0.0"


class TestScoreMoments:
    def test_contract_shape(self) -> None:
        r = make_client().post("/v1/score/moments", json=moments_payload())
        assert r.status_code == 200
        body = r.json()
        assert body["modelVersion"] == "propensity-v1.0.0"
        assert 0.0 < body["pPropensity"] < 1.0
        assert len(body["shapTop"]) == 5
        for sc in body["shapTop"]:
            assert set(sc) == {"feature", "contribution"}
        assert [m["momentId"] for m in body["moments"]] == ["m1", "m2", "m3"]
        for m in body["moments"]:
            assert 0.0 < m["pRecover"] < 1.0
            assert m["timingFactor"] > 0

    def test_first_moment_strongest(self) -> None:
        body = make_client().post("/v1/score/moments", json=moments_payload()).json()
        ps = [m["pRecover"] for m in body["moments"]]
        assert ps[0] > ps[1] > ps[2]

    def test_rejects_empty_moments(self) -> None:
        payload = moments_payload()
        payload["candidateMoments"] = []
        r = make_client().post("/v1/score/moments", json=payload)
        assert r.status_code == 422

    def test_rejects_invalid_attempt(self) -> None:
        payload = moments_payload()
        payload["candidateMoments"][0]["attempt"] = 0
        r = make_client().post("/v1/score/moments", json=payload)
        assert r.status_code == 422

    def test_rejects_bad_payment_currency(self) -> None:
        payload = moments_payload()
        payload["payment"]["currency"] = "dollars"
        r = make_client().post("/v1/score/moments", json=payload)
        assert r.status_code == 422


class TestScoreSingleDecision:
    def test_returns_best_moment_decision(self) -> None:
        r = make_client().post("/v1/score", json=deepcopy(PAYMENT))
        assert r.status_code == 200
        body = r.json()
        assert body["paymentId"] == "evt_test_001"
        assert body["action"] in {"RETRY", "SUPPRESS", "ASK_CUSTOMER"}
        assert body["scheduledFor"] is not None
        assert 0.0 < body["pRecover"] < 1.0
        assert len(body["shapTop"]) <= 5
        assert body["modelVersion"].startswith("propensity-")

    def test_rejects_invalid_event(self) -> None:
        r = make_client().post("/v1/score", json={**deepcopy(PAYMENT), "amountMinor": -5})
        assert r.status_code == 422


class TestLatency:
    def test_p95_under_200ms(self) -> None:
        """p95 latency gate (<200ms), measured over the full HTTP path."""
        client = make_client()
        payload = moments_payload()
        # warm-up (model load, first-request overhead)
        for _ in range(5):
            assert client.post("/v1/score/moments", json=payload).status_code == 200
        samples: list[float] = []
        for _ in range(60):
            t0 = time.perf_counter()
            r = client.post("/v1/score/moments", json=payload)
            samples.append((time.perf_counter() - t0) * 1000.0)
            assert r.status_code == 200
        samples.sort()
        p50 = samples[len(samples) // 2]
        p95 = samples[int(len(samples) * 0.95)]
        print(f"\nlatency ms: p50={p50:.1f} p95={p95:.1f} max={samples[-1]:.1f}")
        assert p95 < 200.0, f"p95 latency {p95:.1f}ms exceeds 200ms budget"

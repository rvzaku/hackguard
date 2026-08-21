"""FastAPI application factory (scaffold).

Endpoints:
- GET /healthz          liveness probe (used by the demo-window keep-alive cron)
- POST /v1/score        SCAFFOLD EXAMPLE: validates a PaymentFailedEvent against
                        the shared contract and returns a deterministic stub
                        Decision. Real model lands in WS-A/WS-B.
"""

from datetime import UTC, datetime

from fastapi import FastAPI
from pydantic import BaseModel

from scoring.config import Settings, get_settings
from scoring.contracts_gen import Action, Decision, PaymentFailedEvent


class Health(BaseModel):
    status: str
    version: str
    environment: str


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(
        title="HackGuard Scoring Sidecar",
        version="0.1.0",
        description="Typed OpenAPI boundary shared with @hackguard/contracts.",
    )
    s = settings or get_settings()

    @app.get("/healthz", response_model=Health)
    def healthz() -> Health:
        return Health(status="ok", version="0.1.0", environment=s.environment)

    @app.post("/v1/score", response_model=Decision)
    def score(event: PaymentFailedEvent) -> Decision:
        # SCAFFOLD EXAMPLE — deterministic stub decision, no business logic.
        return Decision(
            paymentId=event.stripeId,
            action=Action.RETRY,
            scheduledFor=datetime.now(UTC),
            pRecover=0.5,
            shapTop=[],
            ruleHits=["SCAFFOLD-STUB"],
            modelVersion="propensity-v0.0.0-scaffold",
        )

    return app


app = create_app()

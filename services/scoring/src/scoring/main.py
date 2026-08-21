"""FastAPI application: typed scoring sidecar (plan §3).

Endpoints:
- GET  /healthz           liveness probe (demo-window keep-alive cron)
- POST /v1/score          single Decision for a failed payment: the model
                          scores a default 3-step retry schedule and the
                          best moment becomes the Decision.
- POST /v1/score/moments  per-moment scoring: {payment, candidateMoments} ->
                          {pRecover per moment, shapTop5, modelVersion}.

The model bundle is loaded lazily and cached; if the artifact is missing or
inconsistent, scoring endpoints return 503 while /healthz stays green so the
sidecar boots degraded (mirrors the plan's DB-outage degradation posture).
"""

from datetime import timedelta

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from scoring import inference
from scoring.api_models import (
    CandidateMoment,
    MomentScore,
    ScoreMomentsRequest,
    ScoreMomentsResponse,
    ShapContribution,
)
from scoring.config import Settings, get_settings
from scoring.contracts_gen import Action, Decision, PaymentFailedEvent, ShapTopItem
from scoring.model_registry import ModelBundle, ModelLoadError, get_bundle

VERSION = "0.1.0"

# Default retry schedule scored by POST /v1/score when no explicit moments
# are supplied: +1d, +3d, +7d after failure — inside Recurly's published
# 10-day recovery window (see scoring/policy.py citations).
_DEFAULT_SCHEDULE_OFFSETS_DAYS: tuple[int, ...] = (1, 3, 7)


def _load_bundle_or_503(settings: Settings) -> ModelBundle:
    try:
        return get_bundle(settings)
    except ModelLoadError as exc:
        raise HTTPException(status_code=503, detail=f"model unavailable: {exc}") from exc


class Health(BaseModel):
    """GET /healthz response."""

    status: str
    version: str
    environment: str
    modelVersion: str


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(
        title="HackGuard Scoring Sidecar",
        version=VERSION,
        description=(
            "Typed scoring boundary: propensity model (Lending Club-trained "
            "XGBoost) + published-prior timing policy. Methodology: docs/MODEL.md."
        ),
    )
    s = settings or get_settings()

    @app.get("/healthz", response_model=Health)
    def healthz() -> Health:
        # Degraded-boot posture: /healthz stays green even if the artifact
        # is missing; scoring endpoints return 503 in that case.
        return Health(
            status="ok",
            version=VERSION,
            environment=s.environment,
            modelVersion=s.model_version,
        )

    def _score_moments_impl(req: ScoreMomentsRequest) -> ScoreMomentsResponse:
        bundle = _load_bundle_or_503(s)
        payment = req.payment
        failure_ts = payment.ts
        propensity, shap_top, p_recover, factors = inference.score_moments(
            bundle,
            amount_minor=payment.amountMinor,
            decline_code=payment.declineCode,
            attempt=payment.attempt,
            customer_tenure_days=req.customerTenureDays,
            failure_ts=failure_ts,
            candidate_attempts=[m.attempt for m in req.candidateMoments],
            candidate_times=[m.scheduledFor for m in req.candidateMoments],
        )
        return ScoreMomentsResponse(
            modelVersion=bundle.version,
            pPropensity=propensity,
            shapTop=[ShapContribution(feature=f, contribution=c) for f, c in shap_top],
            moments=[
                MomentScore(
                    momentId=m.momentId,
                    attempt=m.attempt,
                    scheduledFor=m.scheduledFor,
                    pRecover=p,
                    timingFactor=f,
                )
                for m, p, f in zip(req.candidateMoments, p_recover, factors, strict=True)
            ],
        )

    @app.post("/v1/score/moments", response_model=ScoreMomentsResponse)
    def score_moments(req: ScoreMomentsRequest) -> ScoreMomentsResponse:
        """Score each candidate retry moment: P(recover|moment), SHAP top-5."""
        return _score_moments_impl(req)

    @app.post("/v1/score", response_model=Decision)
    def score(event: PaymentFailedEvent) -> Decision:
        """Single Decision: best moment from the default retry schedule."""
        failure_ts = event.ts
        candidates = [
            CandidateMoment(attempt=event.attempt + 1, scheduledFor=failure_ts + timedelta(days=d))
            for d in _DEFAULT_SCHEDULE_OFFSETS_DAYS
        ]
        result = _score_moments_impl(
            ScoreMomentsRequest(payment=event, candidateMoments=candidates)
        )
        best = max(result.moments, key=lambda m: m.pRecover)
        return Decision(
            paymentId=event.stripeId,
            action=Action.RETRY,
            scheduledFor=best.scheduledFor,
            pRecover=best.pRecover,
            shapTop=[
                ShapTopItem(feature=sc.feature, contribution=sc.contribution)
                for sc in result.shapTop
            ],
            ruleHits=[],
            modelVersion=result.modelVersion,
        )

    return app


app = create_app()

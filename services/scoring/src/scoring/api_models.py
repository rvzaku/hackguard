"""Sidecar-local request/response models for the scoring endpoints.

These extend (not replace) the frozen shared contracts: `payment` reuses
contracts_gen.PaymentFailedEvent. The per-moment scoring shapes live here
until they are promoted into packages/contracts by the contracts owner —
the sidecar's own FastAPI OpenAPI document exposes them typed either way.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from scoring.contracts_gen import PaymentFailedEvent


class CandidateMoment(BaseModel):
    """One candidate retry moment to score."""

    model_config = ConfigDict(extra="forbid")

    momentId: str | None = Field(default=None, min_length=1, description="Caller-chosen id")
    attempt: int = Field(ge=1, le=50, description="1-based attempt number of this retry")
    scheduledFor: datetime = Field(description="Candidate retry timestamp, RFC 3339")


class ScoreMomentsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payment: PaymentFailedEvent = Field(description="The failed payment to score")
    customerTenureDays: int | None = Field(
        default=None,
        ge=0,
        description="Days since the customer's first invoice; imputed if omitted",
    )
    candidateMoments: list[CandidateMoment] = Field(
        min_length=1, max_length=20, description="Candidate retry moments, scored independently"
    )


class ShapContribution(BaseModel):
    feature: str
    contribution: float


class MomentScore(BaseModel):
    momentId: str | None
    attempt: int
    scheduledFor: datetime
    pRecover: float = Field(ge=0.0, le=1.0)
    timingFactor: float = Field(gt=0.0, description="Published-prior timing factor applied")


class ScoreMomentsResponse(BaseModel):
    modelVersion: str
    pPropensity: float = Field(ge=0.0, le=1.0, description="P(payer recovers), payment-level")
    shapTop: list[ShapContribution] = Field(max_length=5)
    moments: list[MomentScore]

"""Versioned model registry: load a pinned propensity-model artifact.

Layout (committed to the repo — plan §3 "Model registry"):

    models/registry/<version>/
        model.json        XGBoost booster (native JSON format)
        meta.json         version, feature names, base rate, data provenance
        metrics.json      held-out evaluation incl. baseline comparison
        eval_report.md    human-readable evaluation report

Loading is pinned by version: `get_bundle` resolves
SCORING_MODEL_DIR/<SCORING_MODEL_VERSION> and fails loudly if the artifact's
recorded version does not match the requested one.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import xgboost as xgb
from pydantic import BaseModel, Field

from scoring.config import Settings
from scoring.preprocessing import FEATURE_NAMES


class ModelMeta(BaseModel):
    """Contents of meta.json — written by training, validated at load."""

    version: str
    featureNames: list[str]
    baseRate: float = Field(ge=0.0, le=1.0)
    trainedAt: str
    dataSource: str
    dataSha256: str
    trainRows: int
    seed: int
    params: dict[str, Any]


class ModelBundle:
    """A loaded, pinned model artifact (booster + metadata)."""

    __slots__ = ("version", "booster", "meta")

    def __init__(self, version: str, booster: xgb.Booster, meta: ModelMeta) -> None:
        self.version = version
        self.booster = booster
        self.meta = meta


class ModelLoadError(RuntimeError):
    """Raised when a pinned model artifact is missing or inconsistent."""


def load_bundle(registry_dir: Path, version: str) -> ModelBundle:
    """Load and validate the artifact for `version` from `registry_dir`.

    Raises ModelLoadError if anything is missing or inconsistent — the
    sidecar must never silently serve an unpinned or mismatched model.
    """
    model_dir = registry_dir / version
    model_path = model_dir / "model.json"
    meta_path = model_dir / "meta.json"
    if not model_path.is_file() or not meta_path.is_file():
        raise ModelLoadError(
            f"model artifact for version {version!r} not found under {registry_dir}"
        )

    try:
        meta = ModelMeta.model_validate(json.loads(meta_path.read_text()))
    except (json.JSONDecodeError, ValueError) as exc:
        raise ModelLoadError(f"invalid meta.json for {version!r}: {exc}") from exc

    if meta.version != version:
        raise ModelLoadError(
            f"version mismatch: requested {version!r}, artifact records {meta.version!r}"
        )
    if tuple(meta.featureNames) != FEATURE_NAMES:
        raise ModelLoadError(
            f"feature-name drift for {version!r}: artifact={meta.featureNames} "
            f"code={list(FEATURE_NAMES)}"
        )

    booster = xgb.Booster()
    try:
        booster.load_model(model_path)
    except xgb.core.XGBoostError as exc:
        raise ModelLoadError(f"failed to load booster for {version!r}: {exc}") from exc

    expected = list(FEATURE_NAMES)
    if booster.feature_names != expected:
        raise ModelLoadError(
            f"booster feature_names drift for {version!r}: {booster.feature_names} != {expected}"
        )
    return ModelBundle(version=version, booster=booster, meta=meta)


@lru_cache(maxsize=8)
def _cached_load(registry_dir: str, version: str) -> ModelBundle:
    return load_bundle(Path(registry_dir), version)


def get_bundle(settings: Settings) -> ModelBundle:
    """Cached bundle lookup driven by settings (pinned by version)."""
    return _cached_load(str(settings.model_dir), settings.model_version)

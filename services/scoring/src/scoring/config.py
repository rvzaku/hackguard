"""Env-driven configuration (Neon Postgres + runtime settings).

All values come from environment variables / a local .env file.
See the repo-root .env.example — no secrets are ever committed.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


# Repo-root models/registry, resolved relative to this file so the sidecar
# finds committed artifacts regardless of the process working directory:
# <root>/services/scoring/src/scoring/config.py → parents[4] = <root>.
# Falls back to CWD-relative models/registry when the source tree is shallower
# than the repo layout (e.g. container installs where SCORING_MODEL_DIR is
# expected to be set explicitly).
def _default_model_dir() -> Path:
    try:
        return Path(__file__).resolve().parents[4] / "models" / "registry"
    except IndexError:
        return Path.cwd() / "models" / "registry"


_DEFAULT_MODEL_DIR = _default_model_dir()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="SCORING_",
        extra="ignore",
    )

    environment: str = "development"
    log_level: str = "info"
    port: int = 8000

    # Neon Postgres connection string. Optional at scaffold stage: the scoring
    # sidecar must boot (degraded) even when the DB is unreachable — see plan
    # §6 failure tests ("DB outage degradation").
    database_url: PostgresDsn | None = None

    # Model registry: directory of versioned artifacts + the pinned version
    # to serve. See scoring/model_registry.py and docs/MODEL.md.
    model_dir: Path = _DEFAULT_MODEL_DIR
    model_version: str = "propensity-v1.0.0"


@lru_cache
def get_settings() -> Settings:
    return Settings()

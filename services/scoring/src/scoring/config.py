"""Env-driven configuration (Neon Postgres + runtime settings).

All values come from environment variables / a local .env file.
See the repo-root .env.example — no secrets are ever committed.
"""

from functools import lru_cache

from pydantic import PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


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


@lru_cache
def get_settings() -> Settings:
    return Settings()

"""Unit tests for env-driven Settings (scaffold).

No live DB connection — validates parsing/typing only.
"""

from scoring.config import Settings


def test_defaults() -> None:
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.environment == "development"
    assert s.port == 8000
    assert s.database_url is None


def test_database_url_parses_neon_style_dsn() -> None:
    s = Settings.model_validate(
        {
            "database_url": "postgresql://u:p@ep-cool-name-123.us-east-2.aws.neon.tech/hackguard?sslmode=require",
        }
    )
    assert s.database_url is not None
    assert str(s.database_url).startswith("postgresql://")


def test_scoring_env_prefix_applies(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("SCORING_ENVIRONMENT", "production")
    monkeypatch.setenv("SCORING_PORT", "9000")
    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.environment == "production"
    assert s.port == 9000

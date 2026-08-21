#!/usr/bin/env bash
# Python-side verification: lint (ruff) + typecheck (mypy --strict) + tests (pytest).
# Mirrors the `python` CI job in .github/workflows/ci.yml.
set -euo pipefail
cd "$(dirname "$0")/../services/scoring"

if [ ! -d .venv ]; then
  echo "No .venv found — run 'npm run setup' first." >&2
  exit 1
fi

uv run ruff check .
uv run ruff format --check .
uv run mypy --strict src tests
uv run pytest -q

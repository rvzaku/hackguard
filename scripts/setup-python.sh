#!/usr/bin/env bash
# Python-side setup: creates .venv with Python 3.12 (via uv) and installs deps.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

cd services/scoring
uv python install 3.12
uv sync --dev
echo "Python environment ready: services/scoring/.venv"

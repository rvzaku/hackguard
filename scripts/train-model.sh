#!/usr/bin/env bash
# One-command propensity-model training (WS-A acceptance: "fresh training
# reproducible via one command").
#
#   scripts/train-model.sh              # small-sample smoke train -> var/model-smoke
#   scripts/train-model.sh --full       # full cohort -> models/registry/propensity-v1.0.0
#
# Any extra args are passed through to models/propensity/train.py.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = "--full" ]; then
  shift
  cd "$ROOT/services/scoring"
  exec uv run python "$ROOT/models/propensity/train.py" --full-data --version propensity-v1.0.0 "$@"
else
  cd "$ROOT/services/scoring"
  exec uv run python "$ROOT/models/propensity/train.py" \
    --sample "${SMOKE_SAMPLE:-4000}" \
    --version propensity-smoke \
    --out "$ROOT/var/model-smoke" \
    "$@"
fi

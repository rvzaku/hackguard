#!/usr/bin/env bash
# verify-e2e.sh — boots the HackGuard stack, drives the golden path end to end
# via API (ingest -> triage -> compliance -> scheduler -> scoring -> decisions
# -> audit chain), asserts the dashboard's data surfaces, prints PASS.
#
# Usage:
#   scripts/verify-e2e.sh             # no-Docker path: local sidecar + Next.js
#                                     # server, embedded in-memory stores
#   scripts/verify-e2e.sh --docker    # docker compose up --build, then drive it
#
# Prereqs (no-Docker): Node >= 20, uv; run `npm run setup` first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-local}"
WEB_URL="http://localhost:3000"
SCORING_URL="http://localhost:8000"
SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_demo_local}"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

wait_http() { # url label attempts
  local url="$1" label="$2" attempts="${3:-60}"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  echo "FAIL: $label did not become healthy at $url" >&2
  return 1
}

echo "== HackGuard E2E verification (mode: $MODE) =="

if [ "$MODE" = "--docker" ]; then
  command -v docker >/dev/null || { echo "FAIL: docker not found"; exit 1; }
  echo "-- building + starting stack (this can take a few minutes on first run)"
  STRIPE_WEBHOOK_SECRET="$SECRET" docker compose up --build -d
  echo "-- waiting for postgres / scoring / web"
  wait_http "http://localhost:8000/healthz" "scoring" 120
  wait_http "$WEB_URL" "web" 120
else
  [ -d node_modules ] || { echo "FAIL: node_modules missing — run 'npm run setup' first"; exit 1; }
  [ -x services/scoring/.venv/bin/python ] || { echo "FAIL: python venv missing — run 'npm run setup' first"; exit 1; }

  if ! curl -sf -o /dev/null "$SCORING_URL/healthz"; then
    echo "-- starting scoring sidecar on :8000"
    mkdir -p var
    (cd services/scoring && nohup .venv/bin/uvicorn scoring.main:app --port 8000 >"$ROOT/var/e2e-scoring.log" 2>&1 &
      echo $! > "$ROOT/var/e2e-scoring.pid")
    PIDS+=("$(cat "$ROOT/var/e2e-scoring.pid")")
  fi
  wait_http "$SCORING_URL/healthz" "scoring" 60

  if ! curl -sf -o /dev/null "$WEB_URL"; then
    echo "-- building + starting web app on :3000"
    npm run build -w @hackguard/web
    mkdir -p var
    STRIPE_WEBHOOK_SECRET="$SECRET" SCORING_BASE_URL="$SCORING_URL" \
      nohup npm run start -w @hackguard/web >"$ROOT/var/e2e-web.log" 2>&1 &
    WEB_PID=$!
    PIDS+=("$WEB_PID")
  fi
  wait_http "$WEB_URL" "web" 120
fi

echo "-- driving golden path via API"
npx tsx scripts/e2e-drive.ts --web "$WEB_URL" --scoring "$SCORING_URL" --secret "$SECRET"

if [ "$MODE" = "--docker" ]; then
  echo "(stack left running — visit http://localhost:3000, stop with: docker compose down)"
else
  echo "(temporary servers stopped; logs in var/e2e-*.log)"
fi
echo "PASS"

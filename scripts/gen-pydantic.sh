#!/usr/bin/env bash
# Regenerates services/scoring/src/scoring/contracts_gen.py from the frozen
# OpenAPI contract (packages/contracts/openapi.json).
# CI checks that the committed file matches a fresh regeneration.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

OPENAPI="$ROOT/packages/contracts/openapi.json"
OUT="$ROOT/services/scoring/src/scoring/contracts_gen.py"

if [ ! -f "$OPENAPI" ]; then
  echo "Missing $OPENAPI — run 'npm run contracts:openapi' first." >&2
  exit 1
fi

cd "$ROOT/services/scoring"
# Generate to a temp path and copy: datamodel-codegen's formatting is
# path-dependent, and the sync test compares against a tmp-path generation.
TMP_OUT="$(mktemp -t contracts_gen.XXXXXX.py)"
trap 'rm -f "$TMP_OUT"' EXIT
uv run datamodel-codegen \
  --input "$OPENAPI" \
  --input-file-type openapi \
  --output "$TMP_OUT" \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.12 \
  --use-schema-description \
  --formatters builtin \
  --disable-timestamp
mkdir -p "$(dirname "$OUT")"
cp "$TMP_OUT" "$OUT"
echo "Regenerated $OUT"

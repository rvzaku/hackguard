# Architecture (scaffold)

```
apps/web (Next.js 15, TS strict, Tailwind v4)   — UI + BFF API routes (Vercel Hobby)
  ├─ /api/webhooks/stripe    Zod-validated, signature-verified, dedupe (WS-B)
  ├─ /api/decisions          decision feed + SHAP explanations (WS-B/WS-C)
  └─ /api/replay             A/B replay harness control (WS-C)
services/scoring (FastAPI, Python 3.12, mypy --strict, Pydantic v2) — Render Free
  ├─ native XGBoost + SHAP TreeExplainer (WS-A)
  └─ typed OpenAPI contract → generated Pydantic models (frozen boundary)
packages/contracts — single source of truth: Zod schemas → openapi.json
  └─ Python models generated from openapi.json (scripts/gen-pydantic.sh)
Postgres (Neon free)     merchants, payments, decisions, audit_log (append-only)
Upstash Redis (free)     idempotency keys, rate limits
```

## Contract flow (frozen boundary)

1. `packages/contracts/src/*.ts` — Zod schemas for `PaymentFailedEvent`,
   `Decision`, `AuditEntry`, `ReplayEvent` (plan §4).
2. `npm run contracts:openapi` — generates `packages/contracts/openapi.json`.
3. `npm run contracts:pydantic` — generates
   `services/scoring/src/scoring/contracts_gen.py` from that file.
4. `services/scoring/tests/test_generated_contracts_sync.py` fails if the
   committed Pydantic models drift from `openapi.json`.

Never edit `openapi.json` or `contracts_gen.py` by hand.

## Audit ledger

`db/migrations/0001_audit_log.sql` — append-only `audit_log` with
`(seq, prev_hash, hash, decision_ref, actor, ts)`; UPDATE/DELETE rejected by
trigger; hash chain verified application-side (WS-B).

## Environments

All configuration is env-driven; `.env.example` is the committed template.
Neon connection string in `DATABASE_URL`; the scoring sidecar boots degraded
without it (DB-outage degradation is a plan §6 failure test).

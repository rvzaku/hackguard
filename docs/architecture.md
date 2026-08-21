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

## Backend core (WS-B)

Lives in `apps/web/src/lib` (strict TS, Zod-validated boundaries, typed error
union in `errors.ts`):

- `stripe/` — HMAC signature verification (`signature.ts`, timing-safe,
  timestamp-tolerance replay protection) and envelope→contract mapping
  (`parse.ts`). Route: `src/app/api/webhooks/stripe/route.ts` — verify →
  event-id dedupe (Upstash SET NX, `idempotency.ts`) → persist → triage →
  guardrail → schedule → audit append.
- `triage/rules.ts` — deterministic decline-code mapping: Visa Cat 1 →
  NEVER_RETRY_HARD, Cat 2/3 → RETRY_SOFT (15/30d), Mastercard MAC 01/03/21 →
  never auto-retry, TPE caps 10/24h + 35/30d. Every decision carries rule
  citations.
- `compliance/guardrail.ts` — pure cap enforcement; counts committed
  (executed + scheduled-future) reattempts per scope. Property-tested with
  fast-check (`apps/web/test/compliance.property.test.ts`): no accepted
  schedule can exceed a cap; hard declines are never retried.
- `scheduler/scheduler.ts` — scores candidate moments via the typed sidecar
  client (`scoring/client.ts`, responses validated against the frozen Zod
  Decision contract); on sidecar outage degrades to the published-curve
  heuristic flagged `degraded: true`.
- `audit/chain.ts` — canonical-JSON SHA-256 hash chain over the append-only
  ledger; `verifyAuditChain` full-scan tamper detection.
- `replay/engine.ts` — A/B harness: baseline fixed cadence vs policy over an
  identical captured stream; recovery via deterministic draw (SHA-256),
  disclosed as counterfactual estimation. Routes: `/api/replay/seed`,
  `/api/replay/run`.
- `stores/` — persistence boundaries with in-memory implementations (tests /
  degraded local mode) and Neon Postgres implementations (`postgres.js`),
  selected by `runtime.ts` when `DATABASE_URL` is set. Migrations:
  `db/migrations/000{1,2}_*.sql`.

Web tests run with v8 coverage and enforce ≥80% lines/branches/functions on
the triage/compliance/scheduler/audit core (`apps/web/vitest.config.ts`).
Route tests swap the process-wide runtime via `setRuntimeForTests()`.

## Environments

All configuration is env-driven; `.env.example` is the committed template.
Neon connection string in `DATABASE_URL`; the scoring sidecar boots degraded
without it (DB-outage degradation is a plan §6 failure test).

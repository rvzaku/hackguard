# End-to-end verification record

Recorded passing runs of `scripts/verify-e2e.sh` on both supported paths, from a
clean state (no pre-existing containers, volumes, or servers), on this branch.

- Date: 2026-08-21
- Machine: macOS arm64, Node 24, Python 3.12 (uv), Docker 29 / compose v5 (colima)
- Gates at time of recording: `npm run verify` green — ESLint + `tsc --strict` +
  Vitest **104 tests** (91 web / 13 contracts) + ruff + `mypy --strict` + pytest
  with 98.4% ML-core coverage.
- UI golden path: Playwright spec `apps/web/e2e/dashboard.spec.ts` green
  (signed ingest → decision feed → SHAP panel → A/B counters → ledger →
  verify-chain → violation block; asserts zero console errors).

## What the driver proves

For each path, `scripts/e2e-drive.ts` drives the live stack over HTTP only:

1. Scoring sidecar `/healthz` with the committed model artifact loaded.
2. Twelve signed Stripe test-mode webhooks (`invoice.payment_failed`) through
   `POST /api/webhooks/stripe`: signature verify → event-id dedupe → contract
   validation → persist → triage → compliance guardrail → model-scored schedule
   → decision persisted → hash-chained audit append.
3. Duplicate delivery acked idempotently (`deduped: true`, no double decision).
4. Forged signature rejected with typed 400 before any side effect.
5. A/B replay: canonical stream seeded (`POST /api/replay/seed`), both arms run
   (`POST /api/replay/run`), series + counters served by `GET /api/replay` with
   the verbatim counterfactual-methodology caption.
6. Decision feed covers all three actions (RETRY / SUPPRESS / ASK_CUSTOMER)
   with network-rule citations and live SHAP attributions.
7. Compliance violation probe: Visa Cat-1 hard-decline retry blocked by the real
   guardrail and recorded in the ledger.
8. Full-scan hash-chain verification reports the ledger intact.

## Path A — no-Docker (embedded in-memory stores)

Command: `scripts/verify-e2e.sh` (builds web, boots sidecar + web, drives, tears down)

```
-- driving golden path via API
HackGuard E2E — web=http://localhost:3000 scoring=http://localhost:8000
  ✓ scoring sidecar /healthz
  ✓ model artifact loaded (propensity-v1.0.0)
  ✓ webhook evt_seed_001 … evt_seed_012 accepted (HTTP 200)   [12 lines]
  ✓ every ingest produced a decision
  ✓ at least one RETRY carries SHAP attributions (live sidecar)
  ✓ decisions carry network-rule citations
  ✓ duplicate event deduped
  ✓ forged signature rejected (typed 400)
  ✓ replay stream seeded
  ✓ A/B replay ran both arms (baseline=2 recovered, policy=6 recovered)
  ✓ replay series served with counters + verbatim methodology caption (baseline=$98.00 policy=$390.00)
  ✓ decision feed covers all three actions (12 decisions)
  ✓ violation probe blocked by compliance engine
  ✓ audit ledger recorded every enforcement event (13 entries)
  ✓ hash chain verifies intact (13 entries checked)

E2E PASS — 26 assertions green
PASS
```

## Path B — Docker (`docker compose up --build`)

Command: `scripts/verify-e2e.sh --docker` (fresh `pgdata` volume; migrations
0001–0003 applied by the Postgres initdb mount; stack left running afterwards).

Driver output identical to Path A:

```
E2E PASS — 26 assertions green
PASS
```

Additional storage-layer checks against the running containers:

```
$ docker exec hackathon-postgres-1 psql -U hackguard -d hackguard \
    -c "SELECT count(*) FROM decisions; SELECT count(*) FROM audit_log;"
 count = 12      # one persisted contract-shaped decision per webhook
 count = 13      # 12 decision attestations + 1 rule enforcement event

$ docker exec hackathon-postgres-1 psql -U hackguard -d hackguard \
    -c "UPDATE audit_log SET actor='HUMAN' WHERE seq=0;"
ERROR: audit_log is append-only: UPDATE blocked   # DB-level tamper rejection
```

## Bugs found and fixed during this integration pass

- **Route-isolated singletons**: Next.js bundles each route separately, so the
  runtime cache was duplicated per route — a stream seeded via `/api/replay/seed`
  was invisible to `/api/replay/run`. Fixed by caching the composed runtime on
  `globalThis` (`apps/web/src/lib/runtime.ts`).
- **Demo-only dashboard**: `/api/decisions`, `/api/audit`, `/api/audit/verify`,
  `/api/replay`, and `/api/compliance/simulate-violation` were backed by hardcoded
  demo seed data instead of the real pipeline. All rewired to the runtime stores;
  the fake store deleted.
- **No decisions persistence**: added migration `0003_decisions.sql` +
  `DecisionStore` (in-memory + Postgres); the webhook route now persists every
  decision.
- **Dishonest replay outcome model**: the baseline arm earned counterfactual
  "recoveries" on hard declines that cannot cure by blind retry, while the policy
  arm got no credit for dunning. Baseline P(recover) now reflects published facts
  (hard declines ≈ never; customer-actionable ≈ only via dunning; fixed-schedule
  timing efficiency), and ASK_CUSTOMER events recover through the policy's dunning
  channel — the policy now wins for the right reasons ($98 vs $390 on the demo
  stream).
- **Sidecar container crash**: `config.py` computed its default model dir with
  `parents[4]`, raising `IndexError` outside the repo layout. Now falls back safely.
- **Web image missing the eval artifact**: the `/api/eval-loop` route statically
  imports `models/registry/eval-loop-v1/metrics.json`; the web Docker build now
  copies `models/registry` (verified: `GET /api/eval-loop` serves the artifact in
  the composed stack).
- **Root `.env` not read by the web app**: `next.config.ts` loads the repo-root
  `.env` via `@next/env` so one file configures the whole stack in dev.

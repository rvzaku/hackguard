# HackGuard

> **Free, self-hostable payment-recovery brain for small SaaS.** Sits above Stripe's
> built-in retries: triages every failed payment (retry / never-retry / ask-customer),
> times retries with a trained ML model, enforces Visa & Mastercard network retry rules,
> and proves every decision with plain-English explanations and a tamper-evident audit trail.

## Why this exists

- ~13% of subscription billing attempts fail; involuntary churn costs the subscription
  industry an estimated **$129B/year** (Recurly).
- AI-grade retry intelligence exists but is paywalled at **$250–700+/mo** — out of reach
  for the $5k–$50k MRR SaaS tier that loses 5–15% of recurring revenue to payment failures.
- Retrying blindly is now *penalized*: Visa charges per-attempt fees past 15 reattempts/30
  days (and forbids Category-1 declines entirely); Mastercard's Transaction Processing
  Excellence program penalizes past 10/24h and 35/30 days. Most small businesses have no
  triage at all.

HackGuard is the decision layer **above** Smart Retries: decline triage, model-scored
retry timing, dunning orchestration, network-compliance guardrails, and explainability —
free and self-hostable.

## Quickstart

Prereqs: **Docker** (path A) or **Node ≥ 20 + [uv](https://docs.astral.sh/uv/)**
(`curl -LsSf https://astral.sh/uv/install.sh | sh`) for path B.

### Path A — Docker (one command)

```bash
docker compose up --build
# → dashboard  http://localhost:3000   (Postgres migrations applied automatically)
```

Open http://localhost:3000 and click **“Load demo data”** — that seeds a realistic
failure stream, runs the A/B replay, and populates every panel. To drive live signed
webhook ingest exactly like Stripe would deliver:

```bash
scripts/verify-e2e.sh --docker    # boots the stack AND drives the golden path via API
```

### Path B — no Docker (embedded in-memory mode)

```bash
npm run setup                     # installs node deps + Python 3.12 venv
scripts/verify-e2e.sh             # builds + boots web & scoring, drives golden path, prints PASS
npm run dev -w @hackguard/web     # or run it yourself: http://localhost:3000
```

Without `DATABASE_URL` the app runs on embedded in-memory stores — every feature works,
single-instance, nothing survives a restart. To persist, set `DATABASE_URL` to any
Postgres (local: `createdb` + `psql -f db/migrations/*.sql`, or Neon free tier) and
restart — same commands, durable data.

> First time on the dashboard you'll see honest empty states. Use **“Load demo data”**
> (seeds the canonical stream + replay) or point a Stripe test-mode webhook endpoint at
> `POST /api/webhooks/stripe`.

### Verify everything

```bash
npm run verify          # lint + typecheck + tests (TS strict + mypy strict), both sides
scripts/verify-e2e.sh   # end-to-end golden path over the live API (see docs/VERIFICATION.md)
```

## Configuration

Copy `.env.example` → `.env` (never commit real secrets). Every variable the code reads
is documented there: `DATABASE_URL` (optional Postgres), `SCORING_BASE_URL`,
`STRIPE_WEBHOOK_SECRET` (**test mode only** — HackGuard never processes real charges),
optional Upstash Redis for cross-instance idempotency, and `SCORING_*` sidecar settings.
The Next.js app reads the repo-root `.env` automatically in dev.

## Architecture

```
Stripe test-mode webhooks ──► /api/webhooks/stripe (signature-verified, Zod-validated,
                              idempotent by event id)
        │
        ▼
Deterministic triage engine ──► RETRY_SOFT | NEVER_RETRY_HARD | ASK_CUSTOMER
  (Visa decline categories +   │   rule citations stored with every decision
   Mastercard MACs)            ▼
                        Scoring sidecar (FastAPI, mypy --strict)
                          XGBoost propensity model + timing policy
                          SHAP top-5 contributions per decision
        │                       │
        ▼                       ▼
Compliance guardrail      Next.js dashboard: decision feed, explanation panels,
  (exact network caps,    live A/B recovery counters, compliance ledger view
   hash-chained audit)
```

Every consequential decision is either a deterministic rule or a trained-model score with
SHAP attributions — never an LLM judgment. The optional LLM layer only narrates; it never
decides.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 (TypeScript strict, Tailwind v4) — UI + BFF API routes |
| `services/scoring` | Python 3.12 FastAPI sidecar (mypy `--strict`, Pydantic v2) — XGBoost + SHAP scoring |
| `packages/contracts` | **Single source of truth**: Zod schemas → generated `openapi.json` → generated Pydantic models |
| `packages/typescript-config` | Shared `tsconfig` base |
| `db/migrations` | SQL migrations (`0001` append-only hash-chained audit ledger, `0002` backend core, `0003` decisions) |
| `scripts/verify-e2e.sh` | Boots the stack (Docker or local) and drives the golden path via API |
| `docs/` | Architecture, model methodology (`MODEL.md`), data provenance (`DATA.md`), recorded E2E proof (`VERIFICATION.md`) |

## Common commands

```bash
npm run dev -w @hackguard/web          # Next.js dev server
uv run uvicorn scoring.main:app --reload   # scoring sidecar (in services/scoring)
npx tsx scripts/e2e-drive.ts           # drive the golden path against a running stack
npm run contracts:openapi              # regenerate openapi.json from Zod schemas
npm run contracts:pydantic             # regenerate Python models from openapi.json
```

## Quality standards

- **Strict typing everywhere**: TypeScript `strict`; Python `mypy --strict`; validation at
  every boundary via Zod / Pydantic v2 — no unvalidated input crosses a trust boundary.
- **Single source of truth for contracts**: schemas defined once in `packages/contracts`;
  TypeScript and Python clients are generated, never hand-synced.
- **Tested decision core**: ≥80% coverage on triage, compliance, scheduler, and audit paths;
  property-based tests prove no retry schedule can exceed network caps and hard declines are
  never retried; security tests cover webhook signature rejection, replay attacks, and
  audit-chain tampering.
- **Honest ML**: the model card discloses training-data provenance, evaluation metrics vs.
  baseline, and known limitations. The A/B replay is labeled counterfactual estimation —
  never presented as observed fact. No fake data in any core path.
- **CI parity**: `.github/workflows/ci.yml` runs the exact same suites as local `npm run
  verify` on every push and PR — if local is green, CI is green.

## Status

Under active development for a hackathon entry (AI Revenue Recovery track). See
`docs/architecture.md` for the full design, `docs/VERIFICATION.md` for a recorded
end-to-end verification run, and the commit history for the day-by-day build.

## License

TBD at project completion (will be OSI-approved; dataset and model licenses documented in
`docs/DATA.md` and `services/scoring/docs/MODEL.md`).

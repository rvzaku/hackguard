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
| `db/migrations` | SQL migrations (`0001_audit_log.sql`: append-only hash-chained ledger) |
| `docs/` | Architecture, model methodology (`MODEL.md`), data provenance (`DATA.md`) |

## Quickstart (fresh clone → green in two commands)

Prereqs: Node ≥ 20, [`uv`](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`).

```bash
npm run setup      # 1. installs node deps + creates the Python 3.12 venv
npm run verify     # 2. lint + typecheck + tests for BOTH sides, green
```

What `npm run verify` runs:

- **Node** (`verify:node`): ESLint, `tsc --strict`, Vitest — across `apps/web` and `packages/contracts`
- **Python** (`verify:python`): `ruff check` + `ruff format --check`, `mypy --strict`, `pytest` — in `services/scoring`

## Common commands

```bash
npm run dev -w @hackguard/web          # Next.js dev server
npm run contracts:openapi              # regenerate openapi.json from Zod schemas
npm run contracts:pydantic             # regenerate Python models from openapi.json
uv run uvicorn scoring.main:app --reload   # scoring sidecar (in services/scoring)
```

## Configuration

Copy `.env.example` → `.env` (never commit real secrets). Key vars:
`DATABASE_URL` (Neon Postgres), `SCORING_BASE_URL`, `STRIPE_*` (**test mode only** —
HackGuard never processes real charges).

## Quality standards

- **Strict typing everywhere**: TypeScript `strict`; Python `mypy --strict`; validation at
  every boundary via Zod / Pydantic v2 — no unvalidated input crosses a trust boundary.
- **Single source of truth for contracts**: schemas defined once in `packages/contracts`;
  TypeScript and Python clients are generated, never hand-synced.
- **Tested decision core**: ≥80% coverage on triage, compliance, scheduler, and audit paths;
  property-based tests prove no retry schedule can exceed network caps and hard declines are
  never retried; security tests cover webhook signature rejection, replay attacks, and
  audit-chain tampering.
- **Honest ML**: the model card (`services/scoring/docs/MODEL.md`) discloses training data
  provenance, evaluation metrics vs. baseline, and known limitations. No fake data in any
  core path.
- **CI parity**: `.github/workflows/ci.yml` runs the exact same suites as local `npm run
  verify` on every push and PR — if local is green, CI is green.

## Status

Under active development for a hackathon entry (AI Revenue Recovery track). See
`docs/architecture.md` for the full design and the commit history for the day-by-day build.

## License

TBD at project completion (will be OSI-approved; dataset and model licenses documented in
`docs/DATA.md` and `services/scoring/docs/MODEL.md`).

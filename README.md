# HackGuard

Free, self-hostable decision brain above Stripe's built-in retries for small SaaS:
deterministic triage (retry / never-retry / ask-customer), model-timed retries,
Visa/Mastercard compliance guardrails, and a hash-chained audit ledger — with a
plain-English "why" on every decision. See `docs/architecture.md` and the project
plan for the full picture.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 (TypeScript strict, Tailwind v4) — UI + BFF API routes |
| `services/scoring` | Python 3.12 FastAPI sidecar (mypy `--strict`, Pydantic v2) — XGBoost + SHAP scoring |
| `packages/contracts` | **Single source of truth**: Zod schemas → generated `openapi.json` → generated Pydantic models |
| `packages/typescript-config` | Shared `tsconfig` base |
| `db/migrations` | SQL migrations (`0001_audit_log.sql`: append-only hash-chained ledger) |
| `docs/` | Architecture & protocol docs |

## Quickstart (fresh clone → green in two commands)

Prereqs: Node ≥ 20, [`uv`](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`).

```bash
npm run setup      # 1. installs node deps + creates the Python 3.12 venv
npm run verify     # 2. lint + typecheck + tests for BOTH sides, green
```

What `npm run verify` runs:

- **Node** (`verify:node`): ESLint + Prettier-adjacent checks, `tsc --strict`, Vitest — across `apps/web` and `packages/contracts`
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
`DATABASE_URL` (Neon Postgres), `SCORING_BASE_URL`, `STRIPE_*` (test mode only).

## CI

`.github/workflows/ci.yml` runs the same `verify:node` / `verify:python` suites
on every push/PR. Local parity is exact — if `npm run verify` is green, CI is green.

# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Project notes

- Two-command verification (fresh clone): `npm run setup` then `npm run verify` — runs lint + typecheck + tests for both sides. Local scripts mirror CI exactly (`.github/workflows/ci.yml`).
- Contracts flow is one-way: Zod in `packages/contracts/src/` → `npm run contracts:openapi` → `openapi.json` → `npm run contracts:pydantic` → `services/scoring/src/scoring/contracts_gen.py`. Never hand-edit `openapi.json` or `contracts_gen.py`; a pytest enforces sync.
- Python toolchain is uv-managed (Python 3.12 pinned, `.venv` in `services/scoring`); use `uv run ...` inside that directory.
- Sharp edge: `datamodel-codegen` output formatting depends on the `--output` path; always generate to a temp file and copy (`scripts/gen-pydantic.sh` does this) or the drift test fails spuriously.
- Backend core (webhook/triage/compliance/scheduler/audit/replay) lives in `apps/web/src/lib`; see `docs/architecture.md` §Backend core for the module map. Route tests inject stores via `setRuntimeForTests()` (`src/lib/runtime.ts`) — never stub globals.
- Web coverage gates (≥80% on triage/compliance/scheduler/audit) run via `vitest --coverage` in `apps/web` (`npm run test -w @hackguard/web`); adding files under those dirs pulls them into the threshold.
- Model training: `npm run model:train` (seeded small-sample smoke, runs in CI) or `npm run model:train:full` (full cohort, writes the committed `models/registry/` artifact). Data source is SHA-256-pinned — provenance and license in `docs/DATA.md`; methodology in `docs/MODEL.md`.
- Sharp edge (macOS): xgboost needs the OpenMP runtime — `brew install libomp` — or every `uv run` touching xgboost fails with a dlopen error.
- Python test gate includes a coverage floor on the ML core (`scoring.preprocessing`/`policy`/`inference` >=80%, enforced in `scripts/verify-python.sh` and CI).
- Adversarial eval loop: `npm run eval:loop` regenerates the committed artifact `models/registry/eval-loop-v1/metrics.json` (seeded simulator → baseline-vs-policy grading → deterministic grid hill-climb, `apps/web/src/lib/eval/`). `/api/eval-loop` re-validates that JSON through `EvalLoopArtifactSchema` at request time — regenerate the artifact whenever the simulator/grader change, or the route/UI render stale numbers.
- E2E: `scripts/verify-e2e.sh` (local, embedded stores) or `--docker` (compose stack) boots the stack and drives the golden path via `scripts/e2e-drive.ts`; recorded passing output lives in `docs/VERIFICATION.md`. UI golden path: `npx playwright test` in `apps/web` (needs `STRIPE_WEBHOOK_SECRET`, set by `playwright.config.ts`).
- Sharp edge: Next.js bundles each route separately — module-level singletons are NOT shared across route handlers. The composed runtime must stay cached on `globalThis` in `apps/web/src/lib/runtime.ts`; don't revert to plain module variables.
- Docker: both images build with the repo root as context (`docker compose up --build`); Postgres migrations apply via the initdb mount of `db/migrations`. Scoring image relies on `PYTHONPATH=/app/src` + `SCORING_MODEL_DIR=/models/registry` (see `services/scoring/Dockerfile`).
- Production deploy: Vercel project `getyourfit/hackathon`, live at https://hackathon-getyourfit.vercel.app (CLI: `vercel deploy --prod --scope getyourfit`). Env on the project: only `STRIPE_WEBHOOK_SECRET` (test value `whsec_hackguard_demo_2026`, set 2026-08-22). No `SCORING_BASE_URL` and no deployed sidecar → cloud runs in disclosed degraded mode (published-curve fallback, actor RULE, no SHAP); no `DATABASE_URL` → in-memory stores per serverless instance, so decision-feed rows can fragment across instances (re-send events to converge). Pitch package in `docs/pitch/` documents all of this.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

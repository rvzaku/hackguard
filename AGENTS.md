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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

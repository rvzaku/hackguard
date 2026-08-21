# RUBRIC-MAP.md — judging criteria → concrete evidence

Every row points at something that exists in the repo or on the deployed URL (https://hackathon-getyourfit.vercel.app, verified 2026-08-22). No aspirational claims.

## Technology

| Criterion | Evidence |
|---|---|
| Real ML with honest evaluation | XGBoost propensity model, held-out AUC 0.631 / PR-AUC 0.880 / ECE 1.34% vs constant & rule baselines — `models/registry/propensity-v1.0.0/{metrics.json,eval_report.md}`, methodology in `docs/MODEL.md` |
| Strict typing end-to-end | TS `strict` + Zod; Python `mypy --strict` + Pydantic v2; generated contracts (`packages/contracts` → `openapi.json` → `contracts_gen.py`, sync enforced by pytest) |
| Security engineering | HMAC signature verification w/ stale-timestamp rejection, event-id dedupe, replay rejection, hash-chained append-only audit ledger — `apps/web/src/lib/{stripe,audit,idempotency.ts}`; asserted in `scripts/e2e-drive.ts`; bad signature → typed 400 verified live |
| Property-based compliance proofs | No schedule can exceed Visa 15/30d or MC 10/24h+35/30d caps; hard declines never retried — `apps/web/src/lib/compliance/guardrail.ts` + fast-check suites |
| Test/coverage gates | ≥80% coverage enforced on triage/compliance/scheduler/audit (web) and scoring core (Python); CI parity via `.github/workflows/ci.yml`; recorded E2E in `docs/VERIFICATION.md` |

## Design

| Criterion | Evidence |
|---|---|
| Explainable by default | Per-decision why-panel: action badge, P(recover), scheduled moment, rule citations, model version, SHAP top-5 in plain English — `apps/web/src/components/ExplanationPanel.tsx`, `shap-copy.ts` |
| Honest empty/degraded states | Empty states guide setup ("Load demo data"); degraded mode is *labeled* (`degraded:true`, actor `RULE`, fallback model version) instead of hidden — `components/states.tsx`, `scheduler.ts` |
| One-click demo path | "Load demo data" button seeds stream + replay in one click — verified live; cold-clone quickstart <5 min documented in `README.md` |
| Trust typography | Counterfactual caption rendered verbatim under the money counters; red-team controls styled as destructive (red) vs verification (neutral) — `ReplayCounters.tsx`, `ComplianceLedger.tsx` |

## Impact

| Criterion | Evidence |
|---|---|
| Sized problem | >$129B/yr failed-payment churn, ~13% of attempts fail (Recurly) — cited in `README.md` §Why this exists with source |
| Quantified lift on identical input | A/B replay: $98.00 baseline vs $390.00 policy over the same 12-failure stream — live counters, `/api/replay` |
| Penalty-fee avoidance | Eval artifact: baseline $993.40 penalty exposure / 100 violations vs policy 0 — `models/registry/eval-loop-v1/metrics.json`; per-scenario `penalty-traps`: baseline net −$450.00 |
| Targets the underserved tier | Free/self-hostable for $5k–$50k MRR SaaS priced out by $250–700+/mo incumbents — `README.md`, `PITCH.md` §Business model |

## Deployment

| Criterion | Evidence |
|---|---|
| Publicly deployed | https://hackathon-getyourfit.vercel.app (Vercel, production alias) — golden path driven live during this package's verification |
| One-command self-host | `docker compose up --build` (Postgres migrations auto-applied) or embedded no-Docker mode — `README.md` §Quickstart, `docker-compose.yml` |
| E2E proven, not asserted | `scripts/verify-e2e.sh` boots stack and drives signed ingest → triage → guardrail → replay → ledger → tamper check; output recorded in `docs/VERIFICATION.md` |
| Failure-mode engineering | Scoring-timeout fallback (2.5s), degraded-mode disclosure, malformed-event quarantine (typed 422), rate-limit/DB-outage tests — plan §6 suites in repo |

## Business value

| Criterion | Evidence |
|---|---|
| Clear wedge pricing | Open-core free → hosted $49/mo → audit pack $199/yr; undercuts incumbents' floor while monetizing ops/attestation, not core features — `PITCH.md` §Business model |
| Upsell already built | The paid artifact (hash-chained compliance ledger + rule citations) ships in the free core today — live ledger view |
| Distribution economics | $0 COGS on free-tier infra (Vercel/Neon/Render), keep-alive strategy for demo window — plan §3, `.env.example` |
| Defensibility story | Verifiability (SHAP + citations + tamper-evident ledger) as moat closed competitors can't match without opening their core — `QA.md` Q6 |

## Originality

| Criterion | Evidence |
|---|---|
| Compliance-first framing (novel) | Network retry rules as first-class, property-tested, citation-stamped constraints on an ML scheduler — not a disclaimer — `guardrail.ts`, triage rules |
| Adversarial eval loop | Committed, seeded, deterministic round-by-round policy-tuning artifact served to the UI and re-validated through the schema at request time — `apps/web/src/lib/eval/*`, `/api/eval-loop`, panel shows 27.4%→39.3% climb live |
| Honesty as a feature | Contract-enforced counterfactual captions, disclosed degradation, committed model cards with negative results (rule baselines) — unusual and judge-friendly |
| No LLM theater | Zero LLM calls in any consequential decision path; LLM would only narrate — plan §8 non-goals, architecture doc |

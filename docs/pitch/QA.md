# HackGuard — the 15 hardest judge questions, with prepared answers

Format: question → ≤60-word answer → evidence link. All live-URL behaviors were verified on 2026-08-22 against https://hackathon-getyourfit.vercel.app.

---

**1. What breaks first at scale?**
The in-memory idempotency and stores: they're per-instance, so horizontal scale fragments state. First fix is already coded — `DATABASE_URL` (Postgres) plus Upstash Redis for cross-instance event-id dedupe; both are drop-in via `runtime.ts`. Second: the scoring sidecar needs autoscaling behind its 2.5s client timeout.
→ `apps/web/src/lib/runtime.ts`, `apps/web/src/lib/stores/postgres.ts`, `.env.example`.

**2. Why not just use Stripe Smart Retries?**
Smart Retries optimizes *when* to retry retryable codes; it doesn't triage hard declines away from penalty-incurring attempts or prove compliance. Our eval artifact shows a fixed schedule recovering 35.7% while accruing **$993.40 penalty-fee exposure**, versus our policy's 39.3% at **zero violations** — suppression of never-retry codes is value Stripe leaves on the table.
→ `models/registry/eval-loop-v1/metrics.json` (`baselineMetrics` vs `summary`).

**3. You trained on loan data — how do loans transfer to card retries?**
Deliberately hybrid and disclosed: the propensity model learns *who cures when dunned* from 16,834 matured Lending Club delinquency records (AUC 0.631 held-out, ECE 1.3%); retry *timing* comes from published recovery-by-attempt curves; calibration happens against live Stripe test streams. We claim lift over baselines, not oracle knowledge.
→ `docs/DATA.md`, `docs/MODEL.md`, `models/registry/propensity-v1.0.0/eval_report.md`.

**4. Your A/B "recovered dollars" — isn't that counterfactual hand-waving?**
Yes, and we label it so: the UI caption "counterfactual estimation validated against published recovery curves" is enforced verbatim by the API contract — the response fails validation without it. The eval-loop simulator is seeded, deterministic, and committed, so any judge can reproduce every number.
→ `apps/web/src/components/ReplayCounters.tsx` (docstring), `models/registry/eval-loop-v1/metrics.json` (`methodology`, `seed`).

**5. What's your security posture?**
No unvalidated input crosses a boundary (Zod/Pydantic everywhere); webhook signatures HMAC-verified with stale-timestamp rejection before any side effect; replayed event ids deduped; forged signatures return typed 400 `INVALID_SIGNATURE`; audit ledger is append-only SHA-256 hash-chained with a tamper-detection endpoint. Test-mode only — the system physically cannot move real money.
→ `scripts/e2e-drive.ts` assertions 2–4 & 7; verified live: bad signature → HTTP 400.

**6. Funded competitors exist (Slicker, Churnkey, Churnfighter…). What's the moat?**
They're closed, priced $250+/mo, and Stripe-native-only in practice. Our moat is *verifiability*: rule citations on every decision, SHAP explanations, and a hash-chained ledger an auditor can check — plus open-core distribution at $0 COGS on free-tier infra. Incumbents can't open-source their decision core without giving away the pricing tier they monetize.

**7. Is the ML actually doing anything, or is it rules theater?**
Both layers are load-bearing and separated: deterministic rules own *whether* a retry may happen (compliance is not a model's job); the model owns *when* maximizes P(recover). Held-out AUC 0.631 vs 0.500 constant and ~0.57 best single-rule baseline; per-decision SHAP top-5 served under the frozen contract.
→ `models/registry/propensity-v1.0.0/metrics.json` (`baselines` array), `services/scoring`.

**8. Show me the model can't be silently wrong or stale.**
Every decision carries `modelVersion`; the registry commits metrics alongside artifacts (`propensity-v1.0.0`, `eval-loop-v1`); degraded fallbacks are flagged `degraded:true` and recorded as actor `RULE` in the ledger — the system discloses when it's *not* using the model rather than pretending.
→ `apps/web/src/lib/scheduler/scheduler.ts` (`FALLBACK_MODEL_VERSION`), verified live: RETRY decisions show `published-curve-fallback-v1`.

**9. Compliance: how do you know your caps match Visa/Mastercard exactly?**
The numbers are constants transcribed from the network programs and cited in-app: Visa Cat-1 never-retry, 15 reattempts/30d RAF regime; Mastercard TPE 10/24h and 35/30d at $0.15 over cap; MAC 01/03/21 do-not-retry. Property-based tests prove no scheduler output can exceed caps and hard declines are never retried.
→ `apps/web/src/lib/compliance/guardrail.ts` (`CAPS`), triage/compliance test suites.

**10. A judge POSTs garbage or replays a captured webhook — what happens?**
Three layers: signature check fails first (typed 400); schema validation rejects malformed envelopes (typed 422 `SCHEMA_VALIDATION_FAILED`); a genuine re-delivery of a valid event dedupes with `{"deduped":true}` and no double side effects. All three were exercised live during verification.
→ `apps/web/src/app/api/webhooks/stripe/route.ts`; verified live 2026-08-22.

**11. Someone tampers with your audit ledger to hide a violation — then what?**
Each entry hashes `prevHash + payload`; `/api/audit/verify` recomputes the chain and reports `brokenAtSeq` on any mutation. The dashboard's Verify-chain button runs it live: "Chain intact — N entries verified" today; any edit breaks it deterministically.
→ `apps/web/src/lib/audit/chain.ts`, `apps/web/src/app/api/audit/verify/route.ts`; verified live.

**12. Why is any of this free? What's the catch?**
Open-core is the go-to-market: free self-hosted core builds trust in exactly the artifact merchants must audit (their compliance posture); paid tiers sell hosted operations and auditor-ready exports, not core features. Free-tier infra keeps $0-COGS real: Vercel Hobby + Neon + Render, with keep-alive for cold starts.
→ `docker-compose.yml`, `PITCH.md` §Business model.

**13. Your cloud demo has no SHAP panel — why should we believe SHAP works?**
Because degradation is disclosed, not hidden: the deployment flags `degraded:true`, serves `published-curve-fallback-v1` as the model version, and records `RULE` as the audit actor. Run the stack locally (`npm run setup`, `scripts/verify-e2e.sh`) and the same feed renders XGBoost+SHAP top-5 drivers per decision — the E2E driver asserts it.
→ `scripts/e2e-drive.ts` ("at least one RETRY carries SHAP attributions"), `docs/VERIFICATION.md`.

**14. What about false negatives — a customer gets dunning emails for a card that will never cure?**
ASK_CUSTOMER decisions route to dunning only when triage says customer action can help (expired card, CVC); unknown declines ask instead of retrying precisely because blind retries draw fees. Frequency is capped by the same guardrail caps, and every send would be a ledger entry — bounded blast radius by construction.
→ `apps/web/src/lib/triage/rules.ts` (`POLICY-*` rules), guardrail caps above.

**15. What would you build in the next 30 days if you won?**
In order: attach the scoring sidecar to the deployed URL (removes limitation #1), turn on Neon durability for the demo org, ship the dunning email loop with model-scored timing (orchestrator is scaffolded), add PSP abstraction beyond Stripe, and pilot the audit-pack export with two design partners from the SMB tier the pricing targets.
→ plan §9 cut order; `services/scoring/Dockerfile` ready to deploy.

---

### One-line answers to likely follow-ups

- **"Is this just a cron job?"** — No: signed ingest, typed contracts, property-tested compliance caps, tamper-evident ledger, and a served model artifact with committed metrics.
- **"Can I run it?"** — `git clone && docker compose up --build`, click "Load demo data"; cold-clone quickstart is a documented acceptance criterion (`README.md` §Quickstart).
- **"Did you fake any numbers?"** — No synthetic data in core paths; the seed stream is labeled `synthetic-seed` at the contract level and used only for replay demos.

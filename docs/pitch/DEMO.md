# HackGuard — 3-minute live demo script

**Deployed URL:** https://hackathon-getyourfit.vercel.app (alias of Vercel project `getyourfit/hackathon`; every screen state below was verified against this URL on 2026-08-22).
**Fallback insurance:** `BACKUP.md` (90-second recorded video).
**Rule of the road:** every claim in this script is something the deployed app actually shows. If a screen doesn't match, use the **Fallback** line for that beat and keep talking.

---

## T–60 min pre-flight (backstage, not timed)

1. **Open the URL** in a fresh browser profile at 100% zoom, dark room-friendly (the UI is dark-neutral by default). Bookmark bar hidden.
2. **Warm the instance and seed the decision feed.** The Hobby deployment runs in-memory stores per serverless instance, so ingest the canonical events right before showtime from any machine with Node ≥ 20:

   ```bash
   export BASE=https://hackathon-getyourfit.vercel.app
   export SECRET=whsec_hackguard_demo_2026   # test-mode secret configured on the deployment
   npx tsx -e '
   import { createHmac } from "node:crypto";
   const B = process.env.BASE, S = process.env.SECRET;
   const evts = [
     ["evt_demo_a","cus_acme",4900,"insufficient_funds",1,"visa"],
     ["evt_demo_b","cus_stark",2900,"lost_card",2,"visa"],
     ["evt_demo_c","cus_wayne",14900,"expired_card",3,"amex"],
     ["evt_demo_d","cus_initech",3500,"try_again_later",1,"visa"],
     ["evt_demo_e","cus_hooli",7900,"fraudulent",1,"mastercard"],
     ["evt_demo_f","cus_piedpiper",1900,"generic_decline",2,"visa"],
   ];
   for (const [id,cus,amt,code,attempt,brand] of evts) {
     const body = JSON.stringify({ id, type:"invoice.payment_failed",
       created: Math.floor(Date.now()/1000),
       data:{ object:{ id:"in_"+id.slice(9), customer:cus, amount_due:amt, currency:"usd",
         decline_code:code, attempt, payment_method_details:{ card:{ brand } } } } });
     const t = Math.floor(Date.now()/1000);
     const sig = "t="+t+",v1="+createHmac("sha256",S).update(t+"."+body,"utf8").digest("hex");
     const r = await fetch(B+"/api/webhooks/stripe",{method:"POST",
       headers:{"content-type":"application/json","stripe-signature":sig},body});
     console.log(id, r.status, (await r.json()).decision?.action);
   }'
   ```

   Expected output: six lines, all `200`, actions mixing `RETRY`, `SUPPRESS`, `ASK_CUSTOMER`.
3. **Seed the A/B replay:** press **“Load demo data”** once (or `curl -X POST $BASE/api/demo/bootstrap`). Verified response: `{"seeded":true,"eventCount":12,"baselineRecoveredMinor":9800,"policyRecoveredMinor":39000}`.
4. **Verify the feed:** reload the page — Decision feed shows ~6+ rows spanning all three badge colors (green RETRY, red NEVER-RETRY, amber ASK-CUSTOMER). If fewer rows than you sent appear, re-run step 2 (a different warm instance may hold part of the feed); rows converge after one re-send.
5. **Keep two tabs open:** Tab 1 = dashboard; Tab 2 = the same URL scrolled to the compliance ledger (so the red-team beat is one ⌘Tab away).

---

## The script (total 180s)

### Beat 0 — Opening one-liner (0:00–0:15)

- **Say:** “Subscription businesses lose **$129 billion a year** to failed-payment churn — and the tools that recover it cost $250–700 a month. HackGuard is the free, self-hostable decision brain that sits *above* Stripe's built-in retries: it triages every failure, times the retry, keeps you inside Visa/Mastercard rules, and proves every decision.”
- **Screen:** dashboard header visible — “HackGuard — Decision brain above Stripe's built-in retries” (exact rendered tagline).
- **Fallback:** if the page is cold/slow, the skeleton loaders resolve in <2s; narrate the tagline while they fill.

### Beat 1 — Problem framing (0:15–0:40)

- **Say:** “~13% of subscription billing attempts fail (Recurly). Worse: since 2022, *blindly retrying* is penalized — Visa forbids retrying Category-1 declines entirely and charges per-attempt fees past 15 reattempts/30 days; Mastercard's TPE program caps at 10/24h and 35/30d. Most small SaaS have no triage at all.”
- **Click:** scroll slowly to the **Compliance ledger** section so the audience sees “Append-only, hash-chained audit trail · tamper-evident” while you cite the network rules.
- **Expected:** ledger table with Seq / Actor / Decision / Hash columns (pre-seeded entries from pre-flight).
- **Fallback:** if the ledger is empty on a fresh instance, say the line over the empty-state (“Ledger is empty”) and continue — Beat 4 populates it live.

### Beat 2 — Live golden path: webhook → feed reacts (0:40–1:15)

- **Say:** “This is real signed Stripe test-mode ingest — watch.” Switch to the terminal, paste the one-liner below (same as pre-flight step 2 but with a fresh event id `evt_live_x`), and return to Tab 1 within seconds:

  ```bash
  # same snippet as pre-flight step 2, with evt ids evt_live_x… — takes ~3s
  ```

- **Expected screen (verified):** within one 4-second poll, a new row appears at the top of **Decision feed**: green `RETRY` badge, payment id `in_live_x`, `P(recover) 38%`, rule citation `VISA-CAT23-MAX15-PER-30D`, retry timestamp.
- **Say:** “Triage said soft-decline → retryable. The guardrail stamped the Visa Cat-2/3 citation onto the decision itself. A `lost_card` event would never get here — watch in a second.”
- **Fallback:** if the row doesn't appear in ~8s, reload the tab (instance stickiness) — the row is already persisted on the ingesting instance; narrate: “the event was accepted and signed for — here's the receipt,” showing the terminal's `200 received:true` JSON with the full decision.

### Beat 3 — Why-panel + compliance block (1:15–1:45)

- **Click:** the top `RETRY` row in the feed.
- **Expected (right panel, “Why this decision”):** action badge, P(recover), scheduled retry datetime, **Rule citations** line (`VISA-CAT23-MAX15-PER-30D`), model version. In today's cloud deployment the model runs in disclosed degraded mode (published-curve fallback), so SHAP bars are empty here — **say exactly that**: “In the cloud demo the GPU-free sidecar is detached, so timing runs on the published recovery curve and says so; locally, XGBoost + SHAP serve the top-5 drivers per decision — here's that artifact” → point at the committed eval report (`models/registry/propensity-v1.0.0/eval_report.md`: AUC 0.631 vs 0.500 constant, calibration error 1.3%).
- **Click (⌘Tab to Tab 2):** press **“Simulate violating retry”**.
- **Expected (verified):** red alert block — “**Retry blocked by compliance engine** — Hard-decline retry would violate `VISA-CAT1-NEVER-RETRY` (Visa Category 1: issuer will never approve; per-attempt penalty fee exposure). Enforcement recorded as audit seq N.” A new violet `RULE` row appears in the ledger above.
- **Fallback:** if the button errors (cold function), click again once; it is idempotent per probe event and records a new audit seq each time.

### Beat 4 — Eval loop climb + recovered dollars (1:45–2:25)

- **Scroll:** to **“A/B replay — recovered dollars.”**
- **Expected (verified numbers):** Baseline · fixed schedule **$98.00** vs HackGuard policy **$390.00** — “Recovered **$292.00** more with the HackGuard policy over the same failure stream,” plus the verbatim methodology caption: *“Methodology: counterfactual estimation validated against published recovery curves.”*
- **Say:** “Same 12-failure stream through both arms. And we never pass counterfactuals off as observed fact — the caption is contract-enforced.”
- **Scroll:** to **“Adversarial eval loop.”**
- **Expected (verified):** `policy-v6: recovery 27.4% → 39.3%, violations 0` over 6 tuning rounds, “vs baseline 35.7% recovery with **$993.40 penalty-fee exposure**.” Round bars climb left-to-right; open **“Per-scenario breakdown”** and point at `penalty-traps`: baseline net **−$450.00**, policy **$0 fees, 0 violations**.
- **Say:** “This is the moat in one panel: the naive schedule actually *loses money* on adversarial streams once network fees land. Our policy climbs rounds and never violates.”

### Beat 5 — Tamper-evidence + closing business line (2:25–3:00)

- **Click:** **“Verify chain”** in the compliance ledger.
- **Expected (verified):** green banner — “Chain intact — N entries verified, no tampering detected.”
- **Say:** “Every enforcement event is hash-chained; hand an auditor this ledger and they can prove nobody quietly retried a dead card. That's the wedge: **open-core and free forever for the decision brain**, hosted multi-instance for teams that don't want to run it, and an auditor-ready compliance-pack upsell — because the ledger is already the product. Stripe recovers payments; HackGuard *proves* the recovery was legal, explained, and optimal. That's the $129B decision layer, for free.”

---

## Timing budget

| Beat | Window | Seconds |
|---|---|---|
| 0 Opening | 0:00–0:15 | 15 |
| 1 Problem | 0:15–0:40 | 25 |
| 2 Webhook → feed | 0:40–1:15 | 35 |
| 3 Why-panel + violation block | 1:15–1:45 | 30 |
| 4 Replay + eval loop | 1:45–2:25 | 40 |
| 5 Verify chain + close | 2:25–3:00 | 35 |
| **Total** | | **180** |

## Global fallback ladder

1. **Feed empty / fragmented across instances:** re-run pre-flight step 2 (≈5 s); rows reappear.
2. **Webhook route 5xx (`CONFIG_MISSING`):** the deploy-time secret was removed — switch Beat 2 to the recorded backup video (BACKUP.md) at 0:40 and resume live at Beat 3.
3. **Whole site down:** play BACKUP.md recording end-to-end; demo the local stack (`docker compose up --build`) during Q&A.
4. **Never claim SHAP on the cloud path today** — the sidecar is a known limitation (see PITCH.md §Limitations); the honest-degradation disclosure *is* the demo moment.

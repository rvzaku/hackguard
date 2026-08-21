# BACKUP.md — 90-second recorded video (wifi insurance)

**Purpose:** if the live demo dies (wifi, cold starts, provider outage), play this recording. It shows the *same* golden path as `DEMO.md`, recorded against the deployed URL while it works.

**Output:** `docs/pitch/backup-demo.mp4` — 1920×1080, 90s, screen + microphone. Record with QuickTime (macOS: File → New Screen Recording, select display + mic) or OBS. Do one take per section; stitch cuts at the beat boundaries listed below — cuts between beats are fine and keep the pace tight.

---

## Pre-roll (before recording)

1. Run `DEMO.md` pre-flight steps 1–4 (seed feed via signed webhooks, press "Load demo data", confirm ~6 feed rows and replay counters $98.00 / $390.00).
2. Close all tabs except the dashboard; hide bookmarks; set browser zoom 100%; quit notification-bearing apps (`defaults`-silence Slack/Mail).
3. Terminal open on the signed-ingest snippet from DEMO.md pre-flight step 2, ids renamed `evt_rec_*`.
4. Rehearse once for pacing; each beat below has a hard second budget.

## Recording script (90 seconds total)

| Time | On screen | Say (verbatim) | Expected frame |
|---|---|---|---|
| 0:00–0:08 | Dashboard top | "HackGuard — the free decision brain above Stripe's retries: triage, timed retries, network-rule guardrails, provable audit." | Header + tagline visible |
| 0:08–0:20 | Terminal → dashboard | "Real signed Stripe test-mode webhook…" paste snippet, ⌘Tab back | New RETRY row appears within one poll; citation `VISA-CAT23-MAX15-PER-30D` readable |
| 0:20–0:32 | Click top row | "Every decision explains itself — action, probability, scheduled moment, rule citations." | Why-panel populated |
| 0:32–0:44 | Compliance ledger tab | Click **Simulate violating retry**: "A lost card is Visa Category-1 — never retry. We block it and cite the rule." | Red block: "Retry blocked by compliance engine … VISA-CAT1-NEVER-RETRY"; new RULE row in ledger |
| 0:44–0:58 | A/B replay panel | "Same failure stream, both arms: baseline recovers $98 — HackGuard $390. Labeled counterfactual estimation, contract-enforced caption." | Counters $98.00 vs $390.00 + methodology line |
| 0:58–1:12 | Eval loop panel | "On adversarial streams the naive schedule loses money to penalty fees — $993 exposure. Our policy climbs six tuning rounds to 39% recovery, zero violations." | `policy-v6: recovery 27.4% → 39.3%, violations 0`; round bars ascending |
| 1:12–1:24 | Ledger, click **Verify chain** | "Hash-chained ledger: auditors can prove nobody quietly retried a dead card." | Green banner "Chain intact — N entries verified" |
| 1:24–1:30 | Dashboard top | "Stripe recovers payments. HackGuard proves the recovery was legal, explained, and optimal — free." | Hold on header |

## Post-production checklist

- [ ] Total ≤ 90s; audio normalized (-16 LUFS); no dead air > 1.5s.
- [ ] Cuts only at beat boundaries; add a 0.5s crossfade if terminal↔browser jumps feel abrupt.
- [ ] Burn-in captions for the two stat lines ($129B problem framing lives in the pitch deck, not this video — keep the video product-only).
- [ ] Export H.264 1080p, <40MB; commit as `docs/pitch/backup-demo.mp4` **only if repo size policy allows**, otherwise keep in shared demo drive and link from here.
- [ ] Verify playback on a second device.

## Day-of decision tree

- Wifi healthy → live demo (`DEMO.md`).
- Live URL degraded but reachable → live Beats 0–1, switch to video at Beat 2, resume live at Beat 5.
- No connectivity → play this video start-to-finish; offer local Docker stack (`docker compose up --build`) during Q&A.

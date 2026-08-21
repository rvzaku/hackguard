# Model methodology — HackGuard timing model (propensity + policy)

This document is the honest-methodology disclosure the plan (§3, "ML design
— honesty-first") requires. It explains what the model is trained on, how
the two components combine, exactly where loan→payment transfer is an
analogy rather than a measurement, and what the model cannot know.

## Two-component design

HackGuard's P(recover | moment) is **not** one model. It is:

1. **Propensity model** (`models/registry/propensity-v1.0.0`, served by
   `scoring/inference.py`) — XGBoost gradient-boosted trees trained on real,
   labeled outcomes: Lending Club delinquent-loan recovery. It answers
   *"how likely is this payer, with these characteristics, to recover at
   all?"* Held-out metrics are committed next to the artifact
   (`metrics.json`, `eval_report.md`).
2. **Timing policy** (`scoring/policy.py`) — a deterministic, unit-tested
   module encoding published recovery-by-attempt/timing priors from Recurly,
   Slicker, and Stripe (each constant cites its source inline). It answers
   *"which candidate moment has the best odds?"*

Combination is in odds space:
`P(recover|moment) = sigmoid(logit(propensity) + log(timing_factor))`.
A factor of 1.0 leaves propensity unchanged; factors multiply recovery
odds. The propensity component is learned from real labels; the timing
component is published priors, not learned — there is no card-retry outcome
data to learn it from (see Limitations).

## Component 1: propensity model

### Data & label

Source: Lending Club public loan file 2007–2011 (provenance, hash pin, and
license discussion in `docs/DATA.md`). The cohort is every loan that went
delinquent post-issuance (n = 16,834). Label:

- **1 ("cured")** — the loan later reached Fully Paid;
- **0 ("never recovered")** — the loan charged off.

This is the payer-recovery analogy: among payers who fell behind, who came
back and paid versus who never did. Base rate: 81.3% cured.

### Features and the loan→payment mapping

The model consumes 10 features (fixed order in `scoring/preprocessing.py`).
At serving time each Stripe payment maps into that space; the mapping is
the disclosed analogy:

| Model feature | Payment-side source | Status |
|---|---|---|
| `amount_log` | `amountMinor` (log1p dollars) | direct analog |
| `int_rate` | decline-code family → risk-tier band proxy (soft 12% / review 16.5% / hard 23%) | **proxy** |
| `emp_length_years` | customer tenure days (capped 10y) | **proxy** |
| `delinq_2yrs` | failed-attempt count − 1 (capped 10) | **proxy, near-zero signal** |
| `term_months`, `dti`, `inq_last_6mths`, `revol_util`, `open_acc`, `total_acc` | unavailable → imputed at exact training medians | constants |

The imputation constants are shared code between training and serving
(`IMPUTED_MEDIANS`), so train/serve skew is impossible by construction.
Constant features carry zero SHAP contribution per payment.

### Training protocol

- Stratified 60/20/20 train/validation/test split, seed 42; early stopping
  watches validation only; the test split is evaluated exactly once.
- `hist` tree method, depth 4, η=0.1; full hyperparameters in `meta.json`.
- Determinism: retraining with the same seed/sample reproduces
  byte-identical artifacts (verified).

### Held-out results (test n = 3,367)

| Scorer | AUC | PR-AUC | Brier |
|---|---|---|---|
| **XGBoost propensity v1** | **0.6311** | **0.8796** | **0.1456** |
| constant base rate | 0.5000 | 0.8178 | 0.1495 |
| rule: delinq_2yrs = 0 | 0.4960 | 0.8195 | 0.3676 |
| rule: int_rate ≤ 13 | 0.5804 | 0.8507 | 0.4664 |
| rule: dti ≤ 15 | 0.5324 | 0.8351 | 0.4130 |
| rule: sum of the three | 0.5715 | 0.8533 | — |

The model beats every simple rule on both ranking metrics and Brier score.
Calibration is strong: ECE 0.0134; every populated reliability bin tracks
the diagonal within ~2pp (full curve in `metrics.json` /
`eval_report.md`). Honest reading: AUC 0.63 is **moderate** discrimination
— useful for triage ordering, not a crystal ball.

## Component 2: timing policy

Encoded priors (sources retrieved 2026-08-21, cited inline in code):

- **Attempt decay** — first retry strongest (40–60% of eventual soft-decline
  recoveries), steep drop after attempt 3 (Slicker, June 2026).
- **Recency** — flat within 10 days of failure, exponential decay after
  (Recurly: 90% of recoveries occur within 10 days).
- **Payday cycle** — boost for days 1–5 and 15–16, mild month-end boost
  (Slicker).
- **Hour of day** — morning best, overnight worst (qualitative basis:
  Stripe's Smart Retries write-up).
- **Decline family** — soft declines reward prompt retry; hard declines are
  heavily down-weighted (suppression itself remains the deterministic
  compliance engine's job, plan §2.4).

All functions are pure and deterministic; `tests/test_policy.py` pins their
shape (monotonicity, anchors, bounds).

## Explanations (SHAP)

Per-decision explanations are TreeSHAP values computed at request time via
XGBoost's native `pred_contribs` — the same algorithm `shap.TreeExplainer`
runs for XGBoost models. Values are signed log-odds contributions summing
to the model margin (additivity is unit-tested); the API returns the top 5
by absolute contribution.

## Serving

- Registry: `models/registry/<version>/` committed to the repo; loading is
  pinned by version (`SCORING_MODEL_VERSION`, default `propensity-v1.0.0`)
  with feature-name and version-consistency checks at load time.
- Endpoints: `POST /v1/score/moments` (per-moment P(recover), shapTop5,
  modelVersion) and `POST /v1/score` (single Decision from a default
  +1d/+3d/+7d schedule). p95 latency budget <200ms asserted in tests
  (measured ~1ms locally).
- Retraining: `npm run model:train` (small-sample smoke, CI) or
  `npm run model:train:full` (full cohort → registry artifact).

## Limitations (read before trusting any number)

1. **No public card-retry outcome data exists.** No dataset of card-on-file
   retry attempts with outcomes is publicly available. That is why the
   design is two-component: only the payer-propensity half is trained on
   real labeled outcomes; the timing half is published priors encoded as
   deterministic rules.
2. **Domain transfer is an analogy, not a measurement.** Lending Club
   personal loans (2007–2011) are not card retries. The label "delinquent
   loan cured" approximates "failed payer recovered"; several features are
   proxies (table above). Directionally useful, individually unvalidated.
3. **Vintage bias.** 2007–2011 includes the financial crisis; recovery
   rates and feature effects may not generalize to today's payers.
4. **Moderate discrimination.** Test AUC 0.63. The model orders payers by
   recovery likelihood; it does not predict individual outcomes.
5. **Timing priors are population-level.** They come from industry-wide
   published curves, not this product's traffic. The plan's remedy — live
   calibration against real Stripe test streams and replay validation — is
   future work (WS-B/D); until then, timing outputs are prior-based
   estimates, clearly labeled as such in the UI.
6. **Counterfactual replay is estimation**, validated against the same
   published curves — never presented as observed fact.
7. **No leakage by construction, but selection exists.** The cohort
   conditions on observed delinquency; loans that never went delinquent are
   out of scope, so the propensity speaks only about already-failed
   payments — which is precisely the product's input population.

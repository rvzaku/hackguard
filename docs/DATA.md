# Data provenance — propensity model training data

## Dataset

**Lending Club public loan file, 2007–2011 vintage ("LoanStats3a")** —
loan-level records for every loan issued through Lending Club's platform
in 2007–2011, including issuance-time application attributes and full
repayment history.

| Field | Value |
|---|---|
| Download URL | `https://resources.lendingclub.com/LoanStats3a.csv.zip` |
| Retrieved | 2026-08-21 |
| File (unzipped) | `LoanStats3a.csv`, 42,409,635 bytes, 42,535 usable loan rows |
| SHA-256 | `9af5ac078f1a22879ed026fb5ba394c9f76badd917e97b6d9ec59f34f535db69` |

The training pipeline (`models/propensity/train.py`) pins this SHA-256 and
refuses to train against a file that does not match. The zip is downloaded
once into `models/.cache/` (gitignored); a local copy can be supplied via
`SCORING_LC_DATA_PATH` (verified against the same pin).

## Why this vintage

The 2007–2011 book is **fully matured**: every loan has reached a terminal
status (Fully Paid or Charged Off). Later vintages contain censored loans
(Current / Late), which would force either label leakage or exclusion.
Terminal labels are the honest choice for a recovery outcome.

## License / terms of use

Lending Club published these files as a public download
(`lendingclub.com/info/download-data.action`, now served from the
`resources.lendingclub.com` host) **without an attached open-source
license**. The dataset is widely used for academic and industry research;
Lending Club's stated intent in publishing was to enable exactly this kind
of analysis. Use here is:

- research/demo only (a hackathon prototype, not a production system),
- non-commercial,
- attributed (this file), with the source URL and content hash recorded.

If Lending Club (or successor, e.g. Intendo Communications LLC) objects to
redistribution of derived artifacts, the committed model artifact under
`models/registry/` should be removed and retrained from the original
source via `npm run model:train:full`. No raw loan rows are committed to
this repository.

## Derived cohort

From the raw file, training uses the **delinquent cohort**: loans with
post-issuance delinquency evidence (`mths_since_last_delinq` present or
late fees > 0) and a terminal status — 16,834 rows, 81.3% "cured"
(see `docs/MODEL.md` for label semantics and limitations).

## Timing-policy priors (not training data)

The timing policy (`services/scoring/src/scoring/policy.py`) encodes
published industry statistics rather than a dataset; each constant cites
its source inline (Recurly, Slicker, Stripe — retrieved 2026-08-21).

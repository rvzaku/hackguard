# Eval report — propensity-v1.0.0

Trained 2026-08-21T06:58:40+00:00 | seed 42 | best iteration 21

## Data
- Source: https://resources.lendingclub.com/LoanStats3a.csv.zip (sha256 `9af5ac078f1a2287...`)
- Delinquent cohort: 16834 rows
- Split 10100/3366/3368 (train/val/test, stratified)
- Test base rate (cured): 0.8171

## Held-out test metrics

| Scorer | AUC | PR-AUC | Brier | AUC lift vs constant |
|---|---|---|---|---|
| xgboost_propensity_v1 | 0.6311 | 0.8796 | 0.1456 | +0.1311 |
| constant_base_rate | 0.5 | 0.8178 | 0.14945 | +0.0000 |
| rule_delinq_2yrs_eq_0 | 0.496 | 0.8195 | 0.36758 | -0.0040 |
| rule_int_rate_le_13 | 0.5804 | 0.8507 | 0.46645 | +0.0804 |
| rule_dti_le_15 | 0.5324 | 0.8351 | 0.413 | +0.0324 |
| rule_sum_of_three | 0.5715 | 0.8533 | — | +0.0715 |

Expected calibration error (10 bins): **0.01338**

## Calibration curve (test)

| Bin | Mean predicted | Observed rate | Count |
|---|---|---|---|
| 0.0-0.1 | — | — | 0 |
| 0.1-0.2 | — | — | 0 |
| 0.2-0.3 | — | — | 0 |
| 0.3-0.4 | 0.35937 | 1.0 | 2 |
| 0.4-0.5 | 0.4616 | 0.57143 | 7 |
| 0.5-0.6 | 0.56466 | 0.69231 | 78 |
| 0.6-0.7 | 0.66006 | 0.71347 | 349 |
| 0.7-0.8 | 0.75742 | 0.75457 | 766 |
| 0.8-0.9 | 0.85202 | 0.84566 | 1704 |
| 0.9-1.0 | 0.92076 | 0.91775 | 462 |

Baselines are simple deterministic rules on the same test split; the model's lift over them is the honest measure of added value. Methodology and limitations: docs/MODEL.md.

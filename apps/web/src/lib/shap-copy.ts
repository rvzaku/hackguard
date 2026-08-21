import type { ShapContribution } from '@hackguard/contracts';

/**
 * Plain-English rendering of SHAP contributions for the explanation panel.
 * Presentation only — no scoring/triage logic lives client-side; feature
 * semantics are labels, not computations.
 */

const FEATURE_LABELS: Record<string, string> = {
  decline_code_family: 'the decline-code family',
  attempt_number: 'the retry attempt number',
  hour_of_day: 'the time of day',
  payday_proximity: 'proximity to payday',
  card_brand: 'the card brand',
  amount_band: 'the charge amount band',
  customer_tenure: 'customer tenure',
  inter_attempt_interval: 'the gap since the last attempt',
  payer_propensity: 'the payer-recovery propensity score',
};

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature.replace(/[_-]+/g, ' ');
}

/**
 * One plain-English sentence per SHAP contribution: what moved the recovery
 * estimate and in which direction. Positive contributions push P(recover) up,
 * negative ones push it down.
 */
export function describeContribution(c: ShapContribution): string {
  const label = featureLabel(c.feature);
  if (c.contribution >= 0) {
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} increases the estimated odds of recovery.`;
  }
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} decreases the estimated odds of recovery.`;
}

/**
 * Relative bar width (0..100) for a signed SHAP value, scaled against the
 * largest absolute contribution in the set so the biggest driver fills the bar.
 */
export function shapBarPercent(contributions: readonly ShapContribution[]): number[] {
  const max = Math.max(1e-9, ...contributions.map((c) => Math.abs(c.contribution)));
  return contributions.map((c) => Math.max(1, Math.round((Math.abs(c.contribution) / max) * 100)));
}

export function formatSigned(c: ShapContribution): string {
  const value = c.contribution.toFixed(2);
  return c.contribution >= 0 ? `+${value}` : value;
}

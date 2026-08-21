import { describe, expect, it } from 'vitest';
import { ShapContributionSchema } from '@hackguard/contracts';
import { describeContribution, featureLabel, formatSigned, shapBarPercent } from '@/lib/shap-copy';

const shap = (feature: string, contribution: number) =>
  ShapContributionSchema.parse({ feature, contribution });

describe('SHAP plain-English rendering', () => {
  it('states the direction of known features', () => {
    expect(describeContribution(shap('decline_code_family', -1.42))).toBe(
      'The decline-code family decreases the estimated odds of recovery.',
    );
    expect(describeContribution(shap('payer_propensity', 0.41))).toBe(
      'The payer-recovery propensity score increases the estimated odds of recovery.',
    );
  });

  it('humanizes unknown features instead of leaking raw identifiers', () => {
    expect(featureLabel('some_new_feature')).toBe('some new feature');
    expect(describeContribution(shap('some_new_feature', 0.5))).toBe(
      'Some new feature increases the estimated odds of recovery.',
    );
  });

  it('scales bars against the largest absolute contribution', () => {
    const rows = [shap('a', -2.0), shap('b', 1.0), shap('c', 0.02)];
    const percents = shapBarPercent(rows);
    expect(percents).toEqual([100, 50, 1]);
  });

  it('formats signed values with an explicit sign', () => {
    expect(formatSigned(shap('a', 0.25))).toBe('+0.25');
    expect(formatSigned(shap('a', -1.4))).toBe('-1.40');
  });
});

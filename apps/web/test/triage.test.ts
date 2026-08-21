import { describe, expect, it } from 'vitest';

import { parseMastercardMac, triage } from '../src/lib/triage/rules';
import { makeEvent } from './helpers';

describe('triage engine — Visa Decline Categories', () => {
  const cat1Codes = [
    'lost_card',
    'stolen_card',
    'pickup_card',
    'restricted_card',
    'fraudulent',
    'security_violation',
    'do_not_try',
  ];

  it.each(cat1Codes)('maps Visa Cat 1 code %s to NEVER_RETRY_HARD', (code) => {
    const result = triage(makeEvent({ declineCode: code, cardBrand: 'visa' }));
    expect(result.action).toBe('NEVER_RETRY_HARD');
    expect(result.ruleIds).toContain('VISA-CAT1-NEVER-RETRY');
    expect(result.network).toBe('visa');
  });

  it.each(['insufficient_funds', 'try_again_later', 'processing_error', 'generic_decline'])(
    'maps Visa Cat 2/3 code %s to RETRY_SOFT with the 15/30d citation',
    (code) => {
      const result = triage(makeEvent({ declineCode: code, cardBrand: 'visa' }));
      expect(result.action).toBe('RETRY_SOFT');
      expect(result.ruleIds).toContain('VISA-CAT23-MAX15-PER-30D');
    },
  );
});

describe('triage engine — Mastercard Merchant Advice Codes', () => {
  it('maps MAC 01 to ASK_CUSTOMER (never auto-retry)', () => {
    const result = triage(makeEvent({ declineCode: 'mac_01', cardBrand: 'mastercard' }));
    expect(result.action).toBe('ASK_CUSTOMER');
    expect(result.ruleIds).toEqual(['MC-MAC01-DO-NOT-RETRY']);
  });

  it.each(['mac_03', 'mac_21', 'merchant_advice_21'])(
    'maps %s to NEVER_RETRY_HARD',
    (code) => {
      const result = triage(makeEvent({ declineCode: code, cardBrand: 'mastercard' }));
      expect(result.action).toBe('NEVER_RETRY_HARD');
      expect(result.ruleIds[0]).toMatch(/^MC-MAC\d{2}-DO-NOT-RETRY$/);
    },
  );

  it('maps MAC 02 to RETRY_SOFT under the TPE caps citation', () => {
    const result = triage(makeEvent({ declineCode: 'mac_02', cardBrand: 'mastercard' }));
    expect(result.action).toBe('RETRY_SOFT');
    expect(result.ruleIds).toContain('MC-TPE-MAX10-PER-24H-MAX35-PER-30D');
  });

  it('ignores MAC syntax on non-mastercard brands', () => {
    expect(parseMastercardMac('mac_03')).toBe('03');
    const result = triage(makeEvent({ declineCode: 'mac_03', cardBrand: 'amex' }));
    // Not a verified MAC context for amex; falls through to customer-actionable/unknown policy.
    expect(result.action).toBe('ASK_CUSTOMER');
  });
});

describe('triage engine — customer-actionable and unknown codes', () => {
  it.each(['expired_card', 'incorrect_cvc', 'invalid_expiry_year', 'incorrect_number'])(
    'maps %s to ASK_CUSTOMER',
    (code) => {
      const result = triage(makeEvent({ declineCode: code }));
      expect(result.action).toBe('ASK_CUSTOMER');
      expect(result.ruleIds).toContain('POLICY-CUSTOMER-ACTION-REQUIRED');
    },
  );

  it('defaults unknown codes conservatively to ASK_CUSTOMER with a policy citation', () => {
    const result = triage(makeEvent({ declineCode: 'totally_novel_code' }));
    expect(result.action).toBe('ASK_CUSTOMER');
    expect(result.ruleIds).toContain('POLICY-UNKNOWN-DECLINE-ASK');
  });

  it('permits soft retries on non-capped networks while citing the policy rule', () => {
    const result = triage(makeEvent({ declineCode: 'insufficient_funds', cardBrand: 'amex' }));
    expect(result.action).toBe('RETRY_SOFT');
    expect(result.ruleIds).toContain('POLICY-SOFT-RETRY-NO-NETWORK-CAPS');
    expect(result.network).toBe('other');
  });

  it('every result carries at least one rule citation', () => {
    const codes = ['lost_card', 'insufficient_funds', 'mac_01', 'mac_03', 'expired_card', 'zzz'];
    for (const code of codes) {
      expect(triage(makeEvent({ declineCode: code })).ruleIds.length).toBeGreaterThan(0);
    }
  });
});

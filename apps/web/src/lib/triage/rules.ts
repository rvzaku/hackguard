import type { PaymentFailedEvent } from '@hackguard/contracts';

/**
 * Deterministic triage engine (plan §2.2, §4).
 *
 * Maps Stripe decline codes onto the two verified rule systems:
 * - Visa Decline Categories (Excessive Reattempts program, Apr 2022):
 *     Cat 1  "Issuer will never approve"        -> NEVER_RETRY_HARD
 *     Cat 2/3 retryable with issuer discretion  -> RETRY_SOFT, max 15 reattempts / 30 days
 * - Mastercard Transaction Processing Errors (TPE) Merchant Advice Codes (MAC):
 *     MAC 01 "new account/data available"       -> ASK_CUSTOMER (never auto-retry)
 *     MAC 03 / MAC 21 "do not retry"            -> NEVER_RETRY_HARD
 *     other TPE-eligible declines               -> RETRY_SOFT, max 10 / 24h and 35 / 30d
 *
 * Every decision carries machine-readable rule citations (ruleHits) that the
 * compliance guardrail and the UI explanation panel render verbatim.
 */

export type TriageAction = 'RETRY_SOFT' | 'NEVER_RETRY_HARD' | 'ASK_CUSTOMER';

export type CardNetwork = 'visa' | 'mastercard' | 'other';

export interface RuleHit {
  ruleId: string;
  source: 'VISA' | 'MASTERCARD' | 'POLICY';
  description: string;
}

export interface TriageResult {
  action: TriageAction;
  network: CardNetwork;
  /** Machine-readable citations stored with every decision (Decision.ruleHits). */
  ruleIds: string[];
  rationale: string;
}

export function networkForBrand(brand: PaymentFailedEvent['cardBrand']): CardNetwork {
  if (brand === 'visa') return 'visa';
  if (brand === 'mastercard') return 'mastercard';
  return 'other';
}

// --- Visa Decline Category 1: issuer will never approve these transactions ---
export const VISA_CAT1_CODES: ReadonlySet<string> = new Set([
  'lost_card',
  'stolen_card',
  'pickup_card',
  'restricted_card',
  'fraudulent',
  'security_violation',
  'do_not_try',
]);

// --- Visa Categories 2/3: temporary conditions, retryable within caps ---
export const VISA_CAT23_CODES: ReadonlySet<string> = new Set([
  'insufficient_funds',
  'try_again_later',
  'processing_error',
  'issuer_not_available',
  'reenter_transaction',
  'card_velocity_exceeded',
  'temp_card_error',
  'generic_decline',
  'do_not_honor',
]);

// --- Customer-actionable declines: retrying the same card cannot succeed ---
export const ASK_CUSTOMER_CODES: ReadonlySet<string> = new Set([
  'expired_card',
  'incorrect_cvc',
  'invalid_cvc',
  'incorrect_number',
  'invalid_number',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'card_not_authorized',
  'payment_intent_authentication_failure',
]);

const RULE_VISA_CAT1: RuleHit = {
  ruleId: 'VISA-CAT1-NEVER-RETRY',
  source: 'VISA',
  description:
    'Visa Decline Category 1 — issuer will never approve; any reattempt incurs per-attempt penalty fees.',
};
const RULE_VISA_CAT23: RuleHit = {
  ruleId: 'VISA-CAT23-MAX15-PER-30D',
  source: 'VISA',
  description:
    'Visa Decline Category 2/3 — retryable; max 15 reattempts per 30 days (Visa Excessive Reattempts, Apr 2022).',
};
const RULE_MC_TPE_CAPS: RuleHit = {
  ruleId: 'MC-TPE-MAX10-PER-24H-MAX35-PER-30D',
  source: 'MASTERCARD',
  description:
    'Mastercard TPE — max 10 retries per 24h and 35 per rolling 30 days; $0.15/attempt over 35.',
};

function macRule(mac: '01' | '03' | '21'): RuleHit {
  const descriptions: Record<'01' | '03' | '21', string> = {
    '01': 'Mastercard MAC 01 — new account/data available; do not auto-retry, ask customer to update payment method.',
    '03': 'Mastercard MAC 03 — do not retry.',
    '21': 'Mastercard MAC 21 — do not retry.',
  };
  return {
    ruleId: `MC-MAC${mac}-DO-NOT-RETRY`,
    source: 'MASTERCARD',
    description: descriptions[mac],
  };
}

const RULE_POLICY_UNKNOWN: RuleHit = {
  ruleId: 'POLICY-UNKNOWN-DECLINE-ASK',
  source: 'POLICY',
  description:
    'Decline code not in the verified Visa/Mastercard tables — conservative default: ask the customer instead of risking a penalty-incurring retry.',
};

const RULE_SOFT_RETRY_OTHER: RuleHit = {
  ruleId: 'POLICY-SOFT-RETRY-NO-NETWORK-CAPS',
  source: 'POLICY',
  description:
    'Temporary-condition decline on a network without verified retry caps (amex/discover/etc.) — retry permitted, hard-decline suppression still enforced.',
};

/** Mastercard Merchant Advice Code embedded in a decline code, e.g. "mac_01". */
export function parseMastercardMac(declineCode: string): '01' | '02' | '03' | '21' | null {
  const match = /^(?:mac|merchant_advice)_?(\d{2})$/.exec(declineCode);
  if (!match) return null;
  const value = match[1];
  if (value === '01' || value === '02' || value === '03' || value === '21') return value;
  return null;
}

export function triage(event: Pick<PaymentFailedEvent, 'declineCode' | 'cardBrand'>): TriageResult {
  const network = networkForBrand(event.cardBrand);
  const code = event.declineCode;

  // Mastercard Merchant Advice Codes take precedence when present.
  const mac = network === 'mastercard' ? parseMastercardMac(code) : null;
  if (mac) {
    if (mac === '01') {
      return {
        action: 'ASK_CUSTOMER',
        network,
        ruleIds: [macRule('01').ruleId],
        rationale: macRule('01').description,
      };
    }
    if (mac === '03' || mac === '21') {
      return {
        action: 'NEVER_RETRY_HARD',
        network,
        ruleIds: [macRule(mac).ruleId],
        rationale: macRule(mac).description,
      };
    }
    return {
      action: 'RETRY_SOFT',
      network,
      ruleIds: [RULE_MC_TPE_CAPS.ruleId],
      rationale: `MAC ${mac}: no merchant-advice restriction; retry under Mastercard TPE caps.`,
    };
  }

  if (network === 'visa' && VISA_CAT1_CODES.has(code)) {
    return {
      action: 'NEVER_RETRY_HARD',
      network,
      ruleIds: [RULE_VISA_CAT1.ruleId],
      rationale: RULE_VISA_CAT1.description,
    };
  }
  if (network !== 'mastercard' && VISA_CAT23_CODES.has(code)) {
    // Visa Cat 2/3 codes are retryable for every network; the caps citation
    // names Visa for visa cards, the generic policy citation otherwise
    // (no verified caps exist for amex/discover/etc. — guardrail still
    // suppresses hard declines on every network).
    const rule = network === 'visa' ? RULE_VISA_CAT23 : RULE_SOFT_RETRY_OTHER;
    return {
      action: 'RETRY_SOFT',
      network,
      ruleIds: [rule.ruleId],
      rationale: rule.description,
    };
  }
  if (ASK_CUSTOMER_CODES.has(code)) {
    return {
      action: 'ASK_CUSTOMER',
      network,
      ruleIds: ['POLICY-CUSTOMER-ACTION-REQUIRED'],
      rationale:
        'Decline is customer-actionable (expired/incorrect card details); automatic retry of the same credentials cannot succeed.',
    };
  }
  return {
    action: 'ASK_CUSTOMER',
    network,
    ruleIds: [RULE_POLICY_UNKNOWN.ruleId],
    rationale: RULE_POLICY_UNKNOWN.description,
  };
}

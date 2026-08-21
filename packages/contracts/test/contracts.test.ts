import { describe, expect, it } from 'vitest';
import {
  AuditEntrySchema,
  DecisionSchema,
  PaymentFailedEventSchema,
  ReplayEventSchema,
  buildOpenApiDocument,
} from '../src/index.js';
import openapi from '../openapi.json';

// ---------------------------------------------------------------------------
// NOTE: fixtures below are *scaffold examples* — wired to prove the contract
// pipeline end-to-end, not real business logic.
// ---------------------------------------------------------------------------

const validPaymentFailedEvent = {
  stripeId: 'evt_1Nabc123',
  customerId: 'cus_Qxyz789',
  amountMinor: 4900,
  currency: 'usd',
  declineCode: 'insufficient_funds',
  attempt: 2,
  cardBrand: 'visa',
  ts: '2026-08-22T10:15:00Z',
} as const;

const validDecision = {
  paymentId: 'pay_001',
  action: 'RETRY',
  scheduledFor: '2026-08-22T18:30:00Z',
  pRecover: 0.62,
  shapTop: [{ feature: 'decline_code_family', contribution: 0.41 }],
  ruleHits: ['VISA-CAT3-MAX15-PER30D'],
  modelVersion: 'propensity-v0.1.0',
} as const;

const validAuditEntry = {
  seq: 1,
  prevHash: '0'.repeat(64),
  hash: 'a'.repeat(64),
  decisionRef: 'pay_001',
  actor: 'RULE',
  ts: '2026-08-22T10:15:01Z',
} as const;

describe('PaymentFailedEvent contract', () => {
  it('accepts a valid event', () => {
    expect(PaymentFailedEventSchema.parse(validPaymentFailedEvent).declineCode).toBe(
      'insufficient_funds'
    );
  });
  it('rejects a non-ISO-4217 currency', () => {
    expect(() =>
      PaymentFailedEventSchema.parse({ ...validPaymentFailedEvent, currency: 'dollars' })
    ).toThrow();
  });
  it('rejects non-positive amounts', () => {
    expect(() =>
      PaymentFailedEventSchema.parse({ ...validPaymentFailedEvent, amountMinor: 0 })
    ).toThrow();
  });
});

describe('Decision contract', () => {
  it('accepts a valid decision', () => {
    expect(DecisionSchema.parse(validDecision).action).toBe('RETRY');
  });
  it('rejects pRecover outside [0,1]', () => {
    expect(() => DecisionSchema.parse({ ...validDecision, pRecover: 1.5 })).toThrow();
  });
  it('rejects more than 5 SHAP contributions', () => {
    const shapTop = Array.from({ length: 6 }, (_, i) => ({ feature: `f${i}`, contribution: 0.1 }));
    expect(() => DecisionSchema.parse({ ...validDecision, shapTop })).toThrow();
  });
});

describe('AuditEntry contract', () => {
  it('accepts a genesis entry with all-zero prevHash', () => {
    expect(AuditEntrySchema.parse(validAuditEntry).seq).toBe(1);
  });
  it('rejects non-hex hashes', () => {
    expect(() => AuditEntrySchema.parse({ ...validAuditEntry, hash: 'nothex' })).toThrow();
  });
  it('rejects unknown actors', () => {
    expect(() => AuditEntrySchema.parse({ ...validAuditEntry, actor: 'ROBOT' })).toThrow();
  });
});

describe('ReplayEvent contract', () => {
  const validReplayEvent = {
    eventId: 'rep_0001',
    kind: 'PAYMENT_FAILED',
    source: 'stripe-test-capture',
    capturedAt: '2026-08-22T10:15:00Z',
    paymentFailed: validPaymentFailedEvent,
  } as const;

  it('accepts a captured payment-failure replay event', () => {
    expect(ReplayEventSchema.parse(validReplayEvent).kind).toBe('PAYMENT_FAILED');
  });
  it('rejects unknown sources', () => {
    expect(() =>
      ReplayEventSchema.parse({ ...validReplayEvent, source: 'production-real-money' })
    ).toThrow();
  });
});

describe('generated OpenAPI document', () => {
  it('exposes all four core contracts as components', () => {
    const names = Object.keys(openapi.components.schemas);
    expect(names).toEqual(
      expect.arrayContaining(['PaymentFailedEvent', 'Decision', 'AuditEntry', 'ReplayEvent'])
    );
  });

  it('matches a freshly built document (openapi.json is up to date)', () => {
    expect(openapi).toEqual(buildOpenApiDocument());
  });
});

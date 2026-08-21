import { createHmac } from 'node:crypto';

import type { PaymentFailedEvent, ReplayEvent } from '@hackguard/contracts';

import { inMemoryRuntime, type Runtime } from '../src/lib/stores/memory';
import { setRuntimeForTests } from '../src/lib/runtime';
import type { ScoringClient, ScoreResult } from '../src/lib/scoring/client';

/** Deterministic fixture builders shared by the backend-core test suite. */

export const WEBHOOK_SECRET = 'whsec_test_secret_123';

export function makeEvent(overrides: Partial<PaymentFailedEvent> = {}): PaymentFailedEvent {
  return {
    stripeId: 'evt_test_0001',
    customerId: 'cus_test_0001',
    amountMinor: 4900,
    currency: 'usd',
    declineCode: 'insufficient_funds',
    attempt: 1,
    cardBrand: 'visa',
    ts: '2026-08-22T10:15:00Z',
    ...overrides,
  };
}

export function makeReplayEvent(
  overrides: Partial<ReplayEvent> & { eventId: string },
): ReplayEvent {
  return {
    kind: 'PAYMENT_FAILED',
    source: 'stripe-test-capture',
    capturedAt: '2026-08-22T10:15:00Z',
    paymentFailed: makeEvent({ stripeId: overrides.eventId }),
    ...overrides,
  };
}

/** Builds a Stripe-style signed webhook body for the given event envelope. */
export function signedWebhookBody(
  envelope: Record<string, unknown>,
  secret: string = WEBHOOK_SECRET,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): { body: string; signature: string } {
  const body = JSON.stringify(envelope);
  const signature = `t=${timestampSeconds},v1=${createHmac('sha256', secret)
    .update(`${timestampSeconds}.${body}`, 'utf8')
    .digest('hex')}`;
  return { body, signature };
}

export function invoicePaymentFailedEnvelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_test_0001',
    type: 'invoice.payment_failed',
    created: 1789_000_000, // 2026-08-21-ish, fixed for determinism
    data: {
      object: {
        id: 'in_test_0001',
        customer: 'cus_test_0001',
        amount_due: 4900,
        currency: 'usd',
        attempt_count: 1,
        decline_code: 'insufficient_funds',
        payment_method_details: { card: { brand: 'visa' } },
        ...overrides,
      },
    },
    ...overrides,
  };
}

/** Scoring stub whose P(recover) peaks at a configurable offset in hours. */
export class PeakAtHoursScorer implements ScoringClient {
  constructor(private readonly peakHours: number) {}

  async score(event: PaymentFailedEvent): Promise<ScoreResult> {
    const hours = (Date.parse(event.ts) - BASE_TS) / 3_600_000;
    const pRecover = Math.max(0.01, 1 - Math.abs(hours - this.peakHours) / 100);
    return { pRecover, modelVersion: 'peak-fake-v1', shapTop: [] };
  }
}

export const BASE_TS = Date.parse('2026-08-22T10:15:00Z');

/** Installs a fresh in-memory runtime for a test file. */
export function useMemoryRuntime(scoring?: ScoringClient): Runtime {
  const runtime = inMemoryRuntime();
  setRuntimeForTests(runtime, scoring);
  return runtime;
}

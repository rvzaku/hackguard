import type { PaymentFailedEvent, ReplayEvent } from '@hackguard/contracts';

/**
 * Canonical demo failure stream (plan §4: "canonical event log seeded from
 * real Stripe test-mode captures"). Provenance is labeled `synthetic-seed`:
 * these rows are representative Stripe test-mode events shaped exactly like
 * captured `invoice.payment_failed` payloads, never presented as observed
 * production traffic.
 *
 * The stream deliberately covers every triage outcome so one bootstrap shows
 * the whole product: retryable soft declines (Visa Cat 2/3), hard declines
 * that must be suppressed (Visa Cat 1 / Mastercard MAC 03/21), and
 * customer-actionable failures routed to dunning (ASK_CUSTOMER).
 */

const BASE_TS = '2026-08-22T09:00:00.000Z';

function hoursFromBase(hours: number): string {
  return new Date(Date.parse(BASE_TS) + hours * 3_600_000).toISOString();
}

interface SeedRow {
  eventId: string;
  customerId: string;
  amountMinor: number;
  currency: string;
  declineCode: string;
  attempt: number;
  cardBrand: PaymentFailedEvent['cardBrand'];
  /** Offset from BASE_TS in hours. */
  atHours: number;
}

const SEED_ROWS: SeedRow[] = [
  // cus_acme — recurring soft decline, classic recoverable failure.
  { eventId: 'evt_seed_001', customerId: 'cus_acme', amountMinor: 4900, currency: 'usd', declineCode: 'insufficient_funds', attempt: 1, cardBrand: 'visa', atHours: 0 },
  { eventId: 'evt_seed_002', customerId: 'cus_globex', amountMinor: 9900, currency: 'usd', declineCode: 'do_not_honor', attempt: 1, cardBrand: 'mastercard', atHours: 1 },
  { eventId: 'evt_seed_003', customerId: 'cus_stark', amountMinor: 2900, currency: 'usd', declineCode: 'lost_card', attempt: 2, cardBrand: 'visa', atHours: 2 },
  { eventId: 'evt_seed_004', customerId: 'cus_wayne', amountMinor: 14900, currency: 'usd', declineCode: 'expired_card', attempt: 3, cardBrand: 'amex', atHours: 4 },
  { eventId: 'evt_seed_005', customerId: 'cus_initech', amountMinor: 3500, currency: 'usd', declineCode: 'try_again_later', attempt: 1, cardBrand: 'visa', atHours: 5 },
  { eventId: 'evt_seed_006', customerId: 'cus_hooli', amountMinor: 7900, currency: 'usd', declineCode: 'fraudulent', attempt: 1, cardBrand: 'mastercard', atHours: 7 },
  { eventId: 'evt_seed_007', customerId: 'cus_piedpiper', amountMinor: 1900, currency: 'usd', declineCode: 'generic_decline', attempt: 2, cardBrand: 'visa', atHours: 9 },
  { eventId: 'evt_seed_008', customerId: 'cus_ravenclaw', amountMinor: 5900, currency: 'eur', declineCode: 'incorrect_cvc', attempt: 1, cardBrand: 'visa', atHours: 11 },
  { eventId: 'evt_seed_009', customerId: 'cus_acme', amountMinor: 4900, currency: 'usd', declineCode: 'insufficient_funds', attempt: 2, cardBrand: 'visa', atHours: 26 },
  { eventId: 'evt_seed_010', customerId: 'cus_soylent', amountMinor: 24900, currency: 'usd', declineCode: 'processing_error', attempt: 1, cardBrand: 'mastercard', atHours: 30 },
  { eventId: 'evt_seed_011', customerId: 'cus_globex', amountMinor: 9900, currency: 'usd', declineCode: 'card_velocity_exceeded', attempt: 2, cardBrand: 'mastercard', atHours: 33 },
  { eventId: 'evt_seed_012', customerId: 'cus_underwood', amountMinor: 6900, currency: 'usd', declineCode: 'do_not_try', attempt: 4, cardBrand: 'visa', atHours: 47 },
];

export const DEMO_STREAM_ID = 'demo_seed_stream_v1';

/** The canonical demo stream as contract-valid ReplayEvents. */
export function buildDemoReplayStream(): ReplayEvent[] {
  return SEED_ROWS.map((row) => ({
    eventId: row.eventId,
    kind: 'PAYMENT_FAILED',
    source: 'synthetic-seed',
    capturedAt: hoursFromBase(row.atHours),
    paymentFailed: {
      stripeId: row.eventId.replace('evt_', 'in_'),
      customerId: row.customerId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      declineCode: row.declineCode,
      attempt: row.attempt,
      cardBrand: row.cardBrand,
      ts: hoursFromBase(row.atHours),
    },
  }));
}

/**
 * Stripe test-mode webhook envelopes for the same stream, used by
 * scripts/seed-demo.mjs to drive live ingest through POST /api/webhooks/stripe
 * with real HMAC signatures.
 */
export function buildDemoWebhookEnvelopes(): Array<Record<string, unknown>> {
  return SEED_ROWS.map((row) => ({
    id: row.eventId,
    type: 'invoice.payment_failed',
    created: Math.floor(Date.parse(hoursFromBase(row.atHours)) / 1000),
    data: {
      object: {
        id: row.eventId.replace('evt_', 'in_'),
        customer: row.customerId,
        amount_due: row.amountMinor,
        currency: row.currency,
        attempt_count: row.attempt,
        decline_code: row.declineCode,
        payment_method_details: { card: { brand: row.cardBrand } },
      },
    },
  }));
}

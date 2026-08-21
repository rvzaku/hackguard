import { z } from 'zod';

import { PaymentFailedEventSchema, type PaymentFailedEvent } from '@hackguard/contracts';

import { AppError } from '../errors.js';

/**
 * Maps a Stripe webhook envelope to the shared PaymentFailedEvent contract.
 * Accepts `invoice.payment_failed` events from real Stripe test-mode captures;
 * anything else is reported as unsupported (the route acks it with 200 so
 * Stripe does not retry, per Stripe docs).
 */

export const INVOICE_PAYMENT_FAILED = 'invoice.payment_failed';

export const StripeEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number().int().nonnegative().optional(),
  data: z.object({
    object: z.record(z.string(), z.unknown()),
  }),
});

export type StripeEventEnvelope = z.infer<typeof StripeEventEnvelopeSchema>;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function deepGet(obj: unknown, path: readonly string[]): unknown {
  let cursor: unknown = obj;
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * Extracts a contract-valid PaymentFailedEvent from the Stripe invoice object.
 * Decline code resolution order: invoice.decline_code (captured streams may
 * carry it flattened), invoice.last_payment_error.decline_code,
 * payment_intent-level last_payment_error, then 'generic_decline'.
 */
export function extractPaymentFailedEvent(envelope: StripeEventEnvelope): PaymentFailedEvent {
  const obj = envelope.data.object;
  const createdSeconds =
    asNumber(envelope.created) ?? asNumber(deepGet(obj, ['created'])) ?? 0;
  const ts = new Date(createdSeconds * 1000).toISOString();

  const declineCode =
    asString(deepGet(obj, ['decline_code'])) ??
    asString(deepGet(obj, ['last_payment_error', 'decline_code'])) ??
    asString(deepGet(obj, ['payment_intent', 'last_payment_error', 'decline_code'])) ??
    'generic_decline';

  const brandRaw = asString(deepGet(obj, ['payment_method_details', 'card', 'brand'])) ?? 'unknown';
  const parsed = PaymentFailedEventSchema.safeParse({
    stripeId: asString(obj.id) ?? envelope.id,
    customerId: asString(obj.customer) ?? 'cus_unknown',
    amountMinor: asNumber(obj.amount_due) ?? asNumber(obj.amount),
    currency: asString(obj.currency) ?? 'usd',
    declineCode,
    attempt: Math.max(1, asNumber(obj.attempt_count) ?? 1),
    cardBrand: brandRaw,
    ts,
  });
  if (!parsed.success) {
    throw new AppError('SCHEMA_VALIDATION_FAILED', 'Stripe event does not map to PaymentFailedEvent', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export type ExtractResult =
  | { kind: 'event'; event: PaymentFailedEvent }
  | { kind: 'ignored'; reason: string };

export function parseStripeEnvelope(rawBody: string): StripeEventEnvelope {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new AppError('MALFORMED_PAYLOAD', 'request body is not valid JSON');
  }
  const parsed = StripeEventEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('MALFORMED_PAYLOAD', 'body does not match the Stripe event envelope', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function extractFromEnvelope(envelope: StripeEventEnvelope): ExtractResult {
  if (envelope.type !== INVOICE_PAYMENT_FAILED) {
    return { kind: 'ignored', reason: `unsupported event type ${envelope.type}` };
  }
  return { kind: 'event', event: extractPaymentFailedEvent(envelope) };
}

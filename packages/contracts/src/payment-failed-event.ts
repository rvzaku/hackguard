import { z } from 'zod';

/**
 * PaymentFailedEvent — a failed payment ingested from Stripe (test mode).
 * Contract: plan §4.
 */
export const PaymentFailedEventSchema = z.object({
  stripeId: z.string().min(1).describe('Stripe event or invoice item id, e.g. evt_...'),
  customerId: z.string().min(1).describe('Stripe customer id, e.g. cus_...'),
  amountMinor: z
    .number()
    .int()
    .positive()
    .describe('Amount in minor units (cents), e.g. 4900 = $49.00'),
  currency: z
    .string()
    .regex(/^[a-z]{3}$/, 'ISO 4217 lowercase alpha-3, e.g. "usd"')
    .describe('ISO 4217 currency code (lowercase)'),
  declineCode: z.string().min(1).describe('Stripe decline code, e.g. "insufficient_funds"'),
  attempt: z.number().int().min(1).describe('1-based retry attempt number for this invoice'),
  cardBrand: z
    .enum(['visa', 'mastercard', 'amex', 'discover', 'jcb', 'diners', 'unionpay', 'unknown'])
    .describe('Card brand from the Stripe payment method'),
  ts: z.string().datetime({ offset: true }).describe('Failure timestamp, RFC 3339 with offset'),
});

export type PaymentFailedEvent = z.infer<typeof PaymentFailedEventSchema>;

import { z } from 'zod';
import { PaymentFailedEventSchema } from './payment-failed-event.js';

/**
 * ReplayEvent — one row of the canonical replay stream used by the A/B replay
 * harness (plan §4: "canonical event log seeded from real Stripe test-mode
 * captures"). Deterministic and inspectable; counterfactual by construction.
 */
export const ReplayEventKindSchema = z.enum([
  'PAYMENT_FAILED',
  'PAYMENT_RECOVERED',
  'CARD_UPDATED',
]);
export type ReplayEventKind = z.infer<typeof ReplayEventKindSchema>;

export const ReplayEventSchema = z.object({
  eventId: z.string().min(1).describe('Dedupable id, stable across replay runs'),
  kind: ReplayEventKindSchema,
  source: z
    .enum(['stripe-test-capture', 'synthetic-seed'])
    .describe('Provenance: real Stripe test-mode capture or clearly-labeled synthetic seed'),
  capturedAt: z.string().datetime({ offset: true }).describe('Original capture time (RFC 3339)'),
  paymentFailed: PaymentFailedEventSchema.nullish().describe(
    'Present iff kind === PAYMENT_FAILED'
  ),
});

export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

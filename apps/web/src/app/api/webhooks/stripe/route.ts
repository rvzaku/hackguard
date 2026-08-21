import { AppError, withErrorHandling } from '@/lib/errors';
import { decidePaymentOutcome } from '@/lib/pipeline';
import { getRuntime, getScoringClient, envFrom } from '@/lib/runtime';
import { scopeKeyFor } from '@/lib/stores/memory';
import { extractFromEnvelope, parseStripeEnvelope } from '@/lib/stripe/parse';
import { verifyStripeSignature } from '@/lib/stripe/signature';
import { appendAuditEntry } from '@/lib/audit/chain';

/**
 * POST /api/webhooks/stripe — signed Stripe test-mode ingest (plan §3).
 * Pipeline: signature verify -> envelope parse -> event-id dedupe (Upstash
 * Redis SET NX) -> contract validation -> persist -> triage -> guardrail ->
 * schedule -> hash-chained audit append.
 */

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError('CONFIG_MISSING', 'STRIPE_WEBHOOK_SECRET is not configured');
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('stripe-signature');
  const verification = verifyStripeSignature(rawBody, signatureHeader, secret);
  if (!verification.ok) {
    throw new AppError(
      verification.rejection === 'stale_timestamp' ? 'STALE_TIMESTAMP' : 'INVALID_SIGNATURE',
      `webhook signature rejected: ${verification.rejection}`,
    );
  }

  const envelope = parseStripeEnvelope(rawBody);

  const runtime = getRuntime();
  // Event-id dedupe BEFORE any side effects: replayed deliveries are acked
  // idempotently (Stripe retries deliveries on non-2xx).
  const firstDelivery = await runtime.idempotency.reserve(
    `stripe:event:${envelope.id}`,
    IDEMPOTENCY_TTL_SECONDS,
  );
  if (!firstDelivery) {
    return Response.json({ deduped: true, eventId: envelope.id }, { status: 200 });
  }

  const extracted = extractFromEnvelope(envelope);
  if (extracted.kind === 'ignored') {
    return Response.json({ ignored: true, reason: extracted.reason }, { status: 200 });
  }
  const event = extracted.event;

  await runtime.payments.insert(event);
  const history = await runtime.payments.attemptsForScope(scopeKeyFor(event));
  const outcome = await decidePaymentOutcome({
    event,
    now: new Date(),
    attemptHistory: history,
    scopeKey: scopeKeyFor(event),
    scoring: getScoringClient(),
  });
  await runtime.decisions.save(outcome.decision);

  const entry = await appendAuditEntry(runtime.audit, {
    decisionRef: outcome.decision.paymentId,
    actor: outcome.auditActor,
    ts: new Date().toISOString(),
  });

  void envFrom(process.env); // env validated on the hot path; fails fast when misconfigured
  return Response.json(
    {
      received: true,
      eventId: envelope.id,
      decision: outcome.decision,
      degraded: outcome.degraded,
      triageRationale: outcome.triageRationale,
      blockedBy: outcome.blockedBy,
      auditSeq: entry.seq,
    },
    { status: 200 },
  );
});

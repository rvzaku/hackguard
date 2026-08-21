import { AppError, withErrorHandling } from '@/lib/errors';
import { decidePaymentOutcome } from '@/lib/pipeline';
import { getRuntime, getScoringClient } from '@/lib/runtime';
import { scopeKeyFor } from '@/lib/stores/memory';
import { appendAuditEntry } from '@/lib/audit/chain';

/**
 * POST /api/compliance/simulate-violation — red-team demo beat (plan §2/§4):
 * pushes a real hard-decline event (Visa Decline Category 1: `lost_card`)
 * through the actual pipeline — triage -> guardrail -> scheduler — and proves
 * the compliance engine suppresses the retry, citing the violated rules and
 * recording the enforcement event in the hash-chained audit ledger. The block
 * decision itself is deterministic rule territory and never computed
 * client-side.
 */
export const POST = withErrorHandling(async (): Promise<Response> => {
  const runtime = getRuntime();

  const event = {
    stripeId: 'in_violation_probe',
    customerId: 'cus_violation_probe',
    amountMinor: 12900,
    currency: 'usd',
    declineCode: 'lost_card',
    attempt: 1,
    cardBrand: 'visa',
    ts: new Date().toISOString(),
  } as const;

  const history = await runtime.payments.attemptsForScope(scopeKeyFor(event));
  const outcome = await decidePaymentOutcome({
    event,
    now: new Date(),
    attemptHistory: history,
    scopeKey: scopeKeyFor(event),
    scoring: getScoringClient(),
  });

  if (outcome.decision.action !== 'SUPPRESS' || outcome.decision.ruleHits.length === 0) {
    throw new AppError('INTERNAL', 'guardrail failed to block a Visa Cat-1 hard decline', {
      decision: outcome.decision,
    });
  }

  const entry = await appendAuditEntry(runtime.audit, {
    decisionRef: outcome.decision.paymentId,
    actor: outcome.auditActor,
    ts: new Date().toISOString(),
  });

  return Response.json(
    { blocked: true, ruleHits: outcome.decision.ruleHits, auditEntry: entry },
    { status: 200 },
  );
});

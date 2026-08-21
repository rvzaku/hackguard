import { DecisionSchema, type Decision, type PaymentFailedEvent } from '@hackguard/contracts';

import { evaluateScheduleProposal, type AttemptRecord } from './compliance/guardrail.js';
import { scheduleRetry } from './scheduler/scheduler.js';
import type { ScoringClient } from './scoring/client.js';
import { triage, type RuleHit, type TriageAction } from './triage/rules.js';

/**
 * Decision pipeline: triage -> (retry?) compliance guardrail -> scheduler.
 * Deterministic except for the model-scored schedule; the guardrail has final
 * say on every scheduled moment (plan §2.4).
 */

export interface DecisionOutcome {
  decision: Decision;
  triageAction: TriageAction;
  triageRationale: string;
  /** True when the scheduler fell back to the published-curve heuristic. */
  degraded: boolean;
  /** Guardrail violations that blocked or reshaped this decision. */
  blockedBy: string[];
  /** Audit actor for the ledger entry attesting this decision. */
  auditActor: 'RULE' | 'MODEL';
}

export interface DecideInput {
  event: PaymentFailedEvent;
  now: Date;
  /** Prior reattempts for this customer/card scope (from the payments store). */
  attemptHistory: readonly AttemptRecord[];
  scopeKey: string;
  scoring: ScoringClient;
}

export async function decidePaymentOutcome(input: DecideInput): Promise<DecisionOutcome> {
  const { event, now, attemptHistory, scopeKey } = input;
  const triageResult = triage(event);
  const ruleHits: string[] = [...triageResult.ruleIds];

  if (triageResult.action !== 'RETRY_SOFT') {
    const decision = DecisionSchema.parse({
      paymentId: event.stripeId,
      action: triageResult.action === 'ASK_CUSTOMER' ? 'ASK_CUSTOMER' : 'SUPPRESS',
      pRecover: 0,
      shapTop: [],
      ruleHits,
      modelVersion: 'triage-rules-v1',
    });
    return {
      decision,
      triageAction: triageResult.action,
      triageRationale: triageResult.rationale,
      degraded: false,
      blockedBy: [],
      auditActor: 'RULE',
    };
  }

  // Retry candidate: the guardrail has final say on any scheduled moment.
  const proposal = {
    paymentId: event.stripeId,
    scopeKey,
    network: triageResult.network,
    triageAction: triageResult.action,
    scheduledFor: now.toISOString(),
    now: now.toISOString(),
  };
  const verdict = evaluateScheduleProposal(proposal, attemptHistory);
  ruleHits.push(...verdict.ruleIds);
  if (!verdict.allowed) {
    const decision = DecisionSchema.parse({
      paymentId: event.stripeId,
      action: 'SUPPRESS',
      pRecover: 0,
      shapTop: [],
      ruleHits: [...new Set(ruleHits)],
      modelVersion: 'triage-rules-v1',
    });
    return {
      decision,
      triageAction: triageResult.action,
      triageRationale: `Retry blocked by compliance guardrail: ${verdict.violations.map((v) => v.ruleId).join(', ')}`,
      degraded: false,
      blockedBy: verdict.violations.map((v) => v.ruleId),
      auditActor: 'RULE',
    };
  }

  const scheduled = await scheduleRetry(event, input.scoring);
  const decision = DecisionSchema.parse({
    paymentId: event.stripeId,
    action: 'RETRY',
    scheduledFor: scheduled.scheduledFor,
    pRecover: scheduled.pRecover,
    shapTop: scheduled.shapTop,
    ruleHits: [...new Set(ruleHits)],
    modelVersion: scheduled.modelVersion,
  });
  return {
    decision,
    triageAction: triageResult.action,
    triageRationale: triageResult.rationale,
    degraded: scheduled.degraded,
    blockedBy: [],
    auditActor: scheduled.degraded ? 'RULE' : 'MODEL',
  };
}

export function ruleHitsToCitations(hits: readonly RuleHit[]): string[] {
  return hits.map((h) => h.ruleId);
}

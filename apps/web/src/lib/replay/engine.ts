import { createHash } from 'node:crypto';

import type { ReplayEvent } from '@hackguard/contracts';

import { evaluateScheduleProposal, type AttemptRecord } from '../compliance/guardrail.js';
import { decidePaymentOutcome } from '../pipeline.js';
import { PublishedCurveScorer } from '../scheduler/scheduler.js';
import type { ScoringClient } from '../scoring/client.js';
import { triage, type TriageAction } from '../triage/rules.js';
import {
  scopeKeyFor,
  type ReplayOutcomePoint,
  type ReplayRunRecord,
} from '../stores/memory.js';

/**
 * A/B replay harness (plan §2.6): runs the baseline fixed schedule and the
 * HackGuard policy over the identical captured stream. Outcomes are
 * counterfactual estimates — recovery is decided by a deterministic draw
 * (SHA-256 of eventId:attempt) against each arm's P(recover), so runs are
 * reproducible and inspectable, never presented as observed fact.
 */

export const BASELINE_MODEL_VERSION = 'baseline-fixed-schedule-v1';

/** Baseline "Stripe built-in" cadence: fixed retries at +24h/+72h/+168h. */
export const BASELINE_RETRY_OFFSET_HOURS = [24, 72, 168] as const;

/**
 * Fixed schedules ignore hour-of-day/payday timing entirely; published
 * recovery-by-moment data implies they capture well under the optimal-moment
 * rate. The baseline arm's P(recover) is the published attempt curve scaled
 * by this efficiency factor.
 */
export const BASELINE_TIMING_EFFICIENCY = 0.6;

/**
 * Published dunning recovery for customer-actionable failures (expired card,
 * bad CVC): a card-update flow cures roughly half of them. Only HackGuard's
 * policy arm runs dunning — the baseline never asks the customer.
 */
export const POLICY_DUNNING_P_RECOVER = 0.45;

/**
 * Baseline-arm counterfactual P(recover) per attempt. Blindly retrying a
 * hard decline (issuer will never approve) essentially never cures it, and
 * retrying the same card cannot fix a customer-actionable decline — both are
 * published facts, and the baseline gets no dunning channel.
 */
export function baselinePRecover(action: TriageAction, attempt: number): number {
  if (action === 'NEVER_RETRY_HARD') return 0.01;
  if (action === 'ASK_CUSTOMER') return 0.02;
  return Math.max(0.02, (0.38 / Math.pow(2, attempt - 1)) * BASELINE_TIMING_EFFICIENCY);
}

/** Deterministic unit interval in [0,1) derived from an opaque key. */
export function deterministicDraw(key: string): number {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  const u64 = digest.readBigUInt64BE(0);
  // Scale to a float in [0,1) with 44 bits of resolution (BigInt division is
  // integer division, so divide before converting).
  return Number(u64 >> 20n) / 2 ** 44;
}

function recovered(eventId: string, attempt: number, pRecover: number): boolean {
  return deterministicDraw(`${eventId}:${attempt}`) < pRecover;
}

export interface ReplayRunOptions {
  scoring?: ScoringClient;
  now?: Date;
}

export async function runReplay(
  streamId: string,
  events: readonly ReplayEvent[],
  options: ReplayRunOptions = {},
): Promise<ReplayRunRecord> {
  const scorer = options.scoring ?? new PublishedCurveScorer();
  const failures = events.filter((e) => e.kind === 'PAYMENT_FAILED' && e.paymentFailed);
  const latestFailureMs = Math.max(0, ...failures.map((f) => Date.parse(f.paymentFailed?.ts ?? '0')));
  const now = options.now ?? new Date(latestFailureMs);

  const baselineSeries: ReplayOutcomePoint[] = [];
  const policySeries: ReplayOutcomePoint[] = [];
  let degraded = false;

  // History of scheduled reattempts per scope, shared by the guardrail across
  // the whole run so caps bind within a replay just like in production.
  const attemptHistory: AttemptRecord[] = [];

  for (const failure of failures) {
    const event = failure.paymentFailed;
    if (!event) continue;

    // --- Baseline arm: fixed cadence, ignores decline codes entirely ---
    const triageAction = triage(event).action;
    for (const [i, hours] of BASELINE_RETRY_OFFSET_HOURS.entries()) {
      const attempt = event.attempt + i;
      // Baseline P(recover): published curve by attempt, scaled down for the
      // fixed schedule's timing blindness; hard/customer-actionable declines
      // almost never cure by blind same-card retry.
      const pRecover = baselinePRecover(triageAction, attempt);
      const scheduledFor = new Date(Date.parse(event.ts) + hours * 3_600_000).toISOString();
      const didRecover = recovered(failure.eventId, attempt, pRecover);
      baselineSeries.push({
        paymentId: event.stripeId,
        attempt,
        scheduledFor,
        action: 'RETRY',
        pRecover,
        recovered: didRecover,
        amountMinor: event.amountMinor,
      });
      if (didRecover) break; // recovered payments stop the dunning sequence
    }

    // --- Policy arm: triage -> guardrail -> model-timed schedule ---
    const outcome = await decidePaymentOutcome({
      event,
      now,
      attemptHistory,
      scopeKey: scopeKeyFor(event),
      scoring: scorer,
    });
    degraded ||= outcome.degraded;

    if (outcome.decision.action === 'RETRY' && outcome.decision.scheduledFor) {
      const attempt = event.attempt;
      const didRecover = recovered(failure.eventId, attempt, outcome.decision.pRecover);
      policySeries.push({
        paymentId: event.stripeId,
        attempt,
        scheduledFor: outcome.decision.scheduledFor,
        action: 'RETRY',
        pRecover: outcome.decision.pRecover,
        recovered: didRecover,
        amountMinor: event.amountMinor,
      });
      attemptHistory.push({
        scopeKey: scopeKeyFor(event),
        network: triageNetwork(event.cardBrand),
        ts: outcome.decision.scheduledFor,
      });
      if (!didRecover) {
        // One follow-up heuristic retry inside the same cap envelope.
        const followup = await decidePaymentOutcome({
          event: { ...event, attempt: attempt + 1 },
          now,
          attemptHistory,
          scopeKey: scopeKeyFor(event),
          scoring: scorer,
        });
        degraded ||= followup.degraded;
        if (followup.decision.action === 'RETRY' && followup.decision.scheduledFor) {
          const attempt2 = attempt + 1;
          const didRecover2 = recovered(failure.eventId, attempt2, followup.decision.pRecover);
          policySeries.push({
            paymentId: event.stripeId,
            attempt: attempt2,
            scheduledFor: followup.decision.scheduledFor,
            action: 'RETRY',
            pRecover: followup.decision.pRecover,
            recovered: didRecover2,
            amountMinor: event.amountMinor,
          });
          attemptHistory.push({
            scopeKey: scopeKeyFor(event),
            network: triageNetwork(event.cardBrand),
            ts: followup.decision.scheduledFor,
          });
        }
      }
    } else if (outcome.decision.action === 'ASK_CUSTOMER') {
      // Dunning channel (plan §2.5): a card-update request cures a large
      // share of customer-actionable failures — a channel the baseline arm
      // does not have. Same deterministic draw discipline.
      const didRecover = deterministicDraw(`${failure.eventId}:dunning`) < POLICY_DUNNING_P_RECOVER;
      policySeries.push({
        paymentId: event.stripeId,
        attempt: event.attempt,
        scheduledFor: now.toISOString(),
        action: 'ASK_CUSTOMER',
        pRecover: POLICY_DUNNING_P_RECOVER,
        recovered: didRecover,
        amountMinor: event.amountMinor,
      });
    } else {
      policySeries.push({
        paymentId: event.stripeId,
        attempt: event.attempt,
        scheduledFor: outcome.decision.scheduledFor ?? event.ts,
        action: outcome.decision.action,
        pRecover: outcome.decision.pRecover,
        recovered: false,
        amountMinor: event.amountMinor,
      });
    }
  }

  return {
    runId: `run_${createHash('sha1').update(streamId + JSON.stringify(failures.map((f) => f.eventId))).digest('hex').slice(0, 12)}`,
    streamId,
    createdAt: now.toISOString(),
    degraded,
    baseline: summarize(baselineSeries),
    policy: summarize(policySeries),
  };
}

function triageNetwork(brand: string): 'visa' | 'mastercard' | 'other' {
  if (brand === 'visa') return 'visa';
  if (brand === 'mastercard') return 'mastercard';
  return 'other';
}

function summarize(series: ReplayOutcomePoint[]): ReplayRunRecord['baseline'] {
  const recoveredPoints = series.filter((p) => p.recovered);
  return {
    series,
    recoveredCount: recoveredPoints.length,
    recoveredAmountMinor: recoveredPoints.reduce((sum, p) => sum + p.amountMinor, 0),
  };
}

// Guardrail re-export for route-level assertions.
export { evaluateScheduleProposal };

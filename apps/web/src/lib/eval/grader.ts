import type { PaymentFailedEvent } from '@hackguard/contracts';

import { deterministicDraw } from '../replay/engine';
import { evaluateScheduleProposal, type AttemptRecord } from '../compliance/guardrail';
import { triage } from '../triage/rules';
import {
  BASELINE_RETRY_OFFSET_HOURS,
  BASELINE_VERSION,
  candidateMomentsMs,
  type TimingPolicyParams,
} from './policy';
import { pRecoverAt, type ScenarioFailure, type ScenarioStream } from './simulator';

/**
 * Policy grader (eval-loop scope item 2): runs the BASELINE fixed schedule
 * and the PARAMETERIZED policy arm over the identical adversarial streams and
 * scores each arm on:
 *   - recovery rate (recovered / retryable failures)
 *   - compliance-violation count
 *   - penalty-fee exposure in minor units
 *
 * Fee constants are demo-facing but anchored on the verified program rules
 * (docs in compliance/guardrail.ts and the plan §2.4): Visa Cat-1 reattempts
 * incur per-attempt penalty fees; Visa Excessive Reattempts RAF is
 * $0.10/attempt past 15 per 30 days; Mastercard TPE is $0.15/attempt past 35
 * per 30 days.
 */

export const FEE_HARD_DECLINE_RETRY_MINOR = 1_500; // $15.00 per violating Cat-1/MAC reattempt
export const FEE_VISA_RAF_PER_ATTEMPT_MINOR = 10; // $0.10 per attempt past 15 / 30d
export const FEE_MC_TPE_PER_ATTEMPT_MINOR = 15; // $0.15 per attempt past 35 / 30d
export const VISA_RAF_CAP_30D = 15;
export const MC_TPE_CAP_30D = 35;
export const MC_TPE_CAP_24H = 10;

const DAY_MS = 24 * 3_600_000;

export interface ArmMetrics {
  recoveredCount: number;
  /** Failures whose decline code is retryable in principle (soft). */
  retryableCount: number;
  /** recoveredCount / max(1, retryableCount) — stable when the denominator is 0. */
  recoveryRate: number;
  complianceViolations: number;
  penaltyFeeMinor: number;
  recoveredAmountMinor: number;
  /** recoveredAmountMinor - penaltyFeeMinor: the tuning objective. */
  netValueMinor: number;
}

export interface ArmGrade {
  version: string;
  overall: ArmMetrics;
  perScenario: Array<{ scenario: string; metrics: ArmMetrics }>;
}

export function emptyMetrics(): ArmMetrics {
  return {
    recoveredCount: 0,
    retryableCount: 0,
    recoveryRate: 0,
    complianceViolations: 0,
    penaltyFeeMinor: 0,
    recoveredAmountMinor: 0,
    netValueMinor: 0,
  };
}

function finalize(m: ArmMetrics): ArmMetrics {
  return { ...m, recoveryRate: m.recoveredCount / Math.max(1, m.retryableCount), netValueMinor: m.recoveredAmountMinor - m.penaltyFeeMinor };
}

function isRetryable(failure: ScenarioFailure): boolean {
  return triage(failure.event).action === 'RETRY_SOFT';
}

interface ScopeState {
  network: 'visa' | 'mastercard' | 'other';
  attempts: number[]; // ms epochs of EXECUTED reattempts, ascending
}

function scopeKeyOf(event: PaymentFailedEvent): string {
  return `${event.customerId}:${event.cardBrand}`;
}

/**
 * Fees + violations incurred by EXECUTING one reattempt, given the scope's
 * prior executed attempts. This is the measurement lens on the baseline arm;
 * the policy arm consults the real guardrail BEFORE executing, so it can
 * never record a cap violation by construction.
 */
function executionCost(state: ScopeState, code: string, tsMs: number): { violations: number; feeMinor: number } {
  let violations = 0;
  let feeMinor = 0;

  const t = triage({ declineCode: code, cardBrand: state.network === 'visa' ? 'visa' : state.network === 'mastercard' ? 'mastercard' : 'amex' });
  if (t.action === 'NEVER_RETRY_HARD' || t.action === 'ASK_CUSTOMER') {
    // Retrying a do-not-retry / customer-actionable code: penalty fee per
    // attempt, and recovery is impossible (simulator assigns P=0).
    if (t.action === 'NEVER_RETRY_HARD') {
      violations += 1;
      feeMinor += FEE_HARD_DECLINE_RETRY_MINOR;
    }
  }

  if (state.network === 'visa') {
    const in30d = state.attempts.filter((a) => a > tsMs - 30 * DAY_MS).length;
    if (in30d >= VISA_RAF_CAP_30D) {
      violations += 1;
      feeMinor += FEE_VISA_RAF_PER_ATTEMPT_MINOR;
    }
  } else if (state.network === 'mastercard') {
    const in30d = state.attempts.filter((a) => a > tsMs - 30 * DAY_MS).length;
    const in24h = state.attempts.filter((a) => a > tsMs - DAY_MS).length;
    if (in30d >= MC_TPE_CAP_30D) {
      violations += 1;
      feeMinor += FEE_MC_TPE_PER_ATTEMPT_MINOR;
    }
    if (in24h >= MC_TPE_CAP_24H) violations += 1;
  }
  return { violations, feeMinor };
}

function record(m: ArmMetrics, failure: ScenarioFailure, recovered: boolean, amountMinor: number): void {
  if (recovered) {
    m.recoveredCount += 1;
    m.recoveredAmountMinor += amountMinor;
  }
}

/** Baseline arm: fixed +24h/+72h/+168h cadence, ignores decline codes and caps entirely. */
export function gradeBaseline(streams: readonly ScenarioStream[]): ArmGrade {
  const perScenario = streams.map((stream) => {
    const scopes = new Map<string, ScopeState>();
    const m = emptyMetrics();
    for (const failure of stream.failures) {
      if (isRetryable(failure)) m.retryableCount += 1;
      const key = scopeKeyOf(failure.event);
      const state: ScopeState = scopes.get(key) ?? { network: triage(failure.event).network, attempts: [] };
      scopes.set(key, state);
      for (let k = 0; k < BASELINE_RETRY_OFFSET_HOURS.length; k++) {
        const tsMs = Date.parse(failure.event.ts) + (BASELINE_RETRY_OFFSET_HOURS[k] as number) * 3_600_000;
        const cost = executionCost(state, failure.event.declineCode, tsMs);
        m.complianceViolations += cost.violations;
        m.penaltyFeeMinor += cost.feeMinor;
        state.attempts.push(tsMs);
        const p = pRecoverAt(failure, k, tsMs);
        const recovered = deterministicDraw(`${failure.event.stripeId}:${k + 1}`) < p;
        record(m, failure, recovered, failure.event.amountMinor);
        if (recovered) break;
      }
    }
    return { scenario: stream.name, metrics: finalize(m) };
  });
  return { version: BASELINE_VERSION, overall: sumMetrics(perScenario.map((p) => p.metrics)), perScenario };
}

/** Policy arm: triage -> guardrail -> parameterized candidate moments. */
export function gradePolicy(streams: readonly ScenarioStream[], params: TimingPolicyParams): ArmGrade {
  const perScenario = streams.map((stream) => {
    const attemptHistory: AttemptRecord[] = [];
    const m = emptyMetrics();
    for (const failure of stream.failures) {
      const event = failure.event;
      if (isRetryable(failure)) m.retryableCount += 1;
      const t = triage(event);
      if (t.action !== 'RETRY_SOFT') continue; // suppressed before any retry: no fees possible
      const key = scopeKeyOf(event);
      for (let k = 0; k < 3; k++) {
        const moments = candidateMomentsMs(event, params);
        const tsMs = moments[k] as number;
        // The real compliance guardrail has final say before execution.
        const verdict = evaluateScheduleProposal(
          {
            paymentId: event.stripeId,
            scopeKey: key,
            network: t.network,
            triageAction: t.action,
            scheduledFor: new Date(tsMs).toISOString(),
            now: event.ts,
          },
          attemptHistory,
        );
        if (!verdict.allowed) break; // cap budget spent: stop, never violate
        const cost = executionCost({ network: t.network, attempts: attemptHistory.filter((a) => a.scopeKey === key).map((a) => Date.parse(a.ts)) }, event.declineCode, tsMs);
        m.complianceViolations += cost.violations;
        m.penaltyFeeMinor += cost.feeMinor;
        attemptHistory.push({ scopeKey: key, network: t.network, ts: new Date(tsMs).toISOString() });
        const p = pRecoverAt(failure, k, tsMs);
        const recovered = deterministicDraw(`${event.stripeId}:${k + 1}`) < p;
        record(m, failure, recovered, event.amountMinor);
        if (recovered) break;
      }
    }
    return { scenario: stream.name, metrics: finalize(m) };
  });
  return { version: 'policy', overall: sumMetrics(perScenario.map((p) => p.metrics)), perScenario };
}

function sumMetrics(parts: readonly ArmMetrics[]): ArmMetrics {
  const total = emptyMetrics();
  for (const p of parts) {
    total.recoveredCount += p.recoveredCount;
    total.retryableCount += p.retryableCount;
    total.complianceViolations += p.complianceViolations;
    total.penaltyFeeMinor += p.penaltyFeeMinor;
    total.recoveredAmountMinor += p.recoveredAmountMinor;
  }
  return finalize(total);
}

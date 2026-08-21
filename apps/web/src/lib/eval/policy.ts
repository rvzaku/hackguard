import type { PaymentFailedEvent } from '@hackguard/contracts';

/**
 * Parameterized timing policy for the adversarial eval loop (scope item 3).
 *
 * The policy is a SMALL, explicit parameter set — no auto-ML magic:
 *   - firstOffsetHours: delay before the first retry
 *   - stepHours:        spacing between subsequent retries
 *   - paydaySnapDays:   if > 0, a retry moment within this many days after
 *                       the next payday (1st/15th, 09:00 UTC) is snapped ONTO
 *                       the payday — the published payday-alignment prior
 *                       (Slicker, June 2026; see scheduler docs).
 *
 * Tuning (tuner.ts) hill-climbs over a fixed grid of these values on graded
 * failures; every candidate evaluation is a deterministic replay, so round
 * N+1 is always explainable as "these three numbers changed".
 */

export interface TimingPolicyParams {
  firstOffsetHours: number;
  stepHours: number;
  paydaySnapDays: number;
}

/** Policy v1: the pre-tuning default (mirrors the fixed-ish production cadence). */
export const POLICY_V1_PARAMS: TimingPolicyParams = {
  firstOffsetHours: 24,
  stepHours: 72,
  paydaySnapDays: 0,
};

/** Fixed grid the tuner may move within (deterministic, enumerable). */
export const PARAM_GRID: Readonly<Record<keyof TimingPolicyParams, readonly number[]>> = {
  firstOffsetHours: [6, 12, 24, 48],
  stepHours: [12, 24, 48, 72],
  paydaySnapDays: [0, 1, 3, 7, 14],
};

const HOUR_MS = 3_600_000;

/** Baseline "Stripe built-in" cadence: fixed retries at +24h/+72h/+168h. */
export const BASELINE_RETRY_OFFSET_HOURS = [24, 72, 168] as const;

export function policyVersion(round: number): string {
  return `policy-v${round}`;
}
export const BASELINE_VERSION = 'baseline-fixed-schedule-v1';

/**
 * Candidate retry moments (ms epoch) for a failure under the given params:
 * three attempts at firstOffset + k * stepHours, optionally payday-snapped.
 */
export function candidateMomentsMs(event: PaymentFailedEvent, params: TimingPolicyParams): number[] {
  const failureMs = Date.parse(event.ts);
  const moments: number[] = [];
  for (let k = 0; k < 3; k++) {
    moments.push(snapToPayday(failureMs + (params.firstOffsetHours + k * params.stepHours) * HOUR_MS, failureMs, params.paydaySnapDays));
  }
  return moments;
}

/**
 * Snap a candidate moment onto the most recent payday (1st/15th 09:00 UTC)
 * when that payday lies within `snapDays` AFTER the failure (never before it
 * and never more than snapDays past the unsnapped moment).
 */
export function snapToPayday(momentMs: number, failureMs: number, snapDays: number): number {
  if (snapDays <= 0) return momentMs;
  const snapped = mostRecentPaydayOnOrAfter(failureMs);
  if (snapped === null) return momentMs;
  const snapWindowMs = snapDays * 24 * HOUR_MS;
  // Snap onto the payday when it falls in (failure, failure + snapWindow].
  if (snapped > failureMs && snapped <= failureMs + snapWindowMs) return snapped;
  return momentMs;
}

/** Most recent payday (1st/15th, 09:00 UTC) at or after `afterMs`, else null if > 31d out. */
export function mostRecentPaydayOnOrAfter(afterMs: number): number | null {
  const start = new Date(afterMs);
  for (let dayOffset = 0; dayOffset <= 31; dayOffset++) {
    const candidate = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + dayOffset, 9, 0, 0, 0),
    );
    if (candidate.getTime() >= afterMs && (candidate.getUTCDate() === 1 || candidate.getUTCDate() === 15)) {
      return candidate.getTime();
    }
  }
  return null;
}

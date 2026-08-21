import type { PaymentFailedEvent } from '@hackguard/contracts';

import { AppError } from '../errors.js';
import type { ScoringClient, ScoreResult } from '../scoring/client.js';

/**
 * Retry scheduler (plan WS-B): scores P(recover) at each candidate retry
 * moment via the scoring sidecar and schedules the argmax moment. When the
 * sidecar is unreachable or returns garbage, it degrades to the published
 * recovery-by-attempt curve heuristic and flags the decision `degraded: true`
 * so the UI and the audit ledger disclose the fallback (plan §6 failure
 * tests: "rate-limit fallback", "DB outage degradation").
 */

/** Candidate offsets from the failure moment (published-curve sweet spots). */
export const CANDIDATE_OFFSET_HOURS = [6, 24, 48, 72, 120] as const;

/**
 * Published industry recovery-by-retry-attempt curve (Recurly/Stripe/Slicker
 * published data, plan §3 "ML design"). Indexed by attempt number - 1.
 */
export const PUBLISHED_CURVE_BY_ATTEMPT = [0.38, 0.24, 0.15, 0.09, 0.05] as const;

export const FALLBACK_MODEL_VERSION = 'published-curve-fallback-v1';

export interface ScheduleDecision {
  scheduledFor: string;
  pRecover: number;
  modelVersion: string;
  shapTop: ScoreResult['shapTop'];
  degraded: boolean;
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}

function clamp01(p: number): number {
  return Math.min(1, Math.max(0, p));
}

/** Heuristic moment: first retry lands in the 24h window, later ones at 72h. */
export function fallbackSchedule(event: PaymentFailedEvent): ScheduleDecision {
  const idx = Math.min(event.attempt, PUBLISHED_CURVE_BY_ATTEMPT.length) - 1;
  const pRecover = PUBLISHED_CURVE_BY_ATTEMPT[idx] ?? PUBLISHED_CURVE_BY_ATTEMPT[0];
  return {
    scheduledFor: addHours(event.ts, event.attempt <= 2 ? 24 : 72),
    pRecover,
    modelVersion: FALLBACK_MODEL_VERSION,
    shapTop: [],
    degraded: true,
  };
}

/**
 * Offline ScoringClient backed by the published curve — used by the replay
 * harness (deterministic, inspectable) and as the degraded-mode scorer.
 */
export class PublishedCurveScorer implements ScoringClient {
  async score(event: PaymentFailedEvent): Promise<ScoreResult> {
    const idx = Math.min(event.attempt, PUBLISHED_CURVE_BY_ATTEMPT.length) - 1;
    return {
      pRecover: PUBLISHED_CURVE_BY_ATTEMPT[idx] ?? PUBLISHED_CURVE_BY_ATTEMPT[0],
      modelVersion: FALLBACK_MODEL_VERSION,
      shapTop: [],
    };
  }
}

/**
 * Scores every candidate moment and picks the best. Any sidecar failure
 * (unreachable, HTTP error, contract-invalid body) degrades to the heuristic.
 */
export async function scheduleRetry(
  event: PaymentFailedEvent,
  scoring: ScoringClient,
): Promise<ScheduleDecision> {
  try {
    const scored = await Promise.all(
      CANDIDATE_OFFSET_HOURS.map(async (hours) => {
        const candidateEvent: PaymentFailedEvent = { ...event, ts: addHours(event.ts, hours) };
        const result = await scoring.score(candidateEvent);
        return { hours, result };
      }),
    );
    const best = scored.reduce((a, b) => (b.result.pRecover > a.result.pRecover ? b : a));
    return {
      scheduledFor: addHours(event.ts, best.hours),
      pRecover: clamp01(best.result.pRecover),
      modelVersion: best.result.modelVersion,
      shapTop: best.result.shapTop.slice(0, 5),
      degraded: false,
    };
  } catch (err) {
    if (err instanceof AppError && (err.code === 'SCORING_UNAVAILABLE' || err.code === 'SCORING_INVALID_RESPONSE')) {
      return fallbackSchedule(event);
    }
    throw err;
  }
}

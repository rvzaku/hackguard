import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CAPS,
  evaluateScheduleProposal,
  type AttemptRecord,
  type ScheduleProposal,
} from '../src/lib/compliance/guardrail';
import { decidePaymentOutcome } from '../src/lib/pipeline';
import { PublishedCurveScorer } from '../src/lib/scheduler/scheduler';
import { triage, type TriageAction } from '../src/lib/triage/rules';
import { makeEvent, useMemoryRuntime } from './helpers';

/**
 * Property-based proofs of the compliance invariants (plan §6):
 *   1. no accepted schedule can exceed a verified network cap;
 *   2. hard declines are NEVER retried — by rule, not by model.
 */

const NOW = Date.parse('2026-08-22T10:15:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Arbitrary attempt history: 0..40 attempts spread over +-40 days.
const attemptHistoryArb = fc
  .array(
    fc.record({
      offsetDays: fc.integer({ min: -40, max: 40 }),
      network: fc.constantFrom<'visa' | 'mastercard' | 'other'>('visa', 'mastercard', 'other'),
    }),
    { maxLength: 40 },
  )
  .map((rows) =>
    rows.map<AttemptRecord>((r) => ({
      scopeKey: 'cus_test:visa',
      network: r.network,
      ts: new Date(NOW + r.offsetDays * DAY).toISOString(),
    })),
  );

function proposalFor(action: TriageAction, network: 'visa' | 'mastercard' | 'other'): ScheduleProposal {
  return {
    paymentId: 'pay_prop',
    scopeKey: 'cus_test:visa',
    network,
    triageAction: action,
    scheduledFor: new Date(NOW + HOUR).toISOString(),
    now: new Date(NOW).toISOString(),
  };
}

/** Post-state counting, mirroring the guardrail's committed-budget semantics. */
function committedSince(history: readonly AttemptRecord[], fromMs: number): number {
  return history.filter((a) => Date.parse(a.ts) > fromMs).length;
}

describe('compliance guardrail — property: hard declines are never retried', () => {
  it('NEVER_RETRY_HARD and ASK_CUSTOMER proposals are always rejected', () => {
    fc.assert(
      fc.property(attemptHistoryArb, fc.constantFrom<TriageAction>('NEVER_RETRY_HARD', 'ASK_CUSTOMER'), (history, action) => {
        for (const network of ['visa', 'mastercard', 'other'] as const) {
          const verdict = evaluateScheduleProposal(proposalFor(action, network), history);
          expect(verdict.allowed).toBe(false);
          expect(verdict.violations.some((v) => v.ruleId === 'GUARDRAIL-HARD-DECLINE-NEVER-RETRIED')).toBe(
            true,
          );
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('compliance guardrail — property: Visa 15 reattempts / 30d cap', () => {
  it('an accepted visa schedule always leaves the 30d cap intact', () => {
    fc.assert(
      fc.property(attemptHistoryArb, (history) => {
        const verdict = evaluateScheduleProposal(proposalFor('RETRY_SOFT', 'visa'), history);
        if (verdict.allowed) {
          const after: AttemptRecord[] = [
            ...history,
            { scopeKey: 'cus_test:visa', network: 'visa', ts: new Date(NOW + HOUR).toISOString() },
          ];
          expect(committedSince(after, NOW - 30 * DAY)).toBeLessThanOrEqual(CAPS.VISA_MAX_REATTEMPTS_30D);
        } else {
          expect(
            committedSince(history, NOW - 30 * DAY),
          ).toBeGreaterThanOrEqual(CAPS.VISA_MAX_REATTEMPTS_30D);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('compliance guardrail — property: Mastercard 10/24h and 35/30d caps', () => {
  it('an accepted mastercard schedule never violates either cap', () => {
    fc.assert(
      fc.property(attemptHistoryArb, (history) => {
        const verdict = evaluateScheduleProposal(proposalFor('RETRY_SOFT', 'mastercard'), history);
        if (verdict.allowed) {
          const after: AttemptRecord[] = [
            ...history,
            { scopeKey: 'cus_test:visa', network: 'mastercard', ts: new Date(NOW + HOUR).toISOString() },
          ];
          const within48hAroundNow = after.filter(
            (a) => Date.parse(a.ts) > NOW - DAY && Date.parse(a.ts) <= NOW + DAY,
          ).length;
          expect(within48hAroundNow).toBeLessThanOrEqual(CAPS.MC_MAX_RETRIES_24H);
          expect(committedSince(after, NOW - 30 * DAY)).toBeLessThanOrEqual(CAPS.MC_MAX_RETRIES_30D);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('pipeline — property: the decision layer never schedules a hard decline', () => {
  it('for arbitrary events, action RETRY implies the triage was RETRY_SOFT and the guardrail passed', async () => {
    useMemoryRuntime();
    const declineCodes = [
      'lost_card',
      'stolen_card',
      'insufficient_funds',
      'try_again_later',
      'mac_01',
      'mac_03',
      'mac_21',
      'mac_02',
      'expired_card',
      'generic_decline',
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          declineCode: fc.constantFrom(...declineCodes),
          cardBrand: fc.constantFrom<'visa' | 'mastercard' | 'amex'>('visa', 'mastercard', 'amex'),
          attempt: fc.integer({ min: 1, max: 40 }),
          historySize: fc.integer({ min: 0, max: 40 }),
        }),
        async ({ declineCode, cardBrand, attempt, historySize }) => {
          const event = makeEvent({ declineCode, cardBrand, attempt });
          const network = cardBrand === 'visa' ? 'visa' : cardBrand === 'mastercard' ? 'mastercard' : 'other';
          const history: AttemptRecord[] = Array.from({ length: historySize }, (_, i) => ({
            scopeKey: `${event.customerId}:${event.cardBrand}`,
            network,
            ts: new Date(NOW - i * HOUR).toISOString(),
          }));
          const outcome = await decidePaymentOutcome({
            event,
            now: new Date(NOW),
            attemptHistory: history,
            scopeKey: `${event.customerId}:${event.cardBrand}`,
            scoring: new PublishedCurveScorer(),
          });
          if (outcome.decision.action === 'RETRY') {
            expect(outcome.triageAction).toBe('RETRY_SOFT');
            expect(outcome.blockedBy).toHaveLength(0);
            expect(triage(event).action).toBe('RETRY_SOFT');
          } else {
            expect(outcome.decision.scheduledFor ?? null).toBeFalsy();
          }
          // Rule citations are always stored with the decision.
          expect(outcome.decision.ruleHits.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

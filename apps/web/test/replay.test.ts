import { describe, expect, it } from 'vitest';

import { runReplay, deterministicDraw, BASELINE_RETRY_OFFSET_HOURS } from '../src/lib/replay/engine';
import { makeReplayEvent, useMemoryRuntime } from './helpers';

/**
 * Replay harness: baseline fixed schedule vs policy decisions over the
 * identical captured stream. Deterministic, inspectable, counterfactual.
 */

function capturedStream() {
  return [
    makeReplayEvent({
      eventId: 'rep_visa_soft_1',
      paymentFailed: {
        stripeId: 'in_visa_soft_1',
        customerId: 'cus_a',
        amountMinor: 2900,
        currency: 'usd',
        declineCode: 'insufficient_funds',
        attempt: 2,
        cardBrand: 'visa',
        ts: '2026-08-20T09:00:00Z',
      },
    }),
    makeReplayEvent({
      eventId: 'rep_visa_hard_1',
      paymentFailed: {
        stripeId: 'in_visa_hard_1',
        customerId: 'cus_b',
        amountMinor: 9900,
        currency: 'usd',
        declineCode: 'stolen_card',
        attempt: 1,
        cardBrand: 'visa',
        ts: '2026-08-20T11:00:00Z',
      },
    }),
    makeReplayEvent({
      eventId: 'rep_mc_hard_1',
      paymentFailed: {
        stripeId: 'in_mc_hard_1',
        customerId: 'cus_c',
        amountMinor: 1500,
        currency: 'usd',
        declineCode: 'mac_03',
        attempt: 1,
        cardBrand: 'mastercard',
        ts: '2026-08-21T08:30:00Z',
      },
    }),
    makeReplayEvent({
      eventId: 'rep_recovery_1',
      kind: 'PAYMENT_RECOVERED',
      paymentFailed: null,
    }),
  ];
}

describe('runReplay', () => {
  it('is deterministic: two runs over the same stream produce identical series', async () => {
    useMemoryRuntime();
    const a = await runReplay('stream_x', capturedStream());
    const b = await runReplay('stream_x', capturedStream());
    expect(a).toEqual(b);
  });

  it('runs both arms over the identical stream and stores outcome series', async () => {
    useMemoryRuntime();
    const run = await runReplay('stream_x', capturedStream());
    expect(run.streamId).toBe('stream_x');
    expect(run.baseline.series.length).toBeGreaterThan(0);
    expect(run.policy.series.length).toBeGreaterThan(0);

    // Baseline retries everything on the fixed cadence (3 attempts each).
    const baselineByPayment = run.baseline.series.filter((p) => p.paymentId === 'in_visa_soft_1');
    expect(baselineByPayment).toHaveLength(BASELINE_RETRY_OFFSET_HOURS.length);
    for (const [i, point] of baselineByPayment.entries()) {
      expect(point.action).toBe('RETRY');
      expect(point.attempt).toBe(2 + i);
    }

    // Policy arm suppresses hard declines (stolen_card, mac_03).
    const policyHard = run.policy.series.filter(
      (p) => p.paymentId === 'in_visa_hard_1' || p.paymentId === 'in_mc_hard_1',
    );
    expect(policyHard.length).toBe(2);
    for (const point of policyHard) {
      expect(point.action).not.toBe('RETRY');
      expect(point.recovered).toBe(false);
    }
    // ...while the soft decline gets a model-timed RETRY.
    expect(
      run.policy.series.some((p) => p.paymentId === 'in_visa_soft_1' && p.action === 'RETRY'),
    ).toBe(true);
  });

  it('summarizes recovered counts and dollars consistently with the series', async () => {
    useMemoryRuntime();
    const run = await runReplay('stream_x', capturedStream());
    for (const arm of [run.baseline, run.policy] as const) {
      const recoveredPoints = arm.series.filter((p) => p.recovered);
      expect(arm.recoveredCount).toBe(recoveredPoints.length);
      expect(arm.recoveredAmountMinor).toBe(
        recoveredPoints.reduce((sum, p) => sum + p.amountMinor, 0),
      );
    }
    expect(run.degraded).toBe(false); // published-curve scorer is not degraded mode
  });

  it('ignores PAYMENT_RECOVERED rows and empty streams safely', async () => {
    useMemoryRuntime();
    const empty = await runReplay('stream_empty', []);
    expect(empty.baseline.series).toHaveLength(0);
    expect(empty.policy.series).toHaveLength(0);
    const onlyRecovery = await runReplay('stream_rec', [
      makeReplayEvent({ eventId: 'r1', kind: 'PAYMENT_RECOVERED', paymentFailed: null }),
    ]);
    expect(onlyRecovery.baseline.series).toHaveLength(0);
  });
});

describe('deterministicDraw', () => {
  it('is stable per key and uniform enough', () => {
    expect(deterministicDraw('rep_1:1')).toBe(deterministicDraw('rep_1:1'));
    expect(deterministicDraw('rep_1:1')).not.toBe(deterministicDraw('rep_1:2'));
    const draws = Array.from({ length: 200 }, (_, i) => deterministicDraw(`k${i}`));
    for (const d of draws) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(1);
    }
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.7);
  });
});

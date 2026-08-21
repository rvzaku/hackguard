import { describe, expect, it } from 'vitest';

import { EvalLoopArtifactSchema } from '../src/lib/eval/artifact';
import { gridNeighbors, runEvalLoop } from '../src/lib/eval/tuner';
import { POLICY_V1_PARAMS } from '../src/lib/eval/policy';

/**
 * Tuning-loop tests (eval-loop scope item 5): the loop is deterministic, the
 * objective never degrades across rounds, the policy arm never violates, and
 * the emitted artifact validates against the shared contract.
 */

describe('gridNeighbors', () => {
  it('enumerates one-step neighbors on-grid, deduplicated, excluding the incumbent', () => {
    const neighbors = gridNeighbors(POLICY_V1_PARAMS);
    // v1 = {24, 72, 0}: firstOffsetHours has room both ways (2 moves),
    // stepHours only down (1), paydaySnapDays only up (1) -> four neighbors.
    expect(neighbors).toHaveLength(4);
    for (const n of neighbors) {
      expect(Object.keys(n).sort()).toEqual(['firstOffsetHours', 'paydaySnapDays', 'stepHours']);
    }
    const keys = new Set(neighbors.map((n) => `${n.firstOffsetHours}|${n.stepHours}|${n.paydaySnapDays}`));
    expect(keys.size).toBe(neighbors.length);
    expect(keys.has('24|72|0')).toBe(false);
  });

  it('rejects off-grid parameter sets', () => {
    expect(() => gridNeighbors({ firstOffsetHours: 25, stepHours: 72, paydaySnapDays: 0 })).toThrow(/off-grid/);
  });
});

describe('runEvalLoop', () => {
  const artifact = runEvalLoop();

  it('emits an artifact that validates against the shared contract', () => {
    expect(() => EvalLoopArtifactSchema.parse(artifact)).not.toThrow();
  });

  it('is deterministic for a fixed seed (modulo the generation timestamp)', () => {
    const again = runEvalLoop();
    const strip = (a: typeof again) => JSON.stringify({ ...a, generatedAt: '' });
    expect(strip(again)).toBe(strip(artifact));
  });

  it('never degrades: net value is monotonically non-decreasing across rounds', () => {
    for (let i = 1; i < artifact.rounds.length; i++) {
      expect(artifact.rounds[i]!.metrics.netValueMinor).toBeGreaterThanOrEqual(
        artifact.rounds[i - 1]!.metrics.netValueMinor,
      );
    }
  });

  it('improves or preserves recovery rate, with zero policy violations in every round', () => {
    const first = artifact.rounds[0]!.metrics;
    const final = artifact.rounds[artifact.rounds.length - 1]!.metrics;
    expect(final.recoveryRate).toBeGreaterThanOrEqual(first.recoveryRate);
    for (const round of artifact.rounds) {
      expect(round.metrics.complianceViolations).toBe(0);
      expect(round.metrics.penaltyFeeMinor).toBe(0);
    }
  });

  it('shows a real improvement over the tuning rounds (the visible-loop requirement)', () => {
    const first = artifact.rounds[0]!.metrics;
    const final = artifact.rounds[artifact.rounds.length - 1]!.metrics;
    expect(final.netValueMinor).toBeGreaterThan(first.netValueMinor);
    expect(final.recoveryRate).toBeGreaterThan(first.recoveryRate);
    // And the tuned policy beats the baseline's fee exposure outright.
    expect(final.penaltyFeeMinor).toBeLessThan(artifact.baselineMetrics.penaltyFeeMinor);
    expect(final.recoveredAmountMinor).toBeGreaterThan(artifact.baselineMetrics.recoveredAmountMinor);
  });

  it('records params for every round and labels only improving rounds improved', () => {
    expect(artifact.rounds[0]!.improved).toBe(false);
    for (let i = 1; i < artifact.rounds.length; i++) {
      const prev = artifact.rounds[i - 1]!;
      const cur = artifact.rounds[i]!;
      expect(cur.improved).toBe(cur.metrics.netValueMinor > prev.metrics.netValueMinor);
    }
  });

  it('summary matches the round series', () => {
    expect(artifact.summary.recoveryRateFirst).toBe(artifact.rounds[0]!.metrics.recoveryRate);
    expect(artifact.summary.recoveryRateFinal).toBe(artifact.rounds[artifact.rounds.length - 1]!.metrics.recoveryRate);
    expect(artifact.summary.violationsFinal).toBe(0);
  });
});

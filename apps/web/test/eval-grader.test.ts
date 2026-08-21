import { describe, expect, it } from 'vitest';

import { gradeBaseline, gradePolicy } from '../src/lib/eval/grader';
import { POLICY_V1_PARAMS } from '../src/lib/eval/policy';
import { simulateCorpus, type ScenarioFailure, type ScenarioStream } from '../src/lib/eval/simulator';
import { triage } from '../src/lib/triage/rules';

/**
 * Grading correctness on golden cases (eval-loop scope item 5): the baseline
 * arm must demonstrably incur penalty fees and cap violations on adversarial
 * streams; the policy arm (real triage + real guardrail) must never violate.
 */

function oneStream(name: string, failures: ScenarioFailure[]): ScenarioStream[] {
  return [{ name, description: 'golden', failures }];
}

const corpus = simulateCorpus(20260822);

describe('gradeBaseline vs gradePolicy — golden cases', () => {
  it('penalty-trap stream: baseline pays hard-decline fees, policy pays nothing', () => {
    const traps = corpus.streams.find((s) => s.name === 'penalty-traps');
    expect(traps).toBeDefined();
    const streams = oneStream(traps!.name, traps!.failures);

    const baseline = gradeBaseline(streams);
    // Every never-retry execution costs exactly $15: 3 fixed attempts per
    // hard-decline failure (ask-customer codes waste attempts but carry no fee).
    const hardFailures = traps!.failures.filter((f) => triage(f.event).action === 'NEVER_RETRY_HARD');
    expect(hardFailures.length).toBeGreaterThan(0);
    expect(baseline.overall.complianceViolations).toBeGreaterThan(0);
    expect(baseline.overall.penaltyFeeMinor).toBe(hardFailures.length * 3 * 1500);
    expect(baseline.overall.recoveredCount).toBe(0); // P=0 on every trap code

    const policy = gradePolicy(streams, POLICY_V1_PARAMS);
    expect(policy.overall.complianceViolations).toBe(0);
    expect(policy.overall.penaltyFeeMinor).toBe(0);
    expect(policy.overall.recoveredCount).toBe(0); // correctly suppressed
  });

  it('cap-exceed stream: baseline blows past the visa 15/30d cap, policy stops at the guardrail', () => {
    const caps = corpus.streams.find((s) => s.name === 'cap-exceed');
    expect(caps).toBeDefined();
    const streams = oneStream(caps!.name, caps!.failures);

    const baseline = gradeBaseline(streams);
    expect(baseline.overall.complianceViolations).toBeGreaterThan(0);
    expect(baseline.overall.penaltyFeeMinor).toBeGreaterThan(0);

    const policy = gradePolicy(streams, POLICY_V1_PARAMS);
    expect(policy.overall.complianceViolations).toBe(0);
    expect(policy.overall.penaltyFeeMinor).toBe(0);
    // The policy still recovers some of the scope's failures within the cap.
    expect(policy.overall.retryableCount).toBe(caps!.failures.length);
  });

  it('payday stream: payday-snapped params recover strictly more than unsnapped v1', () => {
    const payday = corpus.streams.find((s) => s.name === 'payday-timing');
    expect(payday).toBeDefined();
    const streams = oneStream(payday!.name, payday!.failures);

    const v1 = gradePolicy(streams, POLICY_V1_PARAMS);
    const snapped = gradePolicy(streams, { firstOffsetHours: 24, stepHours: 48, paydaySnapDays: 7 });
    expect(snapped.overall.recoveredCount).toBeGreaterThanOrEqual(v1.overall.recoveredCount);
    expect(snapped.overall.netValueMinor).toBeGreaterThan(v1.overall.netValueMinor);
  });

  it('hostile-ordering stream: policy suppresses the hard lead-in and still recovers the soft follow-up', () => {
    const hostile = corpus.streams.find((s) => s.name === 'hostile-ordering');
    expect(hostile).toBeDefined();
    const streams = oneStream(hostile!.name, hostile!.failures);

    const baseline = gradeBaseline(streams);
    expect(baseline.overall.complianceViolations).toBeGreaterThan(0);

    const policy = gradePolicy(streams, { firstOffsetHours: 24, stepHours: 48, paydaySnapDays: 7 });
    expect(policy.overall.complianceViolations).toBe(0);
    expect(policy.overall.recoveredCount).toBeGreaterThan(0);
  });
});

describe('grading invariants', () => {
  it('policy arm records zero violations across many seeds (guardrail property)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { streams } = simulateCorpus(seed * 7919);
      const policy = gradePolicy(streams, POLICY_V1_PARAMS);
      expect(policy.overall.complianceViolations).toBe(0);
      expect(policy.overall.penaltyFeeMinor).toBe(0);
    }
  });

  it('metrics are internally consistent (rate matches counts, net = recovered - fees)', () => {
    const baseline = gradeBaseline(corpus.streams);
    const m = baseline.overall;
    expect(m.recoveryRate).toBeCloseTo(m.recoveredCount / Math.max(1, m.retryableCount), 12);
    expect(m.netValueMinor).toBe(m.recoveredAmountMinor - m.penaltyFeeMinor);
    expect(baseline.perScenario).toHaveLength(corpus.streams.length);
    const sumRecovered = baseline.perScenario.reduce((acc, p) => acc + p.metrics.recoveredAmountMinor, 0);
    expect(sumRecovered).toBe(m.recoveredAmountMinor);
  });

  it('is deterministic: identical inputs produce identical grades', () => {
    const a = gradeBaseline(corpus.streams);
    const b = gradeBaseline(corpus.streams);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

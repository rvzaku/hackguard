import { describe, expect, it } from 'vitest';

import { PaymentFailedEventSchema } from '@hackguard/contracts';

import { mulberry32 } from '../src/lib/eval/rng';
import {
  alignmentFactor,
  attemptDecay,
  nextPaydayMs,
  pRecoverAt,
  simulateCorpus,
} from '../src/lib/eval/simulator';

/**
 * Simulator determinism + ground-truth invariants (eval-loop scope item 5):
 * identical seeds must produce bit-identical streams, and every generated
 * event must satisfy the frozen payment contract.
 */

const SEED = 20260822;

describe('eval simulator determinism', () => {
  it('produces identical corpora for identical seeds', () => {
    const a = simulateCorpus(SEED);
    const b = simulateCorpus(SEED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces different corpora for different seeds', () => {
    const a = simulateCorpus(SEED);
    const b = simulateCorpus(SEED + 1);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('covers all five adversarial families with non-empty streams', () => {
    const { streams } = simulateCorpus(SEED);
    expect(streams.map((s) => s.name)).toEqual([
      'payday-timing',
      'penalty-traps',
      'cap-exceed',
      'hostile-ordering',
      'mixed-tenure',
    ]);
    for (const stream of streams) {
      expect(stream.failures.length).toBeGreaterThan(0);
    }
  });
});

describe('eval simulator ground truth invariants', () => {
  const { streams } = simulateCorpus(SEED);
  const all = streams.flatMap((s) => s.failures);

  it('every generated event satisfies the PaymentFailedEvent contract', () => {
    for (const failure of all) {
      expect(() => PaymentFailedEventSchema.parse(failure.event)).not.toThrow();
    }
  });

  it('hard/do-not-retry codes carry zero propensity (retrying can never recover)', () => {
    const traps = streams.find((s) => s.name === 'penalty-traps');
    expect(traps).toBeDefined();
    for (const failure of traps?.failures ?? []) {
      expect(failure.groundTruth.propensity).toBe(0);
    }
  });

  it('soft-decline cure moments never precede the failure', () => {
    for (const failure of all) {
      if (failure.groundTruth.propensity > 0) {
        expect(failure.groundTruth.cureAtMs).toBeGreaterThanOrEqual(Date.parse(failure.event.ts));
      }
    }
  });

  it('payday stream cures land on a 1st or 15th at 09:00 UTC', () => {
    const payday = streams.find((s) => s.name === 'payday-timing');
    for (const failure of payday?.failures ?? []) {
      const d = new Date(failure.groundTruth.cureAtMs);
      expect([1, 15]).toContain(d.getUTCDate());
      expect(d.getUTCHours()).toBe(9);
    }
  });
});

describe('ground-truth outcome model', () => {
  const base = simulateCorpus(SEED).streams[0]?.failures[0];
  if (!base) throw new Error('simulator produced no failures');

  it('rewards in-window retries over off-cycle retries monotonically', () => {
    const inWindow = pRecoverAt(base, 0, base.groundTruth.cureAtMs + 1000);
    const late = pRecoverAt(base, 0, base.groundTruth.cureAtMs + 3 * 24 * 3_600_000);
    const off = pRecoverAt(base, 0, base.groundTruth.cureAtMs + 20 * 24 * 3_600_000);
    expect(inWindow).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(off);
  });

  it('decays by retry attempt', () => {
    expect(attemptDecay(0)).toBeGreaterThan(attemptDecay(1));
    expect(attemptDecay(1)).toBeGreaterThan(attemptDecay(2));
  });

  it('alignment factor is piecewise-stable and bounded', () => {
    expect(alignmentFactor(base.groundTruth.cureAtMs, base.groundTruth.cureAtMs)).toBe(1.0);
    expect(alignmentFactor(base.groundTruth.cureAtMs - 10_000, base.groundTruth.cureAtMs)).toBeLessThanOrEqual(0.12);
  });
});

describe('nextPaydayMs', () => {
  it('finds the next 1st/15th strictly after the given moment', () => {
    // July 10 2026 -> July 15.
    expect(nextPaydayMs(Date.UTC(2026, 6, 10))).toBe(Date.UTC(2026, 6, 15, 9));
    // July 15 09:00 exactly -> Aug 1 (strictly after).
    expect(nextPaydayMs(Date.UTC(2026, 6, 15, 9))).toBe(Date.UTC(2026, 7, 1, 9));
    // July 31 -> Aug 1.
    expect(nextPaydayMs(Date.UTC(2026, 6, 31, 23))).toBe(Date.UTC(2026, 7, 1, 9));
  });
});

describe('rng', () => {
  it('is deterministic per seed and int() stays in range', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = r.int(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

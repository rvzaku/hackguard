import { describe, expect, it } from 'vitest';

import { AppError } from '../src/lib/errors';
import { ScoringSidecarClient } from '../src/lib/scoring/client';
import {
  CANDIDATE_OFFSET_HOURS,
  fallbackSchedule,
  FALLBACK_MODEL_VERSION,
  PublishedCurveScorer,
  scheduleRetry,
} from '../src/lib/scheduler/scheduler';
import { makeEvent } from './helpers';

const EVENT = makeEvent(); // ts 2026-08-22T10:15:00Z

describe('scheduleRetry with a healthy sidecar', () => {
  it('picks the argmax candidate moment and reports non-degraded', async () => {
    // P(recover) peaks at +48h.
    const scorer = {
      async score(event: { ts: string }) {
        const hours = (Date.parse(event.ts) - Date.parse(EVENT.ts)) / 3_600_000;
        return { pRecover: Math.max(0.01, 1 - Math.abs(hours - 48) / 100), modelVersion: 'fake-v9', shapTop: [] };
      },
    };
    const decision = await scheduleRetry(EVENT, scorer);
    expect(decision.scheduledFor).toBe('2026-08-24T10:15:00.000Z'); // +48h
    expect(decision.degraded).toBe(false);
    expect(decision.modelVersion).toBe('fake-v9');
    expect(decision.pRecover).toBeGreaterThan(0.9);
  });

  it('only ever schedules at one of the published candidate offsets', async () => {
    const scorer = {
      async score() {
        return { pRecover: Math.random(), modelVersion: 'rand-v1', shapTop: [] };
      },
    };
    for (let i = 0; i < 20; i++) {
      const decision = await scheduleRetry(makeEvent({ stripeId: `evt_${i}` }), scorer);
      const offsetHours =
        (Date.parse(decision.scheduledFor) - Date.parse(EVENT.ts)) / 3_600_000;
      expect(CANDIDATE_OFFSET_HOURS).toContain(offsetHours);
    }
  });
});

describe('scheduleRetry degraded fallback (sidecar outage)', () => {
  it.each([
    ['unreachable', new AppError('SCORING_UNAVAILABLE', 'boom')],
    ['invalid response', new AppError('SCORING_INVALID_RESPONSE', 'bad body')],
  ])('falls back to the published curve on %s', async (_name, err) => {
    const failing = {
      score: () => {
        throw err;
      },
    };
    const decision = await scheduleRetry(EVENT, failing);
    expect(decision.degraded).toBe(true);
    expect(decision.modelVersion).toBe(FALLBACK_MODEL_VERSION);
    expect(decision.scheduledFor).toBe('2026-08-23T10:15:00.000Z'); // attempt 1 -> +24h
    expect(decision.pRecover).toBeGreaterThan(0);
    expect(decision.pRecover).toBeLessThanOrEqual(1);
  });

  it('rethrows unexpected errors instead of masking them', async () => {
    const boom = { score: () => Promise.reject(new Error('socket hang up')) };
    await expect(scheduleRetry(EVENT, boom)).rejects.toThrow('socket hang up');
  });

  it('later attempts land further out per the heuristic', () => {
    expect(fallbackSchedule(makeEvent({ attempt: 4 })).scheduledFor).toBe(
      '2026-08-25T10:15:00.000Z',
    ); // +72h
  });
});

describe('ScoringSidecarClient (typed OpenAPI boundary)', () => {
  const validDecisionBody = {
    paymentId: EVENT.stripeId,
    action: 'RETRY',
    scheduledFor: '2026-08-23T10:15:00Z',
    pRecover: 0.42,
    shapTop: [{ feature: 'attempt_number', contribution: -0.3 }],
    ruleHits: [],
    modelVersion: 'propensity-v0.1.0',
  };

  it('validates responses against the frozen Decision contract', async () => {
    const client = new ScoringSidecarClient('http://sidecar.test', async () =>
      Response.json(validDecisionBody),
    );
    const result = await client.score(EVENT);
    expect(result.pRecover).toBe(0.42);
    expect(result.modelVersion).toBe('propensity-v0.1.0');
    expect(result.shapTop).toHaveLength(1);
  });

  it('maps HTTP failures to SCORING_UNAVAILABLE', async () => {
    const client = new ScoringSidecarClient('http://sidecar.test', async () => new Response(null, { status: 503 }));
    await expect(client.score(EVENT)).rejects.toMatchObject({ code: 'SCORING_UNAVAILABLE' });
  });

  it('maps network errors to SCORING_UNAVAILABLE', async () => {
    const client = new ScoringSidecarClient('http://sidecar.test', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(client.score(EVENT)).rejects.toMatchObject({ code: 'SCORING_UNAVAILABLE' });
  });

  it('maps contract-invalid bodies to SCORING_INVALID_RESPONSE', async () => {
    const client = new ScoringSidecarClient('http://sidecar.test', async () =>
      Response.json({ pRecover: 'not-a-number' }),
    );
    await expect(client.score(EVENT)).rejects.toMatchObject({ code: 'SCORING_INVALID_RESPONSE' });
  });
});

describe('PublishedCurveScorer', () => {
  it('decays monotonically with attempt number', async () => {
    const scorer = new PublishedCurveScorer();
    let prev = 1;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { pRecover } = await scorer.score(makeEvent({ attempt }));
      expect(pRecover).toBeLessThan(prev);
      prev = pRecover;
    }
  });
});

import { describe, expect, it } from 'vitest';

import { POST as seedPOST } from '../src/app/api/replay/seed/route';
import { POST as runPOST } from '../src/app/api/replay/run/route';
import { makeReplayEvent, useMemoryRuntime } from './helpers';

/** Route-level tests for the replay harness endpoints. */

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/replay/seed', () => {
  it('validates and stores a captured stream (201)', async () => {
    const runtime = useMemoryRuntime();
    const res = await seedPOST(
      jsonRequest('http://localhost/api/replay/seed', {
        streamId: 'cap_2026_08_22',
        events: [makeReplayEvent({ eventId: 'rep_1' })],
      }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { seeded: boolean; eventCount: number }).eventCount).toBe(1);
    expect(await runtime.replays.getStream('cap_2026_08_22')).not.toBeNull();
  });

  it('rejects invalid rows with a typed 422', async () => {
    useMemoryRuntime();
    const res = await seedPOST(
      jsonRequest('http://localhost/api/replay/seed', {
        streamId: 'bad',
        events: [{ eventId: 'x', kind: 'SOMETHING_ELSE', source: 'stripe-test-capture', capturedAt: 'nope' }],
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });
});

describe('POST /api/replay/run', () => {
  it('runs both arms over a seeded stream and persists the record', async () => {
    const runtime = useMemoryRuntime();
    await seedPOST(
      jsonRequest('http://localhost/api/replay/seed', {
        streamId: 'cap_2026_08_22',
        events: [makeReplayEvent({ eventId: 'rep_1' })],
      }),
    );
    const res = await runPOST(jsonRequest('http://localhost/api/replay/run', { streamId: 'cap_2026_08_22' }));
    expect(res.status).toBe(200);
    const run = (await res.json()) as { runId: string; baseline: unknown; policy: unknown };
    expect(run.runId).toMatch(/^run_/);
    expect(await runtime.replays.getRun(run.runId)).not.toBeNull();
  });

  it('returns STREAM_NOT_FOUND (404) for unknown streams', async () => {
    useMemoryRuntime();
    const res = await runPOST(jsonRequest('http://localhost/api/replay/run', { streamId: 'ghost' }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STREAM_NOT_FOUND');
  });
});

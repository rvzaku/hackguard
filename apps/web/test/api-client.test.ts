import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditEntrySchema, DecisionSchema } from '@hackguard/contracts';
import { ApiRequestError, createApiClient } from '@/lib/api/client';
import { REPLAY_METHODOLOGY_CAPTION, ReplaySeriesSchema } from '@/lib/api/types';

const json = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

const decision = DecisionSchema.parse({
  paymentId: 'pay_1',
  action: 'RETRY',
  scheduledFor: '2026-08-22T18:30:00.000Z',
  pRecover: 0.6,
  shapTop: [{ feature: 'decline_code_family', contribution: 0.8 }],
  ruleHits: [],
  modelVersion: 'propensity-v0.1.0',
});

const auditEntry = AuditEntrySchema.parse({
  seq: 1,
  prevHash: '0'.repeat(64),
  hash: 'a'.repeat(64),
  decisionRef: 'pay_1',
  actor: 'MODEL',
  ts: '2026-08-22T14:02:11.000Z',
});

afterEach(() => vi.restoreAllMocks());

describe('typed API client', () => {
  it('parses a valid decision feed', async () => {
    const fetchMock = vi.fn(() => json({ decisions: [decision] }));
    const feed = await createApiClient(fetchMock as unknown as typeof fetch).getDecisions();
    expect(feed.decisions).toHaveLength(1);
    expect(feed.decisions[0]?.paymentId).toBe('pay_1');
  });

  it('enforces the verbatim replay methodology caption via the contract', async () => {
    const bad = ReplaySeriesSchema.safeParse({
      series: [],
      baselineTotalMinor: 0,
      policyTotalMinor: 0,
      methodology: 'we made these numbers up',
    });
    expect(bad.success).toBe(false);
    expect(REPLAY_METHODOLOGY_CAPTION).toContain('counterfactual estimation');
  });

  it('raises a typed http error for non-2xx responses', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('nope', { status: 503 })));
    const err = await createApiClient(fetchMock as unknown as typeof fetch)
      .getReplay()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).payload).toMatchObject({ kind: 'http', status: 503 });
  });

  it('raises a typed parse error when the payload violates the contract', async () => {
    const fetchMock = vi.fn(() => json({ decisions: [{ paymentId: 'x' }] }));
    const err = await createApiClient(fetchMock as unknown as typeof fetch)
      .getDecisions()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).payload.kind).toBe('parse');
  });

  it('raises a typed network error when fetch rejects', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const err = await createApiClient(fetchMock as unknown as typeof fetch)
      .getAuditLog()
      .catch((e: unknown) => e);
    expect((err as ApiRequestError).payload.kind).toBe('network');
  });

  it('sends POST for verify-chain and simulate-violation', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' && String(_url).endsWith('/audit/verify')
        ? json({ valid: true, checkedCount: 7, brokenAtSeq: null })
        : json({ blocked: true, ruleHits: ['VISA-CAT1-NEVER-RETRY'], auditEntry }),
    );
    const client = createApiClient(fetchMock as unknown as typeof fetch);
    const verification = await client.verifyChain();
    expect(verification.valid).toBe(true);
    const violation = await client.simulateViolatingRetry();
    expect(violation.blocked).toBe(true);
    expect(violation.auditEntry.seq).toBe(1);
  });

  it('does not swallow AbortError', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fetchMock = vi.fn(() => Promise.reject(abort));
    await expect(
      createApiClient(fetchMock as unknown as typeof fetch).getDecisions(),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

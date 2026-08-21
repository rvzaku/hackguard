import { beforeEach, describe, expect, it } from 'vitest';

import { GET as decisionsGET } from '../src/app/api/decisions/route';
import { GET as auditGET } from '../src/app/api/audit/route';
import { POST as verifyPOST } from '../src/app/api/audit/verify/route';
import { GET as replayGET } from '../src/app/api/replay/route';
import { POST as violationPOST } from '../src/app/api/compliance/simulate-violation/route';
import { POST as bootstrapPOST } from '../src/app/api/demo/bootstrap/route';
import { POST as seedPOST } from '../src/app/api/replay/seed/route';
import { POST as runPOST } from '../src/app/api/replay/run/route';
import { POST as webhookPOST } from '../src/app/api/webhooks/stripe/route';
import {
  invoicePaymentFailedEnvelope,
  makeReplayEvent,
  signedWebhookBody,
  useMemoryRuntime,
  WEBHOOK_SECRET,
} from './helpers';

/**
 * Route-level integration tests for the live golden path: webhook ingest
 * persists decisions -> decision feed; replay seed/run -> /api/replay series;
 * audit chain append -> verify-chain tamper detection; compliance violation
 * probe blocked and audited.
 */

function jsonRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ingestWebhook(eventId: string, declineCode = 'insufficient_funds'): Promise<void> {
  const envelope = invoicePaymentFailedEnvelope({
    id: eventId,
    data: {
      object: {
        id: `in_${eventId}`,
        customer: `cus_${eventId}`,
        amount_due: 4900,
        currency: 'usd',
        attempt_count: 1,
        decline_code: declineCode,
        payment_method_details: { card: { brand: 'visa' } },
      },
    },
  });
  const { body, signature } = signedWebhookBody(envelope);
  const res = await webhookPOST(
    new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', 'stripe-signature': signature }),
      body,
    }),
  );
  expect(res.status).toBe(200);
}

describe('live golden-path routes', () => {
  beforeEach(() => {
    useMemoryRuntime();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('webhook ingest feeds the decision feed (actions + rule citations)', async () => {
    await ingestWebhook('evt_test_0001'); // insufficient_funds/visa -> RETRY
    await ingestWebhook('evt_test_0002', 'lost_card'); // lost_card/visa -> SUPPRESS

    const res = await decisionsGET();
    expect(res.status).toBe(200);
    const { decisions } = (await res.json()) as {
      decisions: Array<{ paymentId: string; action: string; ruleHits: string[] }>;
    };
    expect(decisions).toHaveLength(2);
    const retry = decisions.find((d) => d.action === 'RETRY');
    const suppress = decisions.find((d) => d.action === 'SUPPRESS');
    expect(retry?.ruleHits).toContain('VISA-CAT23-MAX15-PER-30D');
    expect(suppress?.ruleHits).toContain('VISA-CAT1-NEVER-RETRY');
  });

  it('audit ledger grows with decisions and verify-chain reports intact', async () => {
    await ingestWebhook('evt_test_0001');

    const auditRes = await auditGET();
    const { entries } = (await auditRes.json()) as { entries: Array<{ seq: number }> };
    expect(entries).toHaveLength(1);
    expect(entries[0]?.seq).toBe(0);

    const verifyRes = await verifyPOST();
    expect(verifyRes.status).toBe(200);
    const verdict = (await verifyRes.json()) as { valid: boolean; checkedCount: number; brokenAtSeq: number | null };
    expect(verdict).toEqual({ valid: true, checkedCount: 1, brokenAtSeq: null, reason: null });
  });

  it('/api/replay derives the series from the latest persisted run', async () => {
    // Empty state before any run: zeroed counters, contract-valid caption.
    const empty = (await (await replayGET()).json()) as { series: unknown[]; baselineTotalMinor: number; methodology: string };
    expect(empty.series).toEqual([]);
    expect(empty.baselineTotalMinor).toBe(0);
    expect(empty.methodology).toContain('counterfactual estimation');

    await seedPOST(
      jsonRequest('http://localhost/api/replay/seed', {
        streamId: 'cap_x',
        events: [makeReplayEvent({ eventId: 'rep_1' }), makeReplayEvent({ eventId: 'rep_2' })],
      }),
    );
    const runRes = await runPOST(jsonRequest('http://localhost/api/replay/run', { streamId: 'cap_x' }));
    expect(runRes.status).toBe(200);

    const series = (await (await replayGET()).json()) as {
      series: Array<{ bucket: string; baselineRecoveredMinor: number; policyRecoveredMinor: number }>;
      baselineTotalMinor: number;
      policyTotalMinor: number;
    };
    expect(series.series.length).toBeGreaterThan(0);
    expect(series.baselineTotalMinor).toBeGreaterThanOrEqual(0);
    expect(series.policyTotalMinor).toBeGreaterThanOrEqual(0);
  });

  it('simulate-violation blocks a hard decline through the real pipeline and audits it', async () => {
    const res = await violationPOST();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      blocked: boolean;
      ruleHits: string[];
      auditEntry: { seq: number; actor: string };
    };
    expect(json.blocked).toBe(true);
    expect(json.ruleHits).toContain('VISA-CAT1-NEVER-RETRY');
    expect(json.auditEntry.actor).toBe('RULE');

    const verdict = (await (await verifyPOST()).json()) as { valid: boolean; checkedCount: number };
    expect(verdict.valid).toBe(true);
    expect(verdict.checkedCount).toBe(1);
  });

  it('demo bootstrap seeds the canonical stream and produces a full replay run', async () => {
    const res = await bootstrapPOST();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      seeded: boolean;
      eventCount: number;
      baselineRecoveredMinor: number;
      policyRecoveredMinor: number;
    };
    expect(json.seeded).toBe(true);
    expect(json.eventCount).toBeGreaterThanOrEqual(10);

    const series = (await (await replayGET()).json()) as { series: unknown[] };
    expect(series.series.length).toBeGreaterThan(0);
  });
});

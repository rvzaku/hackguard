import { describe, expect, it } from 'vitest';

import { POST } from '../src/app/api/webhooks/stripe/route';
import { verifyStripeSignature, buildStripeSignatureHeader, DEFAULT_TOLERANCE_SECONDS } from '../src/lib/stripe/signature';
import {
  invoicePaymentFailedEnvelope,
  signedWebhookBody,
  useMemoryRuntime,
  WEBHOOK_SECRET,
} from './helpers';

/**
 * Security & failure suite for POST /api/webhooks/stripe:
 * signature rejection (bad/missing/stale), replayed-event dedupe, malformed
 * payload quarantine, and the happy path persisting + deciding + auditing.
 */

function post(body: string, signature: string | null): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('stripe-signature', signature);
  return POST(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', headers, body }));
}

describe('signature verification unit', () => {
  const body = JSON.stringify(invoicePaymentFailedEnvelope());
  const ts = Math.floor(Date.now() / 1000);

  it('accepts a valid signature', () => {
    expect(verifyStripeSignature(body, buildStripeSignatureHeader(body, WEBHOOK_SECRET, ts), WEBHOOK_SECRET).ok).toBe(true);
  });
  it('rejects a signature made with the wrong secret', () => {
    const v = verifyStripeSignature(body, buildStripeSignatureHeader(body, 'whsec_other', ts), WEBHOOK_SECRET);
    expect(v).toEqual({ ok: false, rejection: 'bad_signature' });
  });
  it('rejects a tampered payload', () => {
    const header = buildStripeSignatureHeader(body, WEBHOOK_SECRET, ts);
    const v = verifyStripeSignature(body + ' ', header, WEBHOOK_SECRET);
    expect(v).toEqual({ ok: false, rejection: 'bad_signature' });
  });
  it('rejects a missing header and a garbage header', () => {
    expect(verifyStripeSignature(body, null, WEBHOOK_SECRET)).toEqual({ ok: false, rejection: 'malformed_header' });
    expect(verifyStripeSignature(body, 'v1=abc', WEBHOOK_SECRET)).toEqual({ ok: false, rejection: 'malformed_header' });
    expect(verifyStripeSignature(body, 't=notanumber,v1=abc', WEBHOOK_SECRET)).toEqual({
      ok: false,
      rejection: 'malformed_header',
    });
  });
  it('rejects stale timestamps beyond the tolerance (replay protection)', () => {
    const oldTs = ts - DEFAULT_TOLERANCE_SECONDS - 10;
    const v = verifyStripeSignature(body, buildStripeSignatureHeader(body, WEBHOOK_SECRET, oldTs), WEBHOOK_SECRET);
    expect(v).toEqual({ ok: false, rejection: 'stale_timestamp' });
  });
});

describe('webhook route', () => {
  it('end-to-end happy path: verify -> dedupe-key -> persist -> triage -> audit', async () => {
    const runtime = useMemoryRuntime();
    const { body, signature } = signedWebhookBody(invoicePaymentFailedEnvelope());

    const res = await post(body, signature);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { received: boolean; decision: { action: string; ruleHits: string[] }; auditSeq: number };
    expect(json.received).toBe(true);
    // insufficient_funds on visa -> RETRY_SOFT -> scheduled RETRY decision.
    expect(json.decision.action).toBe('RETRY');
    expect(json.decision.ruleHits).toContain('VISA-CAT23-MAX15-PER-30D');
    expect(json.auditSeq).toBe(0);

    const stored = await runtime.payments.get('in_test_0001');
    expect(stored?.customerId).toBe('cus_test_0001');
    expect(stored?.declineCode).toBe('insufficient_funds');
    expect(stored?.amountMinor).toBe(4900);
    expect((await runtime.audit.all())).toHaveLength(1);
  });

  it('rejects a bad signature with a typed 400 before any side effect', async () => {
    const runtime = useMemoryRuntime();
    const { body } = signedWebhookBody(invoicePaymentFailedEnvelope());
    const freshTs = Math.floor(Date.now() / 1000);
    const res = await post(body, `t=${freshTs},v1=${'a'.repeat(64)}`);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_SIGNATURE');
    expect(await runtime.payments.get('in_test_0001')).toBeNull();
    expect(await runtime.audit.all()).toHaveLength(0);
  });

  it('rejects stale-timestamp replays with STALE_TIMESTAMP', async () => {
    useMemoryRuntime();
    const oldTs = Math.floor(Date.now() / 1000) - DEFAULT_TOLERANCE_SECONDS - 60;
    const { body, signature } = signedWebhookBody(invoicePaymentFailedEnvelope(), WEBHOOK_SECRET, oldTs);
    const res = await post(body, signature);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STALE_TIMESTAMP');
  });

  it('dedupes a replayed event id (idempotent 200, no double decision)', async () => {
    const runtime = useMemoryRuntime();
    const { body, signature } = signedWebhookBody(invoicePaymentFailedEnvelope());

    const first = await post(body, signature);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { deduped?: boolean }).deduped).toBeUndefined();

    // Same event id replayed (attacker re-signs with a fresh timestamp): dedupe wins.
    const replayBody = signedWebhookBody(invoicePaymentFailedEnvelope(), WEBHOOK_SECRET).body;
    const replay = await post(replayBody, signedWebhookBody(invoicePaymentFailedEnvelope()).signature);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { deduped: boolean }).deduped).toBe(true);

    expect(await runtime.audit.all()).toHaveLength(1); // no second decision/audit entry
  });

  it('quarantines malformed JSON with a typed 400', async () => {
    useMemoryRuntime();
    const ts = Math.floor(Date.now() / 1000);
    const body = 'not json at all';
    const res = await post(body, buildStripeSignatureHeader(body, WEBHOOK_SECRET, ts));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MALFORMED_PAYLOAD');
  });

  it('quarantines contract-invalid invoice objects with a typed 422', async () => {
    useMemoryRuntime();
    const envelope = invoicePaymentFailedEnvelope({ amount_due: 'lots', currency: 42 });
    const { body, signature } = signedWebhookBody(envelope);
    const res = await post(body, signature);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('acks unsupported event types with 200/ignored (Stripe best practice)', async () => {
    useMemoryRuntime();
    const { body, signature } = signedWebhookBody({
      id: 'evt_other_1',
      type: 'charge.succeeded',
      data: { object: { id: 'ch_1' } },
    });
    const res = await post(body, signature);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ignored: boolean }).ignored).toBe(true);
  });

  it('fails fast with CONFIG_MISSING when no webhook secret is configured', async () => {
    useMemoryRuntime();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const { body, signature } = signedWebhookBody(invoicePaymentFailedEnvelope());
      const res = await post(body, signature);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONFIG_MISSING');
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    }
  });
});

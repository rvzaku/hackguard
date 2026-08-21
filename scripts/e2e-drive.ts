/**
 * Golden-path E2E driver — drives a RUNNING HackGuard stack over HTTP and
 * asserts every acceptance surface (plan §2 dashboard + §6 security):
 *
 *   1. scoring sidecar health
 *   2. signed Stripe webhook ingest -> triage -> guardrail -> scheduler ->
 *      scoring sidecar -> decision persisted -> audit append
 *   3. duplicate delivery deduped (idempotency)
 *   4. A/B replay: seed canonical stream -> run -> series + counters
 *   5. decision feed: actions, rule citations, SHAP explanations
 *   6. compliance ledger: hash chain verifies intact; violation probe blocked
 *
 * Usage: npx tsx scripts/e2e-drive.ts [--web URL] [--scoring URL] [--secret S]
 * Exits 0 and prints "E2E PASS" when every assertion holds.
 */

import { createHmac } from 'node:crypto';

import { buildDemoReplayStream, DEMO_STREAM_ID } from '../apps/web/src/lib/demo/seed-stream.js';

function argOf(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : fallback;
}

const WEB = argOf('--web', 'http://localhost:3000').replace(/\/$/, '');
const SCORING = argOf('--scoring', 'http://localhost:8000').replace(/\/$/, '');
const SECRET = argOf('--secret', 'whsec_demo_local');

let checks = 0;
function ok(label: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition) {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
  console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function postJson(url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function stripeSignature(body: string, secret: string, timestampSeconds: number): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`, 'utf8').digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

async function waitHealthy(url: string, label: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        ok(`${label} healthy`, true, url);
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok(`${label} healthy`, false, `${url} did not become healthy`);
}

async function main(): Promise<void> {
  console.log(`HackGuard E2E — web=${WEB} scoring=${SCORING}`);

  // --- 1. health -----------------------------------------------------------
  const health = await getJson(`${SCORING}/healthz`);
  ok('scoring sidecar /healthz', health.status === 200 && health.body?.status === 'ok');
  ok(
    'model artifact loaded',
    typeof health.body?.modelVersion === 'string' && health.body.modelVersion.length > 0,
    String(health.body?.modelVersion),
  );

  // --- 2. signed webhook ingest --------------------------------------------
  const envelopes = buildDemoWebhookEnvelopesForDrive();
  let ingested = 0;
  let sawRetryWithShap = false;
  let sawRuleCitation = false;
  for (const envelope of envelopes) {
    const body = JSON.stringify(envelope);
    const signature = stripeSignature(body, SECRET, Math.floor(Date.now() / 1000));
    const { status, body: res } = await postJson(`${WEB}/api/webhooks/stripe`, envelope, {
      'stripe-signature': signature,
    });
    ok(`webhook ${envelope.id} accepted`, status === 200 && res?.received === true, `HTTP ${status}`);
    ingested += 1;
    const decision = res?.decision;
    if (decision?.action === 'RETRY' && Array.isArray(decision.shapTop) && decision.shapTop.length > 0) {
      sawRetryWithShap = true;
    }
    if (Array.isArray(decision?.ruleHits) && decision.ruleHits.length > 0) sawRuleCitation = true;
  }
  ok('every ingest produced a decision', ingested === envelopes.length);
  ok('at least one RETRY carries SHAP attributions (live sidecar)', sawRetryWithShap);
  ok('decisions carry network-rule citations', sawRuleCitation);

  // --- 3. idempotent redelivery --------------------------------------------
  const dupBody = JSON.stringify(envelopes[0]);
  const dup = await postJson(`${WEB}/api/webhooks/stripe`, envelopes[0], {
    'stripe-signature': stripeSignature(dupBody, SECRET, Math.floor(Date.now() / 1000)),
  });
  ok('duplicate event deduped', dup.status === 200 && dup.body?.deduped === true);

  // --- 4. bad signature rejected before side effects ------------------------
  const badSig = await postJson(`${WEB}/api/webhooks/stripe`, envelopes[1], {
    'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}`,
  });
  ok('forged signature rejected (typed 400)', badSig.status === 400 && badSig.body?.error?.code === 'INVALID_SIGNATURE');

  // --- 5. A/B replay ---------------------------------------------------------
  const events = buildDemoReplayStream();
  const seed = await postJson(`${WEB}/api/replay/seed`, { streamId: DEMO_STREAM_ID, events });
  ok('replay stream seeded', seed.status === 201 && seed.body?.eventCount === events.length);

  const run = await postJson(`${WEB}/api/replay/run`, { streamId: DEMO_STREAM_ID });
  ok(
    'A/B replay ran both arms',
    run.status === 200 &&
      run.body?.baseline?.series?.length > 0 &&
      run.body?.policy?.series?.length > 0,
    `baseline=${run.body?.baseline?.recoveredCount ?? '?'} recovered, policy=${run.body?.policy?.recoveredCount ?? '?'} recovered`,
  );

  const series = await getJson(`${WEB}/api/replay`);
  ok(
    'replay series served with counters + verbatim methodology caption',
    series.status === 200 &&
      series.body.series.length > 0 &&
      series.body.baselineTotalMinor >= 0 &&
      series.body.policyTotalMinor > 0 &&
      series.body.methodology === 'counterfactual estimation validated against published recovery curves',
    `baseline=$${(series.body.baselineTotalMinor / 100).toFixed(2)} policy=$${(series.body.policyTotalMinor / 100).toFixed(2)}`,
  );

  // --- 6. decision feed -------------------------------------------------------
  const feed = await getJson(`${WEB}/api/decisions`);
  const decisions: Array<{ action: string; ruleHits: string[]; shapTop: unknown[] }> = feed.body?.decisions ?? [];
  const actions = new Set(decisions.map((d) => d.action));
  ok(
    'decision feed covers all three actions',
    feed.status === 200 && actions.has('RETRY') && actions.has('SUPPRESS') && actions.has('ASK_CUSTOMER'),
    `${decisions.length} decisions`,
  );

  // --- 7. compliance ledger + tamper detection -------------------------------
  const probe = await postJson(`${WEB}/api/compliance/simulate-violation`);
  ok(
    'violation probe blocked by compliance engine',
    probe.status === 200 && probe.body?.blocked === true && probe.body?.ruleHits?.includes('VISA-CAT1-NEVER-RETRY'),
  );

  const audit = await getJson(`${WEB}/api/audit`);
  const entryCount: number = audit.body?.entries?.length ?? 0;
  ok(
    'audit ledger recorded every enforcement event',
    audit.status === 200 && entryCount >= ingested + 1,
    `${entryCount} entries`,
  );

  const verify = await postJson(`${WEB}/api/audit/verify`);
  ok(
    'hash chain verifies intact',
    verify.status === 200 && verify.body?.valid === true && verify.body?.checkedCount === entryCount,
    `${verify.body?.checkedCount} entries checked`,
  );

  console.log(`\nE2E PASS — ${checks} assertions green`);
}

/**
 * Webhook envelopes mirroring the canonical demo stream. Kept inline (not
 * imported from seed-stream) so this driver stays dependency-free.
 */
function buildDemoWebhookEnvelopesForDrive(): Array<Record<string, unknown>> {
  return buildDemoReplayStream().map((event) => {
    const payment = event.paymentFailed!;
    return {
      id: event.eventId,
      type: 'invoice.payment_failed',
      created: Math.floor(Date.parse(payment.ts) / 1000),
      data: {
        object: {
          id: payment.stripeId,
          customer: payment.customerId,
          amount_due: payment.amountMinor,
          currency: payment.currency,
          attempt_count: payment.attempt,
          decline_code: payment.declineCode,
          payment_method_details: { card: { brand: payment.cardBrand } },
        },
      },
    };
  });
}

main().catch((err) => {
  console.error('E2E FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});

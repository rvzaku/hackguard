import { createHmac } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { buildDemoReplayStream, DEMO_STREAM_ID } from '../src/lib/demo/seed-stream';

/**
 * Golden-path smoke (plan §2 dashboard surface): signed webhook ingest →
 * decision feed → explanation panel → A/B replay counters with methodology
 * caption → compliance ledger with chain verification and the red-team
 * violation block.
 */
test('dashboard golden path', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  // Live golden path over the BFF: signed Stripe test-mode webhooks (the same
  // deliveries scripts/verify-e2e.sh drives), then the demo replay bootstrap.
  const secret = 'whsec_demo_local';
  for (const event of buildDemoReplayStream().slice(0, 6)) {
    const payment = event.paymentFailed!;
    const envelope = {
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
    const body = JSON.stringify(envelope);
    const v1 = createHmac('sha256', secret).update(`${Math.floor(Date.now() / 1000)}.${body}`, 'utf8').digest('hex');
    const res = await page.request.post('/api/webhooks/stripe', {
      headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${v1}` },
      data: body,
    });
    expect(res.status()).toBe(200);
  }
  const seed = await page.request.post('/api/replay/seed', {
    data: { streamId: DEMO_STREAM_ID, events: buildDemoReplayStream() },
  });
  expect(seed.status()).toBe(201);
  const run = await page.request.post('/api/replay/run', { data: { streamId: DEMO_STREAM_ID } });
  expect(run.status()).toBe(200);

  await page.goto('/');

  // Decision feed renders live rows with action badges (demo stream covers
  // every triage outcome; counts can grow across runs, so assert ranges).
  await expect(page.getByTestId('decision-feed')).toBeVisible();
  await expect(page.getByTestId('decision-feed').locator('li').first()).toBeVisible();
  await expect(page.getByText('NEVER-RETRY').first()).toBeVisible();
  await expect(page.getByText('ASK-CUSTOMER').first()).toBeVisible();

  // Explanation panel shows plain-English SHAP sentences for model-scored
  // RETRY decisions; rule-only decisions show citations instead of SHAP.
  await expect(page.getByTestId('explanation-panel')).toBeVisible();
  await page.locator('[data-testid="decision-feed"] li button', { hasText: 'RETRY' }).first().click();
  await expect(page.getByTestId('shap-row').first()).toContainText(
    /increases|decreases the estimated odds of recovery/,
  );
  await page.locator('[data-testid="decision-feed"] li button', { hasText: 'NEVER-RETRY' }).first().click();
  await expect(page.getByTestId('explanation-panel')).toContainText('VISA-CAT1-NEVER-RETRY');

  // A/B replay counters + verbatim methodology caption.
  await expect(page.getByTestId('baseline-counter')).toContainText('$');
  await expect(page.getByTestId('policy-counter')).toContainText('$');
  await expect(page.getByTestId('replay-counters')).toContainText(
    'counterfactual estimation validated against published recovery curves',
  );

  // Compliance ledger: hash-chained rows.
  await expect(page.getByTestId('audit-table')).toBeVisible();
  const rowCount = await page.getByTestId('audit-table').locator('tbody tr').count();
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // Verify-chain button hits the tamper-detection endpoint.
  await page.getByTestId('verify-chain').click();
  await expect(page.getByTestId('verify-result')).toContainText('Chain intact');

  // Red-team beat: violating retry is blocked and audited; ledger grows by one row.
  await page.getByTestId('simulate-violation').click();
  await expect(page.getByTestId('violation-block')).toContainText('Retry blocked by compliance engine');
  await expect(page.getByTestId('violation-block')).toContainText('audit seq');
  await expect(page.getByTestId('audit-table').locator('tbody tr')).toHaveCount(rowCount + 1);

  expect(consoleErrors).toEqual([]);
});

import { expect, test } from '@playwright/test';

/**
 * Golden-path smoke (plan §2 dashboard surface): decision feed → explanation
 * panel → A/B replay counters with methodology caption → compliance ledger
 * with chain verification and the red-team violation block.
 */
test('dashboard golden path', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');

  // Decision feed renders live rows with action badges.
  await expect(page.getByTestId('decision-feed')).toBeVisible();
  await expect(page.getByTestId('decision-feed').locator('li')).toHaveCount(6);
  await expect(page.getByText('NEVER-RETRY').first()).toBeVisible();
  await expect(page.getByText('ASK-CUSTOMER').first()).toBeVisible();

  // Explanation panel shows plain-English SHAP sentences for the selected row.
  await expect(page.getByTestId('explanation-panel')).toBeVisible();
  await expect(page.getByTestId('shap-row').first()).toContainText(
    /increases|decreases the estimated odds of recovery/,
  );
  await page.locator('[data-testid="decision-feed"] li button').nth(1).click();
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
  expect(rowCount).toBeGreaterThanOrEqual(7);

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

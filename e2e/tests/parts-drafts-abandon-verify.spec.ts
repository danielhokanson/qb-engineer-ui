import { test, expect, request } from '@playwright/test';
import { SEED_PASSWORD } from '../helpers/auth.helper';

const BASE_URL = 'http://localhost:4200';
const API_BASE = 'http://localhost:5000/api/v1/';

/**
 * End-to-end verification of the Drafts-section abandon flow:
 *  1. Create a fresh entity-less Part workflow run.
 *  2. Confirm it surfaces in the Drafts section on /parts.
 *  3. Click the abandon (×) button + confirm in dialog.
 *  4. Confirm the row drops off the list and /workflows/active no longer
 *     returns it as an active run.
 */
test('Drafts section abandon flow drops the row and marks the run abandoned', async ({ browser }) => {
  test.setTimeout(60_000);

  const apiCtx = await request.newContext({ baseURL: API_BASE });
  const auth = await apiCtx.post('auth/login', {
    data: { email: 'admin@qbengineer.local', password: SEED_PASSWORD },
  });
  const { token, user } = await auth.json();
  const headers = { Authorization: `Bearer ${token}` };

  const startRun = await apiCtx.post('workflows', {
    headers,
    data: {
      entityType: 'Part',
      definitionId: 'part-buy-raw-v1',
      mode: 'guided',
      initialEntityData: { procurementSource: 'Buy', inventoryClass: 'Raw' },
    },
  });
  expect(startRun.ok()).toBeTruthy();
  const newRun = await startRun.json();
  console.log(`Started entity-less run ${newRun.id}`);

  await apiCtx.dispose();

  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'commit' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('qbe-token', token);
    localStorage.setItem('qbe-user', JSON.stringify(user));
  }, { token, user });

  await page.goto(`${BASE_URL}/parts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const abandonBtn = page.locator(`[data-testid="parts-drafts-abandon-${newRun.id}"]`);
  await expect(abandonBtn).toBeVisible();

  // Click the abandon X button.
  await abandonBtn.click();
  await page.waitForTimeout(400);
  // Confirm in the danger dialog.
  await page.locator('button.action-btn--destructive, button.action-btn--primary').filter({ hasText: /Abandon/i }).first().click();
  await page.waitForTimeout(1500);

  await expect(abandonBtn).toHaveCount(0);
  console.log('Draft row dropped off the table after abandon');

  // Verify backend state: /workflows/active no longer returns it.
  const apiCtx2 = await request.newContext({ baseURL: API_BASE });
  const active = await (await apiCtx2.get('workflows/active', { headers })).json();
  const stillActive = active.find((r: { id: number }) => r.id === newRun.id);
  expect(stillActive).toBeUndefined();
  console.log(`Run ${newRun.id} no longer returned by /workflows/active`);
  await apiCtx2.dispose();

  await ctx.close();
});

import { test, expect, request } from '@playwright/test';
import { SEED_PASSWORD } from '../helpers/auth.helper';

const BASE_URL = 'http://localhost:4200';
const API_BASE = 'http://localhost:5000/api/v1/';

test('Sources tab in edit mode shows Save + Cancel buttons', async ({ browser }) => {
  test.setTimeout(60_000);

  const apiCtx = await request.newContext({ baseURL: API_BASE });
  const auth = await apiCtx.post('auth/login', {
    data: { email: 'admin@qbengineer.local', password: SEED_PASSWORD },
  });
  const { token, user } = await auth.json();
  const parts = await (await apiCtx.get('parts?pageSize=10', {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  const partId = (parts.items ?? parts.data)?.[0]?.id ?? 1;
  await apiCtx.dispose();

  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'commit' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('qbe-token', token);
    localStorage.setItem('qbe-user', JSON.stringify(user));
  }, { token, user });

  await page.goto(`${BASE_URL}/parts?detail=part:${partId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="part-tab-"]').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
  await page.locator('[data-testid="part-tab-sourcing"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="part-detail-edit-toggle"]').click();
  await page.waitForTimeout(700);

  const saveBtn = page.locator('[data-testid="vendor-sources-save"]');
  const cancelBtn = page.locator('[data-testid="vendor-sources-cancel"]');

  await expect(saveBtn).toBeVisible();
  await expect(cancelBtn).toBeVisible();
  console.log('Save + Cancel visible on Sources tab');

  await page.screenshot({ path: 'e2e/screenshots/sources-save-button-verify.png', clip: { x: 270, y: 100, width: 1300, height: 900 } });

  await ctx.close();
});

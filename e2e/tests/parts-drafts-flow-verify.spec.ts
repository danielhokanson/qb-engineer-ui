import { test, expect, request } from '@playwright/test';
import { SEED_PASSWORD } from '../helpers/auth.helper';

const BASE_URL = 'http://localhost:4200';
const API_BASE = 'http://localhost:5000/api/v1/';

/**
 * End-to-end verification for the parts-drafts UX rework:
 *  1. Server returns pendingWorkflow on PartListResponseModel for parts with
 *     in-progress runs.
 *  2. /workflows/active returns entity-less Part runs (entityId=null).
 *  3. The workflow page no longer renders the inline resume banner.
 *  4. The parts list page shows the per-row "Draft" chip and a "Drafts in
 *     progress" section.
 */
test('parts list surfaces in-progress workflow drafts, no banner on workflow page', async ({ browser }) => {
  test.setTimeout(90_000);

  const apiCtx = await request.newContext({ baseURL: API_BASE });
  const auth = await apiCtx.post('auth/login', {
    data: { email: 'admin@qbengineer.local', password: SEED_PASSWORD },
  });
  expect(auth.ok()).toBeTruthy();
  const { token, user } = await auth.json();
  const headers = { Authorization: `Bearer ${token}` };

  // Start a fresh entity-less Part workflow run so we have one to look at.
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

  // Verify /workflows/active returns the run with entityId=null.
  const active = await (await apiCtx.get('workflows/active', { headers })).json();
  const ourRun = active.find((r: { id: number }) => r.id === newRun.id);
  expect(ourRun).toBeDefined();
  expect(ourRun.entityId).toBeNull();
  console.log(`/workflows/active returned ${active.length} active runs (ours included)`);

  // Verify parts list returns pendingWorkflow on parts that DO have a run with
  // an entity attached. We need at least one part with an in-progress run.
  // Reuse what's there: list parts, check shape.
  const parts = await (await apiCtx.get('parts?pageSize=10', { headers })).json();
  const partsList = parts.items ?? parts.data ?? [];
  expect(partsList.length).toBeGreaterThan(0);
  // pendingWorkflow shape check on every row (null is fine; the field must exist).
  for (const p of partsList) {
    expect(p).toHaveProperty('pendingWorkflow');
  }
  console.log(`Parts list returns pendingWorkflow field on every row (${partsList.length} rows checked)`);

  await apiCtx.dispose();

  // UI checks: load the parts page, confirm Drafts section is visible.
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'commit' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('qbe-token', token);
    localStorage.setItem('qbe-user', JSON.stringify(user));
  }, { token, user });

  await page.goto(`${BASE_URL}/parts`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Drafts now appear as ghost rows at the top of the parts table — find the
  // abandon button (testid carries the run id) and assert it's reachable.
  const abandonBtn = page.locator(`[data-testid="parts-drafts-abandon-${newRun.id}"]`);
  await expect(abandonBtn).toBeVisible();
  console.log(`Draft ghost row visible with our entity-less run ${newRun.id}`);

  // Now navigate to /parts/new with our run's id and confirm NO resume banner.
  await page.goto(
    `${BASE_URL}/parts/new?runId=${newRun.id}&workflow=${newRun.definitionId}&step=${newRun.currentStepId ?? 'basics'}&mode=guided`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const banner = page.locator('[data-testid="workflow-resume-banner"]');
  await expect(banner).toHaveCount(0);
  console.log('Workflow page: no inline resume banner present (as expected)');

  await page.screenshot({ path: 'e2e/screenshots/parts-drafts-flow-verify.png', fullPage: false });

  await ctx.close();
});

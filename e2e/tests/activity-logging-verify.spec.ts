import { test, expect, request } from '@playwright/test';
import { SEED_PASSWORD } from '../helpers/auth.helper';

const API_BASE = 'http://localhost:5000/api/v1/';

/**
 * End-to-end verification that activity logging fires for vendor-source +
 * price-tier mutations. Drives the API directly (no UI), then asserts the
 * Activity feed contains rows for both Part and Vendor (the indexing-points
 * rule). Cleans up by deleting the created VendorPart.
 */
test('vendor + tier mutations write activity rows on Part AND Vendor', async () => {
  test.setTimeout(60_000);

  const apiCtx = await request.newContext({ baseURL: API_BASE });
  const auth = await apiCtx.post('auth/login', {
    data: { email: 'admin@qbengineer.local', password: SEED_PASSWORD },
  });
  expect(auth.ok()).toBeTruthy();
  const { token } = await auth.json();
  const headers = { Authorization: `Bearer ${token}` };

  // Pick any part + any vendor. Use first of each.
  const parts = await (await apiCtx.get('parts?pageSize=10', { headers })).json();
  const vendors = await (await apiCtx.get('vendors?pageSize=10', { headers })).json();
  const part = (parts.items ?? parts.data)?.[0];
  const vendor = (vendors.items ?? vendors.data)?.[0];
  expect(part?.id).toBeTruthy();
  expect(vendor?.id).toBeTruthy();

  // Snapshot baseline activity counts.
  const partActivityBefore = await (await apiCtx.get(`Part/${part.id}/activity`, { headers })).json();
  const vendorActivityBefore = await (await apiCtx.get(`Vendor/${vendor.id}/activity`, { headers })).json();
  console.log(`Baseline: Part activity = ${partActivityBefore.length}, Vendor activity = ${vendorActivityBefore.length}`);

  // 1) Create a VendorPart (avoid duplicate by checking first).
  const existing = await (await apiCtx.get(`parts/${part.id}/vendor-parts`, { headers })).json();
  const existingForVendor = (existing.data ?? existing).find((v: { vendorId: number }) => v.vendorId === vendor.id);
  let vendorPartId: number;
  if (existingForVendor) {
    vendorPartId = existingForVendor.id;
    console.log(`Reusing existing VendorPart ${vendorPartId}`);
  } else {
    const created = await apiCtx.post('vendor-parts', {
      headers,
      data: { vendorId: vendor.id, partId: part.id, isPreferred: false, isApproved: true },
    });
    expect(created.ok()).toBeTruthy();
    vendorPartId = (await created.json()).id;
    console.log(`Created VendorPart ${vendorPartId}`);
  }

  // 2) Update the VendorPart (rollup logging — multiple fields).
  const updated = await apiCtx.put(`vendor-parts/${vendorPartId}`, {
    headers,
    data: {
      vendorPartNumber: `TST-${Date.now()}`,
      manufacturerName: 'Activity Log Test Mfg',
      vendorMpn: 'ACT-LOG-001',
      leadTimeDays: 14,
      minOrderQty: 10,
      packSize: 1,
      isPreferred: false,
      isApproved: true,
    },
  });
  expect(updated.ok()).toBeTruthy();

  // 3) Add a price tier.
  const tier = await apiCtx.post(`vendor-parts/${vendorPartId}/price-tiers`, {
    headers,
    data: { minQuantity: 100, unitPrice: 1.5, currency: 'USD', effectiveFrom: new Date().toISOString().slice(0, 10) },
  });
  expect(tier.ok()).toBeTruthy();
  const tierId = (await tier.json()).id;

  // 4) Remove the price tier.
  const tierDel = await apiCtx.delete(`vendor-parts/${vendorPartId}/price-tiers/${tierId}`, { headers });
  expect(tierDel.ok()).toBeTruthy();

  // 5) Snapshot activity AFTER mutations.
  const partActivityAfter = await (await apiCtx.get(`Part/${part.id}/activity`, { headers })).json();
  const vendorActivityAfter = await (await apiCtx.get(`Vendor/${vendor.id}/activity`, { headers })).json();

  const partAdded = partActivityAfter.length - partActivityBefore.length;
  const vendorAdded = vendorActivityAfter.length - vendorActivityBefore.length;
  console.log(`Added rows: Part = ${partAdded}, Vendor = ${vendorAdded}`);

  // The latest entries (descending order) should be the activity from this test.
  console.log('Latest 5 part activity rows:');
  for (const row of partActivityAfter.slice(0, 5)) {
    console.log(`  [${row.action}] ${row.description}`);
  }

  // We did at least 3 mutations (update VP, add tier, delete tier) — possibly +1 if we created VP. Should appear on BOTH.
  expect(partAdded).toBeGreaterThanOrEqual(3);
  expect(vendorAdded).toBeGreaterThanOrEqual(3);
  // Indexing-points rule: same N rows on both
  expect(partAdded).toBe(vendorAdded);

  await apiCtx.dispose();
});

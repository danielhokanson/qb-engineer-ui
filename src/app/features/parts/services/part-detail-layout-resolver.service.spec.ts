import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { PartDetailLayoutResolverService } from './part-detail-layout-resolver.service';

describe('PartDetailLayoutResolverService', () => {
  let service: PartDetailLayoutResolverService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PartDetailLayoutResolverService);
  });

  it('Buy + Raw → identity, sourcing, purchaseHistory, inventory, quality, cost, pricing, activity, files', () => {
    const ids = service.resolve('Buy', 'Raw').map(t => t.id);
    expect(ids).toEqual(['identity', 'sourcing', 'purchaseHistory', 'inventory', 'quality', 'cost', 'pricing', 'activity', 'files']);
  });

  it('Make + Subassembly → identity, material, purchaseHistory, bom, routing, inventory, mrp, cost, pricing, quality, alternates, activity, files', () => {
    // PURCHASE_HISTORY is anchored after the FIRST inventory/bom/material
    // tab present (here: material), per the universal-inclusion rule.
    const ids = service.resolve('Make', 'Subassembly').map(t => t.id);
    expect(ids).toEqual([
      'identity', 'material', 'purchaseHistory', 'bom', 'routing', 'inventory', 'mrp', 'cost', 'pricing', 'quality', 'alternates', 'activity', 'files',
    ]);
  });

  it('Phantom + Subassembly → identity, bom, purchaseHistory, activity, files', () => {
    // Phantom layouts are minimal — bom only — but purchaseHistory still
    // appears (anchored after bom) per the universal-inclusion rule.
    const ids = service.resolve('Phantom', 'Subassembly').map(t => t.id);
    expect(ids).toEqual(['identity', 'bom', 'purchaseHistory', 'activity', 'files']);
    expect(ids).not.toContain('pricing');
  });

  it('Phantom + FinishedGood excludes pricing tab', () => {
    const ids = service.resolve('Phantom', 'FinishedGood').map(t => t.id);
    expect(ids).not.toContain('pricing');
  });

  it('unknown combo defaults to Buy + Component layout (includes pricing)', () => {
    // Phantom + Raw is not a viable combo per Section 2 — should default.
    const ids = service.resolve('Phantom', 'Raw').map(t => t.id);
    expect(ids).toEqual(['identity', 'sourcing', 'purchaseHistory', 'inventory', 'quality', 'cost', 'pricing', 'alternates', 'activity', 'files']);
  });

  it('purchaseHistory tab is included for every Buy / Subcontract combo', () => {
    const cases: { ps: 'Buy' | 'Subcontract'; ic: 'Raw' | 'Component' | 'Subassembly' | 'FinishedGood' | 'Consumable' | 'Tool' }[] = [
      { ps: 'Buy', ic: 'Raw' },
      { ps: 'Buy', ic: 'Component' },
      { ps: 'Buy', ic: 'Subassembly' },
      { ps: 'Buy', ic: 'FinishedGood' },
      { ps: 'Buy', ic: 'Consumable' },
      { ps: 'Buy', ic: 'Tool' },
      { ps: 'Subcontract', ic: 'Component' },
      { ps: 'Subcontract', ic: 'Subassembly' },
    ];
    for (const { ps, ic } of cases) {
      const ids = service.resolve(ps, ic).map(t => t.id);
      expect(ids, `${ps}+${ic}`).toContain('purchaseHistory');
      // Always sits immediately after sourcing.
      expect(ids.indexOf('purchaseHistory'), `${ps}+${ic} ordering`).toBe(ids.indexOf('sourcing') + 1);
    }
  });

  it('purchaseHistory tab is included on every layout (Make + Phantom too) — anchored after sourcing/inventory/bom/material when present', () => {
    const allCases: { ps: 'Buy' | 'Make' | 'Subcontract' | 'Phantom'; ic: 'Raw' | 'Component' | 'Subassembly' | 'FinishedGood' | 'Consumable' | 'Tool' }[] = [
      { ps: 'Make', ic: 'Component' },
      { ps: 'Make', ic: 'Subassembly' },
      { ps: 'Make', ic: 'FinishedGood' },
      { ps: 'Make', ic: 'Tool' },
      { ps: 'Phantom', ic: 'Subassembly' },
      { ps: 'Phantom', ic: 'FinishedGood' },
    ];
    for (const { ps, ic } of allCases) {
      const ids = service.resolve(ps, ic).map(t => t.id);
      expect(ids, `${ps}+${ic}`).toContain('purchaseHistory');
    }
  });

  it('Identity always first; Activity then Files always last across every combo', () => {
    const procs = ['Buy', 'Make', 'Subcontract', 'Phantom'] as const;
    const classes = ['Raw', 'Component', 'Subassembly', 'FinishedGood', 'Consumable', 'Tool'] as const;
    for (const p of procs) {
      for (const c of classes) {
        const layout = service.resolve(p, c);
        expect(layout[0].id, `first tab for ${p}+${c}`).toBe('identity');
        expect(layout[layout.length - 2].id, `second-to-last for ${p}+${c}`).toBe('activity');
        expect(layout[layout.length - 1].id, `last tab for ${p}+${c}`).toBe('files');
      }
    }
  });

  it('Buy + Consumable (B5) hides Quality and Alternates but still shows Pricing', () => {
    const ids = service.resolve('Buy', 'Consumable').map(t => t.id);
    expect(ids).not.toContain('quality');
    expect(ids).not.toContain('alternates');
    expect(ids).toContain('pricing');
  });

  it('Make + Tool (M4) limits to material/bom/routing + purchaseHistory — no Pricing (sold as asset, not part)', () => {
    // PURCHASE_HISTORY anchored after the first material/bom tab (here:
    // material) per the universal-inclusion rule.
    const ids = service.resolve('Make', 'Tool').map(t => t.id);
    expect(ids).toEqual(['identity', 'material', 'purchaseHistory', 'bom', 'routing', 'activity', 'files']);
    expect(ids).not.toContain('pricing');
  });

  it('Pricing tab is positioned immediately after Cost on every non-Phantom combo', () => {
    const cases: { ps: 'Buy' | 'Make' | 'Subcontract'; ic: 'Raw' | 'Component' | 'Subassembly' | 'FinishedGood' | 'Consumable' | 'Tool' }[] = [
      { ps: 'Buy', ic: 'Raw' },
      { ps: 'Buy', ic: 'Component' },
      { ps: 'Buy', ic: 'Subassembly' },
      { ps: 'Buy', ic: 'FinishedGood' },
      { ps: 'Buy', ic: 'Consumable' },
      { ps: 'Buy', ic: 'Tool' },
      { ps: 'Make', ic: 'Component' },
      { ps: 'Make', ic: 'Subassembly' },
      { ps: 'Make', ic: 'FinishedGood' },
      { ps: 'Subcontract', ic: 'Component' },
      { ps: 'Subcontract', ic: 'Subassembly' },
    ];
    for (const { ps, ic } of cases) {
      const ids = service.resolve(ps, ic).map(t => t.id);
      const costIndex = ids.indexOf('cost');
      const pricingIndex = ids.indexOf('pricing');
      expect(costIndex, `cost present for ${ps}+${ic}`).toBeGreaterThanOrEqual(0);
      expect(pricingIndex, `pricing present for ${ps}+${ic}`).toBe(costIndex + 1);
    }
  });
});

import { Injectable } from '@angular/core';

import { InventoryClass } from '../models/inventory-class.type';
import { ProcurementSource } from '../models/procurement-source.type';

/**
 * Pillar 4 — Identifier for a single tab on the Part detail page.
 *
 * Order matters in the layout array returned by
 * {@link PartDetailLayoutResolverService.resolve}: Identity is always first,
 * Activity then Files are always last. Cluster placement in between is
 * driven by the (procurementSource, inventoryClass) combination per
 * `phase-4-output/part-type-field-relevance.md` Section 6.
 */
export type PartDetailTabId =
  | 'identity'
  | 'sourcing'
  | 'purchaseHistory'
  | 'inventory'
  | 'mrp'
  | 'bom'
  | 'routing'
  | 'cost'
  | 'pricing'
  | 'quality'
  | 'alternates'
  | 'material'
  | 'activity'
  | 'files';

/** A single tab descriptor returned by the resolver. */
export interface TabLayoutEntry {
  /** Stable id used for keying templates and the `?tab=` query param. */
  id: PartDetailTabId;
  /** ngx-translate key for the tab label. */
  labelKey: string;
  /** Material Icons Outlined glyph name. */
  iconName: string;
}

// ── Tab descriptors ────────────────────────────────────────────────────────

const IDENTITY: TabLayoutEntry = { id: 'identity', labelKey: 'parts.detail.tabs.identity', iconName: 'badge' };
const SOURCING: TabLayoutEntry = { id: 'sourcing', labelKey: 'parts.detail.tabs.sourcing', iconName: 'store' };
const PURCHASE_HISTORY: TabLayoutEntry = { id: 'purchaseHistory', labelKey: 'parts.detail.tabs.purchaseHistory', iconName: 'receipt_long' };
const INVENTORY: TabLayoutEntry = { id: 'inventory', labelKey: 'parts.detail.tabs.inventory', iconName: 'inventory_2' };
const MRP: TabLayoutEntry = { id: 'mrp', labelKey: 'parts.detail.tabs.mrp', iconName: 'event_available' };
const BOM: TabLayoutEntry = { id: 'bom', labelKey: 'parts.detail.tabs.bom', iconName: 'account_tree' };
const ROUTING: TabLayoutEntry = { id: 'routing', labelKey: 'parts.detail.tabs.routing', iconName: 'alt_route' };
const COST: TabLayoutEntry = { id: 'cost', labelKey: 'parts.detail.tabs.cost', iconName: 'payments' };
const PRICING: TabLayoutEntry = { id: 'pricing', labelKey: 'parts.detail.tabs.pricing', iconName: 'sell' };
const QUALITY: TabLayoutEntry = { id: 'quality', labelKey: 'parts.detail.tabs.quality', iconName: 'fact_check' };
const ALTERNATES: TabLayoutEntry = { id: 'alternates', labelKey: 'parts.detail.tabs.alternates', iconName: 'swap_horiz' };
const MATERIAL: TabLayoutEntry = { id: 'material', labelKey: 'parts.detail.tabs.material', iconName: 'category' };
const ACTIVITY: TabLayoutEntry = { id: 'activity', labelKey: 'parts.detail.tabs.activity', iconName: 'timeline' };
const FILES: TabLayoutEntry = { id: 'files', labelKey: 'parts.detail.tabs.files', iconName: 'attach_file' };

/**
 * Pillar 4 — Pure-function resolver that maps the Part's
 * (procurementSource × inventoryClass) axes to an ordered tab layout.
 *
 * Returns the default Buy + Component layout for any unknown combination.
 * Identity is always first; Activity → Files always last.
 *
 * Spec source of truth: `phase-4-output/part-type-field-relevance.md` § 6.
 */
@Injectable({ providedIn: 'root' })
export class PartDetailLayoutResolverService {
  resolve(procurementSource: ProcurementSource, inventoryClass: InventoryClass): TabLayoutEntry[] {
    const middle = this.middleTabs(procurementSource, inventoryClass);
    // Purchase History is always available — even Make / Phantom parts may
    // have historical POs (a part could have been re-classified from Buy
    // to Make over time, or pre-classification POs may exist). User
    // direction (2026-05-05): always show it. The empty state covers the
    // "no POs reference this part" case cleanly.
    const middleWithPo = this.injectPurchaseHistory(middle);
    return [IDENTITY, ...middleWithPo, ACTIVITY, FILES];
  }

  /**
   * Insert PURCHASE_HISTORY into the middle layout. Per-layout placement:
   *   • If SOURCING is present, PURCHASE_HISTORY follows it (buyer flow:
   *     "current vendors" → "what we've ordered from them historically").
   *   • Otherwise, PURCHASE_HISTORY follows the first inventory-or-bom tab
   *     so it never lands as the very first tab on a Make/Phantom layout
   *     (those open with their material/BOM context, not buying history).
   *   • If neither exists, PURCHASE_HISTORY goes at the end.
   *
   * No-op if PURCHASE_HISTORY is somehow already in the layout (defensive).
   */
  private injectPurchaseHistory(middle: TabLayoutEntry[]): TabLayoutEntry[] {
    if (middle.some(t => t.id === 'purchaseHistory')) return middle;
    const sourceIdx = middle.findIndex(t => t.id === 'sourcing');
    if (sourceIdx >= 0) {
      return [...middle.slice(0, sourceIdx + 1), PURCHASE_HISTORY, ...middle.slice(sourceIdx + 1)];
    }
    const anchorIdx = middle.findIndex(t => t.id === 'inventory' || t.id === 'bom' || t.id === 'material');
    if (anchorIdx >= 0) {
      return [...middle.slice(0, anchorIdx + 1), PURCHASE_HISTORY, ...middle.slice(anchorIdx + 1)];
    }
    return [...middle, PURCHASE_HISTORY];
  }

  private middleTabs(ps: ProcurementSource, ic: InventoryClass): TabLayoutEntry[] {
    // Buy + Raw (B1)
    if (ps === 'Buy' && ic === 'Raw') {
      return [SOURCING, INVENTORY, QUALITY, COST, PRICING];
    }
    // Buy + Component / Subassembly / FinishedGood (B2 / B3 / B4)
    if (ps === 'Buy' && (ic === 'Component' || ic === 'Subassembly' || ic === 'FinishedGood')) {
      return [SOURCING, INVENTORY, QUALITY, COST, PRICING, ALTERNATES];
    }
    // Buy + Consumable (B5) — no Quality
    if (ps === 'Buy' && ic === 'Consumable') {
      return [SOURCING, INVENTORY, COST, PRICING];
    }
    // Buy + Tool (B6)
    if (ps === 'Buy' && ic === 'Tool') {
      return [SOURCING, INVENTORY, QUALITY, COST, PRICING, ALTERNATES];
    }

    // Make + Component (M1)
    if (ps === 'Make' && ic === 'Component') {
      return [MATERIAL, INVENTORY, MRP, ROUTING, COST, PRICING, QUALITY, ALTERNATES];
    }
    // Make + Subassembly / FinishedGood (M2 / M3)
    if (ps === 'Make' && (ic === 'Subassembly' || ic === 'FinishedGood')) {
      return [MATERIAL, BOM, ROUTING, INVENTORY, MRP, COST, PRICING, QUALITY, ALTERNATES];
    }
    // Make + Tool (M4) — lives mostly as an Asset; minimal middle, no sales pricing
    if (ps === 'Make' && ic === 'Tool') {
      return [MATERIAL, BOM, ROUTING];
    }

    // Subcontract + Component / Subassembly (S1 / S2)
    if (ps === 'Subcontract' && ic === 'Component') {
      return [SOURCING, INVENTORY, QUALITY, COST, PRICING, ALTERNATES];
    }
    if (ps === 'Subcontract' && ic === 'Subassembly') {
      return [SOURCING, BOM, INVENTORY, QUALITY, COST, PRICING, ALTERNATES];
    }

    // Phantom + Subassembly / FinishedGood (P1 / P3) — never stocked, never priced
    if (ps === 'Phantom' && (ic === 'Subassembly' || ic === 'FinishedGood')) {
      return [BOM];
    }

    // Default: Buy + Component layout
    return [SOURCING, INVENTORY, QUALITY, COST, PRICING, ALTERNATES];
  }
}

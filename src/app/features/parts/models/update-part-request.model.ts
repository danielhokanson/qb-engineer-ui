import { AbcClass } from './abc-class.type';
import { BackflushPolicy } from './backflush-policy.type';
import { InventoryClass } from './inventory-class.type';
import { LotSizingRule } from './lot-sizing-rule.type';
import { PartStatus } from './part-status.type';
import { ProcurementSource } from './procurement-source.type';
import { ReceivingInspectionFrequency } from './receiving-inspection-frequency.type';
import { TraceabilityType } from './traceability-type.type';

// Pillar 4 Phase 2 — clearing convention for nullable fields:
//   - int? (FK / scalar): pass -1 to clear to null. ToolingAssetId /
//     PreferredVendorId / threshold legacy fields use 0 for back-compat.
//   - decimal?: pass a negative value (< 0) to clear to null on new fields.
//   - string?: pass empty/whitespace to clear to null.
//   - enum?: cannot be cleared via this endpoint — leave undefined to mean
//     "no change", or set a new value.
//   - bool?: undefined = no change; true/false sets the entity value explicitly.
export interface UpdatePartRequest {
  /** Required short identifier (omit to leave unchanged). */
  name?: string;
  /** Optional long-form notes (empty string clears the value server-side). */
  description?: string;
  revision?: string;
  status?: PartStatus;
  // Pillar 1 — Three orthogonal axes replace the legacy partType / Material /
  // MoldToolRef fields (retired pre-beta).
  procurementSource?: ProcurementSource;
  inventoryClass?: InventoryClass;
  toolingAssetId?: number;
  // Pillar 3 — preferred vendor FK. Set from the Sourcing step or via
  // the "Set as preferred" action on the Vendor Sources panel. Pass 0
  // to clear (per the legacy back-compat clearing convention noted at
  // the top of this file).
  preferredVendorId?: number;
  minStockThreshold?: number;
  reorderPoint?: number;
  reorderQuantity?: number;
  safetyStockDays?: number;
  // Workflow Pattern Phase 5 — manual cost override (Tier 1 single-rate).
  // Sentinel value -1 means "clear to null".
  manualCostOverride?: number;
  // Tier 0 — traceability + ABC class. (OEM identity moved to VendorPart.)
  traceabilityType?: TraceabilityType;
  abcClass?: AbcClass | null;
  // Pillar 4 Phase 2 — UoM cluster (FK to UnitOfMeasure)
  stockUomId?: number;
  purchaseUomId?: number;
  salesUomId?: number;
  // Pillar 4 Phase 2 — MRP cluster
  isMrpPlanned?: boolean;
  lotSizingRule?: LotSizingRule;
  fixedOrderQuantity?: number;
  minimumOrderQuantity?: number;
  orderMultiple?: number;
  planningFenceDays?: number;
  demandFenceDays?: number;
  // Pillar 4 Phase 2 — Quality cluster (receiving inspection)
  requiresReceivingInspection?: boolean;
  receivingInspectionTemplateId?: number;
  inspectionFrequency?: ReceivingInspectionFrequency;
  inspectionSkipAfterN?: number;
  // Pillar 4 Phase 2 — Material cluster (measurement profile + valuation)
  materialSpecId?: number;
  weightEach?: number;
  weightDisplayUnit?: string;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  dimensionDisplayUnit?: string;
  volumeMl?: number;
  volumeDisplayUnit?: string;
  valuationClassId?: number;
  // Pillar 4 Phase 2 — Tier 3 compliance / classification + ad-hoc fields
  hazmatClass?: string;
  shelfLifeDays?: number;
  backflushPolicy?: BackflushPolicy;
  isKit?: boolean;
  isConfigurable?: boolean;
  defaultBinId?: number;
  sourcePartId?: number;
  htsCode?: string;
}

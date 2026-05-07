/**
 * Bought-parts effort PR3 — landed-cost surface for the part Cost tab.
 * Mirrors `QBEngineer.Core.Models.PartLandedCostResponseModel` exactly.
 *
 * `averageLandedUnitCost` is null when the part has no receipts with
 * captured freight (pre-PR3 receipts and freight-skipped receipts both
 * fall here). The UI shows a "no receipt history yet" affordance in
 * that case. Otherwise the breakdown sums to the average.
 */
export interface PartLandedCost {
  partId: number;
  partNumber: string;
  baseCurrency: string;
  averageLandedUnitCost: number | null;
  receiptCountUsed: number;
  averageBaseUnitPrice: number;
  averageFreightPerUnit: number;
  averageDutyPerUnit: number;
  averageFxAdjustmentPerUnit: number;
  recentReceipts: PartLandedCostReceipt[];
  vendorComparison: VendorLandedCostComparison[];
}

export interface PartLandedCostReceipt {
  receivingRecordId: number;
  receiptNumber: string | null;
  vendorId: number;
  vendorName: string;
  purchaseOrderId: number;
  purchaseOrderNumber: string;
  receivedAt: Date;
  quantityReceived: number;
  baseUnitPrice: number;
  allocatedFreightPerUnit: number;
  dutyPerUnit: number;
  fxAdjustmentPerUnit: number;
  landedUnitCost: number;
}

export interface VendorLandedCostComparison {
  vendorId: number;
  vendorName: string;
  mostRecentLandedUnitCost: number | null;
  mostRecentReceiptAt: Date | null;
}

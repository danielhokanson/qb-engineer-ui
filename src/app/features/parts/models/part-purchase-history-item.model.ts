/**
 * Backward-from-part PO history row (one per (PO, line) pair).
 * Mirrors the server's PartPurchaseHistoryItemResponseModel — see
 * `qb-engineer.core/Models/PartPurchaseHistoryItemResponseModel.cs`.
 */
export interface PartPurchaseHistoryItem {
  purchaseOrderId: number;
  purchaseOrderLineId: number;
  poNumber: string;
  vendorId: number;
  vendorName: string;
  status: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitPrice: number;
  lineTotal: number;
  /** ISO-8601 string from DateTimeOffset. */
  orderedDate: string;
  /** ISO-8601 string from DateTimeOffset; null when no expected delivery is set. */
  expectedDeliveryDate: string | null;
}

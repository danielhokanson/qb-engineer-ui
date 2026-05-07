import { PurchaseOrderLine } from './purchase-order-line.model';

export interface PurchaseOrderDetail {
  id: number;
  poNumber: string;
  vendorId: number;
  vendorName: string;
  jobId: number | null;
  jobNumber: string | null;
  status: string;
  submittedDate: Date | null;
  acknowledgedDate: Date | null;
  expectedDeliveryDate: Date | null;
  receivedDate: Date | null;
  notes: string | null;
  isBlanket: boolean;
  blanketTotalQuantity: number | null;
  blanketReleasedQuantity: number | null;
  blanketRemainingQuantity: number | null;
  blanketExpirationDate: Date | null;
  agreedUnitPrice: number | null;
  lines: PurchaseOrderLine[];
  createdAt: Date;
  updatedAt: Date;
  // Phase 3 / WU-14 / H3 — short-close audit fields. Null on POs that were not short-closed.
  shortCloseReason: string | null;
  shortClosedAt: Date | null;
  // Bought-parts effort PR2.5 — landed cost foundation. Added here so the
  // PR3 receive-dialog can default ActualFreight from the PO's estimate.
  // (PR2.5 — landing in parallel — extends this further with incoterm /
  // quoteCurrency / fxRate / fxRateSource and the vendor-min surface.)
  estimatedFreight: number | null;
}

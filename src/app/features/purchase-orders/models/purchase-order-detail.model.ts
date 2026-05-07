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
  // Bought-parts effort PR2.5 — landed cost foundation. Incoterm defaults
  // FOB_Origin; freight is null = "not yet captured" (distinct from $0 free
  // shipping). FX rate locks at Submit; pre-submit it stays null.
  incoterm: string;
  estimatedFreight: number | null;
  quoteCurrency: string;
  fxRate: number | null;
  fxRateSource: string | null;
  // Vendor-minimum soft warning — true when the vendor's MinOrderAmount is
  // set and the PO total falls below it. UI renders a non-blocking banner.
  belowVendorMinimum: boolean;
  vendorMinimumOrderAmount: number | null;
}

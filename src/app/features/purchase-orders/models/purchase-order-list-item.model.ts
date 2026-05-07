export interface PurchaseOrderListItem {
  id: number;
  poNumber: string;
  vendorId: number;
  vendorName: string;
  jobId: number | null;
  jobNumber: string | null;
  status: string;
  lineCount: number;
  totalOrdered: number;
  totalReceived: number;
  expectedDeliveryDate: Date | null;
  isBlanket: boolean;
  createdAt: Date;
  // Bought-parts effort PR2.5 — true when the vendor's MinOrderAmount is set
  // and the PO total falls below it. List renders a small warning chip;
  // detail panel renders a full banner with the threshold.
  belowVendorMinimum: boolean;
}

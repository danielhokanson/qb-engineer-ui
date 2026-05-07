export interface UpdatePurchaseOrderRequest {
  notes?: string;
  expectedDeliveryDate?: string;
  // Bought-parts effort PR2.5 — landed cost header fields. Editable while
  // the PO is in Draft only; once Submitted, the FX snapshot is locked.
  incoterm?: string;
  estimatedFreight?: number;
  quoteCurrency?: string;
  fxRate?: number;
  fxRateSource?: string;
}

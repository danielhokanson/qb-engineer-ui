export interface ReceiveLineRequest {
  lineId: number;
  quantity: number;
  storageLocationId?: number;
  notes?: string;
  // Bought-parts effort PR3 — populated only when the parent request's
  // freightAllocationMethod is 'Manual'. Ignored otherwise.
  manualFreight?: number;
}

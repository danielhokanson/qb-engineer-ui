import { ReceiveLineRequest } from './receive-line-request.model';

/** Mirrors `QBEngineer.Core.Enums.FreightAllocationMethod`. */
export type FreightAllocationMethod = 'ByExtendedValue' | 'ByWeight' | 'ByQuantity' | 'Manual';

export interface ReceiveItemsRequest {
  lines: ReceiveLineRequest[];
  // Bought-parts effort PR3 — receipt-level freight capture. When
  // actualFreight is null/omitted, the server defaults from the PO's
  // EstimatedFreight. AllocationMethod default is ByExtendedValue.
  actualFreight?: number;
  freightAllocationMethod?: FreightAllocationMethod;
}

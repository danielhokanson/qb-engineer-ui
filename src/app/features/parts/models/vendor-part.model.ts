/**
 * Pillar 3 — Mirror of `VendorPartResponseModel` (server). Intersection
 * entity capturing the (Vendor, Part) relationship with vendor-scoped
 * sourcing metadata. Tiered pricing lives on the `priceTiers` collection.
 *
 * Several fields that used to live on `Part` are intentionally absent here
 * and live only on this model: `vendorPartNumber`, `vendorMpn`,
 * `leadTimeDays`, `minOrderQty`, `packSize`, `countryOfOrigin`, `htsCode`.
 * The Part model still carries snapshot copies of `leadTimeDays` /
 * `minOrderQty` / `packSize` for backward compat — Phase 2/4 will migrate
 * readers off them.
 */
export interface VendorPart {
  id: number;
  vendorId: number;
  vendorCompanyName: string;
  partId: number;
  partNumber: string;
  partName: string;
  vendorPartNumber: string | null;
  manufacturerName: string | null;
  vendorMpn: string | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  packSize: number | null;
  countryOfOrigin: string | null;
  htsCode: string | null;
  isApproved: boolean;
  isPreferred: boolean;
  certifications: string | null;
  lastQuotedDate: string | null;
  notes: string | null;
  priceTiers: VendorPartPriceTier[];
  createdAt: string;
  updatedAt: string;
  /**
   * ISO-4217 currency code this vendor quotes in. Promoted from the
   * per-tier level — tier rows snapshot this value at insert time so
   * historical rows preserve the currency they were quoted at if the
   * source's currency later changes.
   */
  currency: string;
}

export interface VendorPartPriceTier {
  id: number;
  vendorPartId: number;
  minQuantity: number;
  unitPrice: number;
  /** ISO-4217 currency code (e.g., 'USD', 'EUR'). */
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

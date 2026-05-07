export interface UpdateVendorRequest {
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  paymentTerms?: string;
  notes?: string;
  isActive?: boolean;
  // Bought-parts effort PR4 — per-vendor override for the off-tier price
  // prompt threshold. Null = use system default (`purchasing.offTierVariancePct`,
  // 5% out of the box). Wider tolerance silences prompts for vendors with
  // genuinely noisy pricing.
  offTierVariancePct?: number | null;
}

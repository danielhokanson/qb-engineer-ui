/**
 * Bought-parts effort PR4 — TariffRate admin model. Mirrors
 * `QBEngineer.Core.Models.TariffRateResponseModel`.
 *
 * Tariffs are SCD-2 keyed on (HtsCode, CountryOfOrigin) with effective
 * windows. Admin imports broker data and supersedes rates as needed —
 * to retire a rate, set EffectiveTo and insert a new row with a fresh
 * EffectiveFrom. The `ITariffResolver` (server) reads the table at
 * landed-cost calc time.
 */
export interface TariffRate {
  id: number;
  htsCode: string;
  countryOfOrigin: string;
  ratePct: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTariffRateRequest {
  htsCode: string;
  countryOfOrigin: string;
  ratePct: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  source?: string | null;
}

export interface UpdateTariffRateRequest {
  ratePct: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
}

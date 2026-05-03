import { SelectOption } from '../components/select/select.component';

/**
 * Common ISO-4217 currency codes used in pricing surfaces (vendor-part
 * tiers, price-list entries, part-pricing-cluster). Curated to North
 * American + European + Asian sourcing — admin-extensibility is a Pillar 5
 * Phase 2 candidate; until then this is the single source of truth so the
 * pricing surfaces don't drift.
 *
 * Used by:
 *   - shared/components/select via `[options]="CURRENCY_OPTIONS"`
 *   - shared/components/select via `<app-select>` consumers
 *
 * Replaces the recurring `<app-input maxlength=3>` pattern that allowed
 * free-text typos ("usd" / "Usd" / "$" / "Dollars") and silently broke
 * downstream currency-display formatting.
 */
export const CURRENCY_OPTIONS: SelectOption[] = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'CAD', label: 'CAD' },
  { value: 'MXN', label: 'MXN' },
  { value: 'CNY', label: 'CNY' },
  { value: 'JPY', label: 'JPY' },
];

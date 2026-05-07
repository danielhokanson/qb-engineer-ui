import { SelectOption } from '../../../shared/components/select/select.component';

/**
 * Incoterms 2020 — international commerce terms defining who pays freight,
 * who insures, and when title transfers between buyer and seller. Mirrors
 * the server-side `QBEngineer.Core.Enums.Incoterm` values exactly.
 *
 * Stored on `VendorPart.Incoterm` (default for that part from that vendor)
 * and overridable per `PurchaseOrder.Incoterm`. Cost-calc behavior keys off
 * the term — most freight-paid-by-seller terms (CFR/CIF/CPT/CIP/DAP/DPU)
 * default the line's freight-included flag to true; DDP also defaults
 * duty-included.
 *
 * `FOB_Origin` (US convention; equivalent to the ICC term `FOB`) is the
 * default for new VendorParts — most common US-domestic case.
 */
export const INCOTERM_OPTIONS: SelectOption[] = [
  { value: 'EXW', label: 'EXW — Ex Works (buyer arranges all transport)' },
  { value: 'FCA', label: 'FCA — Free Carrier' },
  { value: 'FAS', label: 'FAS — Free Alongside Ship' },
  { value: 'FOB', label: 'FOB — Free on Board (sea/inland)' },
  { value: 'FOB_Origin', label: 'FOB Origin — buyer takes title at shipping point' },
  { value: 'FOB_Destination', label: 'FOB Destination — seller retains title to dock' },
  { value: 'CFR', label: 'CFR — Cost and Freight (seller pays freight)' },
  { value: 'CIF', label: 'CIF — Cost, Insurance and Freight' },
  { value: 'CPT', label: 'CPT — Carriage Paid To' },
  { value: 'CIP', label: 'CIP — Carriage and Insurance Paid To' },
  { value: 'DAP', label: 'DAP — Delivered at Place' },
  { value: 'DPU', label: 'DPU — Delivered at Place Unloaded' },
  { value: 'DDP', label: 'DDP — Delivered Duty Paid' },
];

// Quote-currency options live in `reference_data` group `currency` (seeded
// with USD/EUR/GBP/CAD/MXN/JPY/CNY). Components fetch via
// `ReferenceDataService.getAsOptions('currency')` so admins can extend the
// list without a code change.

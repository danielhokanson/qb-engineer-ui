import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  EventEmitter,
  inject,
  input,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, tap, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { EntityPickerComponent } from '../../../../shared/components/entity-picker/entity-picker.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { VendorListItem } from '../../../vendors/models/vendor-list-item.model';
import { VendorQuickCreateDialogComponent, VendorQuickCreateDialogData } from '../../../vendors/components/vendor-quick-create-dialog/vendor-quick-create-dialog.component';
import { VendorPart, VendorPartPriceTier } from '../../models/vendor-part.model';
import { VendorPartsService } from '../../services/vendor-parts.service';
import { toDateOnly, toIsoDate } from '../../../../shared/utils/date.utils';

/**
 * A new price tier that the user has typed but not yet committed to the
 * server. Lives in `pendingTiersByVp` until the panel-level Save button
 * iterates them and POSTs each. Identified by a stable temp id so the
 * trackBy stays stable across re-renders even when the list grows.
 */
interface PendingTier {
  tempId: string;
  form: FormGroup;
}

/**
 * One entry in the editable tier table — either a pending tier the user
 * has typed but not saved, or the always-trailing blank slot at the
 * bottom. The slotId is stable across kind flips: when an empty slot
 * promotes to pending, the same slotId stays on it, so Angular's @for
 * trackBy preserves the underlying TR DOM and the user's focused input
 * never gets re-created. A NEW empty slot (with a new slotId) is
 * appended below. Promote-on-input requires this stability — without
 * it the user's keystrokes after the first one would land on the
 * fresh empty row that replaced the one they were typing in, causing
 * a per-keystroke promote spiral.
 */
interface TierSlot {
  slotId: string;
  kind: 'pending' | 'empty';
  form: FormGroup;
  tempId?: string;
}

/**
 * Flat row for the cross-vendor "Pricing" view — one row per tier
 * across every vendor source, sorted by min qty then vendor name.
 * Carries the vendor identity inline so the table is self-contained
 * (no joins needed at the template level).
 */
interface FlatTierRow {
  tierId: number;
  vendorPartId: number;
  vendorCompanyName: string;
  isPreferred: boolean;
  minQuantity: number;
  unitPrice: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Vendor Sources panel — inline grouped editor for the (Part, Vendor)
 * intersection rows. Replaces the prior list-panel + edit-dialog +
 * tier-dialog stack with a single page surface where each vendor source
 * is a stacked group: 1:1 fields editable inline, plus a nested
 * price-tier editor.
 *
 * Layout:
 *   ┌── [Preferred] Acme Inc ───────── [actions] ──┐
 *   │  Vendor MPN  Vendor SKU                       │
 *   │  Lead time   MOQ   Pack size                  │
 *   │  Country  HTS  Last quoted                    │
 *   │  ─── Price tiers ───────────                  │
 *   │  Min qty  Price  From  To  ×                  │
 *   │  [+ Add tier]                                 │
 *   └────────────────────────────────────────────────┘
 *   ┌── Beta Supply ─────────────────── [actions] ─┐
 *   │ ...                                          │
 *   └──────────────────────────────────────────────┘
 *   [+ Add another vendor source]
 *
 * Behavior:
 * - Sort: preferred vendor first, then alphabetical by vendor name.
 * - When `preferredVendorId` is set but no VendorPart row exists for
 *   that vendor, render a STUB group at the top. The stub becomes a
 *   real VendorPart on the user's first field blur (POST /vendor-parts).
 * - Per-row 1:1 fields save on blur via a debounced PATCH-style update.
 * - Tiers: each row has an inline mini-table; "Add tier" inserts a new
 *   row, save-on-add. Existing tiers can only be deleted (not edited
 *   in place — to change a tier, delete + re-add the new value).
 * - "Set as preferred" on a non-preferred row updates Part.preferredVendorId
 *   AND the row's isPreferred flag (server enforces single-preferred
 *   uniqueness).
 * - Adding a new vendor source uses an inline EntityPicker with
 *   createNew enabled — typing a name not in the system surfaces
 *   "Create new vendor 'X'" via the standard inline-create affordance.
 *
 * The component is consumed by:
 *  - PartVendorPartsStepComponent (workflow guided step)
 *  - PartDetailPanelComponent's "Sources" tab
 */
@Component({
  selector: 'app-vendor-sources-panel',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, TranslatePipe, MatTooltipModule,
    InputComponent, TextareaComponent, DatepickerComponent,
    CurrencyInputComponent, EntityPickerComponent, SelectComponent,
    EmptyStateComponent, LoadingBlockDirective, ValidationButtonComponent,
  ],
  templateUrl: './vendor-sources-panel.component.html',
  styleUrl: './vendor-sources-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorSourcesPanelComponent {
  private readonly vendorPartsService = inject(VendorPartsService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(MatDialog);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  /** FormControl bound to the inline EntityPicker for adding a new
   *  vendor source. We subscribe to valueChanges instead of using
   *  ngModelChange because the picker is a ControlValueAccessor and
   *  prefers the reactive-forms wiring path. */
  protected readonly addVendorControl = new FormControl<number | null>(null);

  // ─── Inputs ─────────────────────────────────────────────────────────
  readonly partId = input.required<number | null>();
  readonly partLabel = input<string>('');
  /** From Part.preferredVendorId (set on the upstream Sourcing step). */
  readonly preferredVendorId = input<number | null>(null);
  /** Display name for the preferred vendor — needed to render the stub
   *  group when no VendorPart row exists for that vendor yet. */
  readonly preferredVendorName = input<string>('');
  /**
   * Edit mode toggle. The workflow step always passes true (the wizard IS
   * edit mode); the part detail page wires this to its own `editing()`
   * signal so Sources tab renders read-only when the user hasn't clicked
   * the Edit pencil. When false:
   *   • All form inputs render as plain text (read-only display).
   *   • Action buttons (Set as preferred, Remove, Add tier, Add another
   *     vendor source) are hidden.
   *   • The preferred-stub doesn't render — there's no point showing a
   *     "fill in details" prompt the user can't act on.
   */
  readonly editing = input<boolean>(true);

  // ─── Outputs ────────────────────────────────────────────────────────
  /** Fired when any underlying VendorPart or tier changed, so wrappers
   *  can refresh their own state (e.g. a part-detail page that mirrors
   *  the preferred vendor in its header). */
  @Output() readonly changed = new EventEmitter<void>();
  /** Fired when the user explicitly changes which vendor is preferred —
   *  the parent should call PartsService.update({ preferredVendorId })
   *  so the Part FK matches the row's new isPreferred flag. */
  @Output() readonly preferredVendorChanged = new EventEmitter<number>();
  /** Fired when the user clicks the panel-level Save or Cancel button —
   *  the parent typically uses this to exit edit mode. Per-row 1:1
   *  fields auto-save on blur; this signal is purely "user said done". */
  @Output() readonly cancelled = new EventEmitter<void>();

  // ─── State ──────────────────────────────────────────────────────────
  protected readonly loading = signal(false);
  protected readonly vendorParts = signal<VendorPart[]>([]);
  protected readonly addingVendor = signal(false);
  /**
   * Per-vendor-part set of existing tier IDs the user has marked for
   * delete. Deletion is deferred — the row stays visible (struck-through)
   * with an Undo affordance until the page-level Save flushes the queue.
   */
  protected readonly pendingDeletesByVp = signal<Map<number, Set<number>>>(new Map());

  /**
   * Slot ids whose green-glow fade-in animation is still playing. Used
   * to highlight the NEW empty slot that just appeared below a row the
   * user promoted, so the appearance reads as "your data was captured."
   */
  protected readonly justAddedSlotIds = signal<Set<string>>(new Set());

  /**
   * Tier slots (pending typed-but-not-saved + always-trailing empty)
   * keyed by vendorPartId. Each vp always has at least one slot, and
   * the LAST one is always kind='empty' so there's a place to type a
   * new tier. See TierSlot above for why slotIds are stable across
   * kind flips.
   */
  protected readonly tierSlotsByVp = signal<Map<number, TierSlot[]>>(new Map());
  private slotIdCounter = 0;

  /** "Show history" toggle — when true the tier list returns superseded rows too. */
  protected readonly showTierHistory = signal(false);

  /** Sorted view for rendering — preferred first, alphabetical otherwise. */
  protected readonly sortedRows = computed<VendorPart[]>(() => {
    const list = [...this.vendorParts()];
    return list.sort((a, b) => {
      if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
      return a.vendorCompanyName.localeCompare(b.vendorCompanyName);
    });
  });

  /** True when Part.preferredVendorId is set but no VendorPart row yet
   *  exists for that pairing — surfaces a stub group at the top so the
   *  user has a place to start filling in details. */
  protected readonly preferredStubVisible = computed<boolean>(() => {
    const pvId = this.preferredVendorId();
    if (pvId == null) return false;
    return !this.vendorParts().some(v => v.vendorId === pvId);
  });

  // ─── View modes (re-introduced from PR #51) ─────────────────────────
  //
  // Three presentations of the same source list:
  //   • 'inspector' (default, Pattern C): cards collapsed to header +
  //     summary + tier table; full per-source 1:1 fields shown in a
  //     right-side property inspector for the selected card. Best for
  //     quick scanning + drill-down.
  //   • 'compare' (Pattern B): cards stacked with a per-card expand
  //     chevron that accordion-expands the full 1:1 fields inline.
  //     Best for side-by-side comparison.
  //   • 'pricing': flat cross-vendor table — one row per tier across
  //     every source, sorted by min qty asc then vendor name. Answers
  //     "where can I buy this part cheapest at qty N?" at a glance.

  protected readonly viewMode = signal<'inspector' | 'compare' | 'pricing'>('inspector');

  /** In compare mode, which cards have their details accordion expanded. */
  protected readonly expandedDetailIds = signal<Set<number>>(new Set());

  /**
   * Flat list of every tier across every vendor source on this part —
   * powers the "Pricing" view. Sorted by min_qty asc, then vendor name
   * within each min_qty bracket so the user reads down "at qty N,
   * here's everyone." Respects the showTierHistory toggle: superseded
   * rows appear (greyed by template class) only when on.
   */
  protected readonly allTiersFlat = computed<FlatTierRow[]>(() => {
    const rows: FlatTierRow[] = [];
    for (const vp of this.vendorParts()) {
      for (const t of vp.priceTiers ?? []) {
        if (!this.showTierHistory() && t.effectiveTo) continue;
        rows.push({
          tierId: t.id,
          vendorPartId: vp.id,
          vendorCompanyName: vp.vendorCompanyName,
          isPreferred: vp.isPreferred,
          minQuantity: t.minQuantity,
          unitPrice: t.unitPrice,
          currency: t.currency,
          effectiveFrom: t.effectiveFrom,
          effectiveTo: t.effectiveTo,
        });
      }
    }
    rows.sort((a, b) =>
      a.minQuantity - b.minQuantity
      || a.vendorCompanyName.localeCompare(b.vendorCompanyName));
    return rows;
  });

  /** Per-card "expanded?" check used by the compare-mode accordion. */
  protected isExpanded(vpId: number): boolean {
    return this.expandedDetailIds().has(vpId);
  }

  /** Compare-mode chevron handler — toggle this card's accordion. */
  protected toggleDetails(vpId: number): void {
    const next = new Set(this.expandedDetailIds());
    if (next.has(vpId)) next.delete(vpId);
    else next.add(vpId);
    this.expandedDetailIds.set(next);
  }

  /**
   * Header-line summary for a vendor source — small dim text shown in
   * inspector / compare mode card headers so the user gets the gist
   * without expanding. Format: "Lead Nd · MOQ N · CC · N tiers".
   * Each piece is omitted when not present so single-piece rows don't
   * read as full of placeholders.
   */
  protected summary(row: VendorPart): string {
    const parts: string[] = [];
    if (row.leadTimeDays != null) parts.push(`Lead ${row.leadTimeDays}d`);
    if (row.minOrderQty != null) parts.push(`MOQ ${row.minOrderQty}`);
    if (row.countryOfOrigin) parts.push(row.countryOfOrigin);
    const tierCount = (row.priceTiers ?? []).filter(t => !t.effectiveTo).length;
    if (tierCount > 0) parts.push(`${tierCount} tier${tierCount === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }

  /** Per-row dirty-tracking forms. Indexed by vendorPart id (or -1 for
   *  the preferred stub row). FormGroup created lazily as rows are seen. */
  protected readonly rowForms = new Map<number, FormGroup>();

  /** Per-row "new tier" mini-forms, indexed by vendorPartId (or -1 for stub). */
  /**
   * Per-row tier forms, keyed by `${vendorPartId}:${tierId|'new'}`. The
   * 'new' key is for the always-present empty bottom row that adds a
   * fresh tier when the user types into it; existing tier ids are used
   * when an existing row goes into cell-edit mode.
   */
  protected readonly tierForms = new Map<string, FormGroup>();

  /** Currency options for the source-level select. ISO-4217 short list. */
  protected readonly currencyOptions: SelectOption[] = [
    { value: 'USD', label: 'USD ($)' },
    { value: 'EUR', label: 'EUR (€)' },
    { value: 'GBP', label: 'GBP (£)' },
    { value: 'CAD', label: 'CAD ($)' },
    { value: 'MXN', label: 'MXN ($)' },
    { value: 'JPY', label: 'JPY (¥)' },
    { value: 'CNY', label: 'CNY (¥)' },
  ];

  constructor() {
    effect(() => {
      const id = this.partId();
      if (id == null) {
        this.vendorParts.set([]);
        this.rowForms.clear();
        this.tierForms.clear();
        return;
      }
      this.load(id);
    });

    // React when the user picks a vendor in the inline EntityPicker.
    this.addVendorControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((vendorId) => {
        if (typeof vendorId === 'number') this.onVendorSelected(vendorId);
      });

    // 2026-05-06: inspector auto-select effect retired. Each vendor now
    // renders its OWN detail pane next to its card — there's no single
    // selected source anymore.
  }

  // ─── Loading ────────────────────────────────────────────────────────
  private load(partId: number): void {
    this.loading.set(true);
    this.vendorPartsService.listForPart(partId).subscribe({
      next: (list) => {
        this.vendorParts.set(list);
        // Drop any forms for rows that no longer exist (e.g. after delete).
        const ids = new Set(list.map(v => v.id));
        for (const key of [...this.rowForms.keys()]) {
          if (key !== -1 && !ids.has(key)) this.rowForms.delete(key);
        }
        for (const key of [...this.tierForms.keys()]) {
          // tierForms keys are now `${vpId}:${tierId|'new'}` strings; drop
          // any whose vpId no longer matches a known row.
          const colon = key.indexOf(':');
          const vpIdStr = colon < 0 ? key : key.substring(0, colon);
          const vpId = parseInt(vpIdStr, 10);
          if (vpId !== this.STUB_ID && !ids.has(vpId)) this.tierForms.delete(key);
        }
        // Seed forms for every existing tier so they participate in the
        // page's validation + Save batch. Idempotent — pristine forms get
        // re-seeded with current values; dirty forms are left untouched.
        this.seedExistingTierForms();
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // ─── Per-row form access (created lazily) ───────────────────────────
  /** Stub key for the preferred-vendor-no-row-yet group. */
  protected readonly STUB_ID = -1;

  /**
   * Currency string for the stub article's price-tier table column header
   * + currency-input symbol. Reads from the stub form (which defaults to
   * USD on create; user can swap via the Currency select). Bumps via
   * formsTicker so the table re-renders on currency change.
   */
  protected stubCurrency(): string {
    this.formsTicker();
    const form = this.rowForms.get(this.STUB_ID);
    return (form?.get('currency')?.value as string | null) ?? 'USD';
  }

  /** Returns the form for a row, creating it if first access. */
  protected formFor(row: VendorPart | null): FormGroup {
    const key = row?.id ?? this.STUB_ID;
    let form = this.rowForms.get(key);
    if (!form) {
      form = this.fb.group({
        vendorPartNumber: [row?.vendorPartNumber ?? '', [Validators.required, Validators.maxLength(100)]],
        manufacturerName: [row?.manufacturerName ?? '', [Validators.maxLength(200)]],
        vendorMpn: [row?.vendorMpn ?? '', [Validators.maxLength(100)]],
        leadTimeDays: [row?.leadTimeDays ?? null, [Validators.min(0)]],
        minOrderQty: [row?.minOrderQty ?? null, [Validators.min(0)]],
        packSize: [row?.packSize ?? null, [Validators.min(0)]],
        countryOfOrigin: [row?.countryOfOrigin ?? '', [Validators.maxLength(2)]],
        htsCode: [row?.htsCode ?? '', [Validators.maxLength(20)]],
        certifications: [row?.certifications ?? '', [Validators.maxLength(500)]],
        lastQuotedDate: [row?.lastQuotedDate ? new Date(row.lastQuotedDate) : null],
        notes: [row?.notes ?? '', [Validators.maxLength(2000)]],
        currency: [row?.currency ?? 'USD', [Validators.required, Validators.maxLength(3)]],
      });
      // Bump the panel-level reactivity ticker whenever this row's status
      // changes so panelViolations / panelValid recompute. takeUntilDestroyed
      // ensures the subscription dies with the component.
      form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.formsTicker.update(v => v + 1);
      });
      this.rowForms.set(key, form);
      // First-tick bump so a freshly-created form's invalid-state surfaces
      // without waiting for a status change.
      queueMicrotask(() => this.formsTicker.update(v => v + 1));
    }
    return form;
  }

  // ─── Panel-level validation aggregation ─────────────────────────────
  //
  // The panel hosts N row forms, one per vendor source. The Save button
  // (per CLAUDE.md "Save Action — Required on Every Editable Surface")
  // gates on ALL row forms being valid, with a `<app-validation-button>`
  // surfacing the why. Aggregation walks every row form via formsTicker
  // (bumped from each form's statusChanges) so the computed signals
  // recompute reactively.
  private readonly formsTicker = signal(0);

  private readonly violationLabels: Record<string, string> = {
    vendorPartNumber: 'Vendor Part #',
    manufacturerName: 'Manufacturer',
    vendorMpn: 'Manufacturer Part #',
    leadTimeDays: 'Lead Time (days)',
    minOrderQty: 'Min Order Qty',
    packSize: 'Pack Size',
    countryOfOrigin: 'Country of Origin',
    htsCode: 'HTS Code',
    certifications: 'Certifications',
    notes: 'Notes',
    currency: 'Currency',
    minQuantity: 'Tier Min Qty',
    unitPrice: 'Tier Unit Price',
    effectiveFrom: 'Tier Effective From',
  };

  protected readonly panelViolations = computed<string[]>(() => {
    this.formsTicker(); // dependency
    const out: string[] = [];
    // Only iterate row forms that correspond to a CURRENTLY VISIBLE
    // vendor card. The STUB_ID form is only visible when preferredStub-
    // Visible() is true; once the stub materializes (via
    // adoptStubMaterializedRow), the STUB_ID form gets re-keyed under
    // the real vp.id. But if a stale STUB_ID entry survives the
    // transition for any reason (race, cancelled save, etc.) the user
    // would see a phantom "Acme Metals Supply: Vendor Part # is required"
    // with the field clearly filled. Skip orphan keys.
    const visibleVpIds = new Set(this.vendorParts().map(v => v.id));
    const stubVisible = this.preferredStubVisible();
    for (const [key, form] of this.rowForms.entries()) {
      if (key === this.STUB_ID) {
        if (!stubVisible) continue;
      } else if (!visibleVpIds.has(key)) {
        continue;
      }
      const vendorName = this.vendorNameForForm(form);
      const items = FormValidationService.collectViolations(form, this.violationLabels);
      for (const msg of items) {
        out.push(vendorName ? `${vendorName}: ${msg}` : msg);
      }
    }
    // Existing-tier forms now participate in panel-level validation
    // because every tier is always editable (no separate "edit mode").
    // Skip tiers the user has marked for delete — they're going away on
    // Save, so their values don't gate validity. Use 1-based row position
    // within the vendor's visible-tiers list as the user-facing label.
    for (const vp of this.vendorParts()) {
      const visible = (vp.priceTiers ?? []).filter(t => !t.effectiveTo);
      const deletes = this.pendingDeletesByVp().get(vp.id);
      visible.forEach((tier, idx) => {
        if (deletes?.has(tier.id)) return;
        const form = this.tierForms.get(this.tierKey(vp.id, tier.id));
        if (!form) return;
        const items = FormValidationService.collectViolations(form, this.violationLabels);
        for (const msg of items) {
          out.push(`${vp.vendorCompanyName} (tier #${idx + 1}): ${msg}`);
        }
      });
    }
    // Pending tiers gate Save — surface their problems with the owning
    // vendor's name + a "new tier #N" suffix where N is 1-based position
    // within the pending list for that vendor. Empty trailing slots are
    // skipped — they don't gate validity (the user hasn't typed yet).
    for (const [vpId, slots] of this.tierSlotsByVp().entries()) {
      const vendorName = vpId === this.STUB_ID
        ? this.preferredVendorName() || ''
        : this.vendorParts().find(v => v.id === vpId)?.vendorCompanyName ?? '';
      const pending = slots.filter(s => s.kind === 'pending');
      pending.forEach((s, idx) => {
        const items = FormValidationService.collectViolations(s.form, this.violationLabels);
        for (const msg of items) {
          out.push(vendorName
            ? `${vendorName} (new tier #${idx + 1}): ${msg}`
            : `New tier #${idx + 1}: ${msg}`);
        }
      });
    }
    return out;
  });

  protected readonly panelValid = computed<boolean>(() => {
    this.formsTicker();
    // Same orphan-key skip as panelViolations: only gate on row forms
    // whose vendor card is actually visible.
    const visibleVpIds = new Set(this.vendorParts().map(v => v.id));
    const stubVisible = this.preferredStubVisible();
    for (const [key, form] of this.rowForms.entries()) {
      if (key === this.STUB_ID) {
        if (!stubVisible) continue;
      } else if (!visibleVpIds.has(key)) {
        continue;
      }
      if (form.invalid) return false;
    }
    for (const vp of this.vendorParts()) {
      const deletes = this.pendingDeletesByVp().get(vp.id);
      for (const tier of (vp.priceTiers ?? [])) {
        if (tier.effectiveTo) continue;
        if (deletes?.has(tier.id)) continue;
        const form = this.tierForms.get(this.tierKey(vp.id, tier.id));
        if (form && form.invalid) return false;
      }
    }
    for (const slots of this.tierSlotsByVp().values()) {
      for (const s of slots) {
        if (s.kind === 'pending' && s.form.invalid) return false;
      }
    }
    return true;
  });

  private vendorNameForForm(form: FormGroup): string {
    for (const [key, f] of this.rowForms.entries()) {
      if (f !== form) continue;
      if (key === this.STUB_ID) return this.preferredVendorName() || '';
      return this.vendorParts().find(v => v.id === key)?.vendorCompanyName ?? '';
    }
    return '';
  }

  /**
   * Compose the tierForms key — one form per (vendorPart, tier) edit slot.
   * `tierId` can be a real numeric tier id (cell-edit on an existing
   * tier), `'new'` (the always-empty bottom row), or a `'pending-N'`
   * temp id (a tier the user typed but hasn't saved yet — see
   * pendingTiersByVp).
   */
  protected tierKey(vpId: number, tierId: number | string): string {
    return `${vpId}:${tierId}`;
  }

  /**
   * Lazy-create form for editing a tier OR for the empty bottom row
   * ('new'). Existing-tier forms get pre-populated by
   * {@link seedExistingTierForms} on every list load; the 'new' form
   * starts blank with effectiveFrom defaulted to today so the user only
   * has to type qty + price before the row promotes to a pending tier.
   */
  protected tierFormFor(vpId: number, tierId: number | 'new'): FormGroup {
    const key = this.tierKey(vpId, tierId);
    let form = this.tierForms.get(key);
    if (!form) {
      form = this.fb.group({
        minQuantity: [null as number | null, [Validators.required, Validators.min(1)]],
        unitPrice: [null as number | null, [Validators.required, Validators.min(0)]],
        effectiveFrom: [new Date(), [Validators.required]],
      });
      this.tierForms.set(key, form);
    }
    return form;
  }

  /** Tiers visible in the table — currently effective always; superseded only when toggle is on. */
  protected visibleTiers(row: VendorPart): VendorPartPriceTier[] {
    const all = row.priceTiers ?? [];
    if (this.showTierHistory()) return all;
    return all.filter(t => !t.effectiveTo);
  }

  // ─── Save-on-blur for 1:1 fields ────────────────────────────────────
  /**
   * Called from blur events on any per-row field. Wraps saveRow$ with a
   * fire-and-forget subscribe so the existing on-blur path stays unchanged
   * (most callers don't care about completion). The Observable form is
   * onSaveAll's batch-orchestrator path — it needs to chain stub-creates
   * BEFORE pending-tier inserts so the tiers can land under the real
   * (just-materialized) vendor-part id.
   */
  protected saveRow(row: VendorPart | null): void {
    this.saveRow$(row).subscribe();
  }

  /**
   * Observable variant of saveRow. Returns:
   *   • the just-created VendorPart for stubs (after adoptStubMaterializedRow
   *     re-keys forms + pending tiers under the new id),
   *   • the unchanged row for existing rows after PATCH succeeds,
   *   • of(null) when there's nothing to save (form pristine/invalid/no
   *     part id/no vendor for stub).
   * Errors surface to the caller; the snackbar fires on the way out via
   * tap-error.
   */
  private saveRow$(row: VendorPart | null): Observable<VendorPart | null> {
    const partId = this.partId();
    if (partId == null) return of(null);
    const form = this.formFor(row);
    if (!form.dirty || form.invalid) return of(null);
    const v = form.getRawValue();
    const payload = {
      vendorPartNumber: v.vendorPartNumber || null,
      manufacturerName: v.manufacturerName || null,
      vendorMpn: v.vendorMpn || null,
      leadTimeDays: v.leadTimeDays ?? null,
      minOrderQty: v.minOrderQty ?? null,
      packSize: v.packSize ?? null,
      countryOfOrigin: v.countryOfOrigin || null,
      htsCode: v.htsCode || null,
      certifications: v.certifications || null,
      // Server expects DateOnly (YYYY-MM-DD). toDateOnly extracts the
      // local calendar date — `.toISOString().slice(0, 10)` would take
      // the UTC date which can differ for negative-UTC users.
      lastQuotedDate: toDateOnly(v.lastQuotedDate),
      notes: v.notes || null,
      currency: v.currency || 'USD',
    };

    if (!row) {
      // Stub: materialize with the preferred vendor + this part.
      const vendorId = this.preferredVendorId();
      if (vendorId == null) return of(null);
      return this.vendorPartsService.create({
        vendorId, partId, isPreferred: true, ...payload,
      }).pipe(
        tap((created) => {
          this.adoptStubMaterializedRow(form, created);
          this.changed.emit();
        }),
        catchError((err) => {
          this.snackbar.error(this.translate.instant('vendorSources.saveFailed'));
          return throwError(() => err);
        }),
      );
    }

    return this.vendorPartsService.update(row.id, payload).pipe(
      tap(() => {
        form.markAsPristine();
        this.changed.emit();
      }),
      map(() => row),
      catchError((err) => {
        this.snackbar.error(this.translate.instant('vendorSources.saveFailed'));
        return throwError(() => err);
      }),
    );
  }

  /**
   * Stub→real transition. Called from saveRow's stub-success path.
   *
   * Two bugs this fixes that the naive "delete STUB_ID, set createdId, load()"
   * sequence introduced:
   *
   *   1. Validation reset — when delete(STUB_ID) ran but vendorParts() hadn't
   *      yet been refreshed (load is async), the next change-detection tick
   *      re-rendered the still-visible stub article, called formFor(null),
   *      which re-created an EMPTY form B at STUB_ID. Now there were two
   *      forms: form A at createdId ("3g45e3", valid) and form B at STUB_ID
   *      (empty, fails Validators.required). panelViolations walks the whole
   *      map and surfaces form B's violation forever — "Vendor Part # is
   *      required" even though the visible field showed the value.
   *
   *   2. Pending tiers + the empty-tier 'new' form for the stub were keyed
   *      under STUB_ID; onSaveAll skipped STUB_ID-keyed pending tiers (no
   *      real vp id to POST against), so any tier the user typed during
   *      the stub phase was lost when they Saved.
   *
   * Fix: optimistically merge the created row into vendorParts() BEFORE
   * load(), so preferredStubVisible() flips false on the same tick — the
   * stub article is removed from the DOM in the very next CD pass and
   * formFor(null) is never called again. Re-key every STUB_ID-keyed
   * tier form + pending tier under createdId so the data the user
   * entered while in stub mode survives the transition.
   */
  private adoptStubMaterializedRow(form: FormGroup, created: VendorPart): void {
    // 1) Re-key the row form.
    this.rowForms.delete(this.STUB_ID);
    form.markAsPristine();
    this.rowForms.set(created.id, form);

    // 2) Re-key every tier form keyed under STUB_ID.
    const stubPrefix = `${this.STUB_ID}:`;
    const newPrefix = `${created.id}:`;
    for (const oldKey of Array.from(this.tierForms.keys())) {
      if (!oldKey.startsWith(stubPrefix)) continue;
      const newKey = newPrefix + oldKey.slice(stubPrefix.length);
      const tierForm = this.tierForms.get(oldKey);
      if (tierForm) {
        this.tierForms.delete(oldKey);
        this.tierForms.set(newKey, tierForm);
      }
    }

    // 3) Re-key tier slots from STUB_ID to created.id (pending + the
    //    trailing empty). Both kinds carry over so the user's typed
    //    drafts AND the trailing empty slot land under the real vp id.
    const slotsMap = new Map(this.tierSlotsByVp());
    const stubSlots = slotsMap.get(this.STUB_ID);
    if (stubSlots && stubSlots.length > 0) {
      slotsMap.delete(this.STUB_ID);
      const existing = slotsMap.get(created.id) ?? [];
      slotsMap.set(created.id, [...existing, ...stubSlots]);
      this.tierSlotsByVp.set(slotsMap);
    } else if (slotsMap.has(this.STUB_ID)) {
      slotsMap.delete(this.STUB_ID);
      this.tierSlotsByVp.set(slotsMap);
    }

    // 4) Optimistically merge the created row into vendorParts so
    //    preferredStubVisible() flips false RIGHT NOW — before load()
    //    completes. This is the key step: it prevents the orphan-form
    //    bug by ensuring formFor(null) is never called again for this
    //    stub. load() still runs to pick up server-side defaults
    //    (lastQuotedDate, computed price tier counts, etc.).
    this.vendorParts.update(list => {
      if (list.some(v => v.id === created.id)) return list;
      return [...list, created];
    });

    // 5) Bump the validation ticker so panelViolations recomputes against
    //    the new key and clears any stale stub-keyed violations.
    this.formsTicker.update(n => n + 1);

    const partId = this.partId();
    if (partId != null) this.load(partId);
  }

  // ─── Tier edit / commit / remove (SCD Type 2) ────────────────────────

  /** Toggle the "Show history" view that surfaces superseded tiers. */
  protected toggleTierHistory(): void {
    const next = !this.showTierHistory();
    this.showTierHistory.set(next);
    const partId = this.partId();
    if (partId != null) this.reload(partId);
  }

  /**
   * Seed forms for every existing tier on every loaded vendor-part so
   * panelValid / panelViolations + onSaveAll can iterate them. Called
   * after each list load. Forms are created pristine and re-seeded
   * (without flipping dirty) when the server values come back unchanged
   * — preserves any in-progress edits the user was making before reload.
   */
  private seedExistingTierForms(): void {
    for (const vp of this.vendorParts()) {
      for (const tier of vp.priceTiers ?? []) {
        if (tier.effectiveTo) continue; // superseded — read-only display
        const key = this.tierKey(vp.id, tier.id);
        const existing = this.tierForms.get(key);
        if (existing && existing.dirty) continue; // user is editing — leave alone
        const form = existing ?? this.fb.group({
          minQuantity: [null as number | null, [Validators.required, Validators.min(1)]],
          unitPrice: [null as number | null, [Validators.required, Validators.min(0)]],
          effectiveFrom: [new Date(), [Validators.required]],
        });
        form.reset({
          minQuantity: tier.minQuantity,
          unitPrice: tier.unitPrice,
          effectiveFrom: new Date(tier.effectiveFrom),
        });
        if (!existing) {
          form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.formsTicker.update(n => n + 1);
          });
          this.tierForms.set(key, form);
        }
      }
    }
    this.formsTicker.update(n => n + 1);
  }

  /** True when this existing tier is queued for delete on next Save. */
  protected isPendingDelete(vpId: number, tierId: number): boolean {
    return this.pendingDeletesByVp().get(vpId)?.has(tierId) ?? false;
  }

  /** Queue a delete for the page Save — does NOT hit the server. */
  protected markTierForDelete(vpId: number, tierId: number): void {
    const map = new Map(this.pendingDeletesByVp());
    const set = new Set(map.get(vpId) ?? []);
    set.add(tierId);
    map.set(vpId, set);
    this.pendingDeletesByVp.set(map);
    this.formsTicker.update(n => n + 1);
  }

  /** Reverse a pending delete before Save fires. */
  protected unmarkTierForDelete(vpId: number, tierId: number): void {
    const map = new Map(this.pendingDeletesByVp());
    const set = new Set(map.get(vpId) ?? []);
    set.delete(tierId);
    map.set(vpId, set);
    this.pendingDeletesByVp.set(map);
    this.formsTicker.update(n => n + 1);
  }

  /** True while the green-glow fade-out animation is still playing. */
  protected isJustAdded(slotId: string): boolean {
    return this.justAddedSlotIds().has(slotId);
  }

  // ─── Tier slots (pending + trailing empty, batch-saved via Save) ───
  //
  // 2026-05-06: previously this was `pendingTiersByVp` (a list of
  // user-typed-but-not-saved tiers) PLUS a separate static empty <tr>
  // at the bottom. The split caused a focus-loss problem: when a user
  // typed in the empty row, the row promoted (form moved to pending),
  // and the static empty <tr>'s [formGroup] re-bound to a fresh form —
  // losing focus + truncating mid-keystroke when promote-on-input
  // fired per character.
  //
  // The fix: one @for over `tierSlotsByVp` per vendor, where each slot
  // has a stable slotId. When an empty slot promotes to pending, its
  // slotId stays the same — Angular's trackBy keeps the underlying TR
  // DOM, so the user's focused input element is preserved + their
  // keystrokes continue going into the same form (now a pending tier).
  // A new empty slot is appended below with a NEW slotId and a fresh
  // form. The (input) handler checks slot.kind and bails for already-
  // promoted slots, so subsequent keystrokes don't re-trigger promote.
  private nextPendingTierIndex = 0;

  /**
   * Returns the slot list for a vendor, lazily seeding it with one
   * trailing empty slot if the vendor has never been touched. Template
   * helper (called once per render in @for so each vp's slots survive
   * across CD cycles).
   */
  protected tierSlots(vpId: number): TierSlot[] {
    const existing = this.tierSlotsByVp().get(vpId);
    if (existing) return existing;
    // Lazy seeding inside a getter is normally a code smell, but the
    // template needs the slots to exist on first render. Defer the
    // signal mutation to a microtask so the current CD cycle isn't
    // interrupted, and return the seeded list synchronously.
    const seeded = [this.makeEmptySlot()];
    queueMicrotask(() => {
      const map = new Map(this.tierSlotsByVp());
      if (!map.has(vpId)) {
        map.set(vpId, seeded);
        this.tierSlotsByVp.set(map);
      }
    });
    return seeded;
  }

  /** Filter helper: only the pending tier slots for a vendor. */
  protected pendingSlots(vpId: number): TierSlot[] {
    return this.tierSlots(vpId).filter(s => s.kind === 'pending');
  }

  /** Backwards-compat shape for callers expecting (tempId, form) tuples. */
  protected pendingTiers(vpId: number): PendingTier[] {
    return this.pendingSlots(vpId).map(s => ({ tempId: s.tempId!, form: s.form }));
  }

  /**
   * Build a fresh empty slot. The form has the same Validators as
   * pending so when the slot promotes nothing changes about the form;
   * only the kind flag flips.
   */
  private makeEmptySlot(): TierSlot {
    const slotId = `slot-${++this.slotIdCounter}`;
    const form = this.fb.group({
      minQuantity: [null as number | null, [Validators.required, Validators.min(1)]],
      unitPrice: [null as number | null, [Validators.required, Validators.min(0)]],
      effectiveFrom: [new Date(), [Validators.required]],
    });
    form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formsTicker.update(n => n + 1);
    });
    return { slotId, kind: 'empty', form };
  }

  /**
   * Fires on every input bubbling out of a tier slot's TR. For empty
   * slots with user content, promote in place: flip the slot's kind to
   * 'pending', assign a tempId, and append a brand-new empty slot
   * below. The slotId stays stable so Angular's @for trackBy keeps the
   * SAME TR DOM — the user's focused input element survives + their
   * keystrokes continue going into the same form. Subsequent input
   * events on the now-pending slot bail at the kind check.
   */
  protected onSlotInput(vpId: number, slot: TierSlot): void {
    if (slot.kind !== 'empty') return;
    const v = slot.form.getRawValue();
    const hasUserContent = (v.minQuantity != null && v.minQuantity !== '') ||
                           (v.unitPrice != null && v.unitPrice !== '');
    if (!hasUserContent) return;

    // Mutate the slot in place; same slotId + same form ref.
    const tempId = `pending-${++this.nextPendingTierIndex}`;
    slot.kind = 'pending';
    slot.tempId = tempId;
    // Mirror the form into tierForms so the existing pendingTiers /
    // findVpIdForPendingForm helpers + onSaveAll can find it by
    // (vpId, tempId) without changing.
    this.tierForms.set(this.tierKey(vpId, tempId), slot.form);

    // Append a NEW empty slot. Cloning the array into a new ref is
    // what triggers the @for re-render — the slot mutation alone
    // wouldn't be picked up since the array ref didn't change.
    const newEmpty = this.makeEmptySlot();
    const map = new Map(this.tierSlotsByVp());
    const slots = [...(map.get(vpId) ?? [slot]), newEmpty];
    map.set(vpId, slots);
    this.tierSlotsByVp.set(map);

    // Green-glow fade-out on the NEW empty slot below — visual
    // confirmation that "your previous entry was captured, here's a
    // fresh row." Drops out after the CSS animation duration.
    const glowSet = new Set(this.justAddedSlotIds());
    glowSet.add(newEmpty.slotId);
    this.justAddedSlotIds.set(glowSet);
    setTimeout(() => {
      const cleared = new Set(this.justAddedSlotIds());
      cleared.delete(newEmpty.slotId);
      this.justAddedSlotIds.set(cleared);
    }, 1200);

    this.formsTicker.update(n => n + 1);
  }

  /**
   * Save-time sweep: any empty slot with user content the user typed
   * but never tabbed out of also gets promoted. Belt-and-suspenders so
   * onSaveAll never silently drops in-flight values.
   */
  private flushEmptyRowsBeforeSave(): void {
    for (const [vpId, slots] of this.tierSlotsByVp().entries()) {
      const trailing = slots[slots.length - 1];
      if (trailing && trailing.kind === 'empty') {
        this.onSlotInput(vpId, trailing);
      }
    }
  }

  /** Drop a pending tier without saving — the user clicked its trash. */
  protected removePendingTier(vpId: number, tempId: string): void {
    const map = new Map(this.tierSlotsByVp());
    const slots = (map.get(vpId) ?? []).filter(s => s.tempId !== tempId);
    map.set(vpId, slots);
    this.tierSlotsByVp.set(map);
    this.tierForms.delete(this.tierKey(vpId, tempId));
    this.formsTicker.update(n => n + 1);
  }

  /** Discard all pending tiers + pending deletes — used by Cancel. */
  private clearPendingTiers(): void {
    this.pendingDeletesByVp.set(new Map());
    for (const [vpId, slots] of this.tierSlotsByVp().entries()) {
      for (const s of slots) {
        if (s.kind === 'pending' && s.tempId) {
          this.tierForms.delete(this.tierKey(vpId, s.tempId));
        }
      }
    }
    this.tierSlotsByVp.set(new Map());
    this.formsTicker.update(n => n + 1);
  }

  private findVpIdForPendingForm(form: FormGroup): number | null {
    for (const [vpId, slots] of this.tierSlotsByVp().entries()) {
      if (slots.some(s => s.form === form)) return vpId;
    }
    return null;
  }

  /** Reload tiers — pulls history when the toggle is on. */
  private reload(partId: number): void {
    this.loading.set(true);
    this.vendorPartsService.listForPart(partId, this.showTierHistory()).subscribe({
      next: (list) => {
        this.vendorParts.set(list);
        this.seedExistingTierForms();
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Direct removeTier server-call path retired 2026-05-06: tier deletes
  // batch with the panel Save now. See markTierForDelete /
  // unmarkTierForDelete + the Phase 3 pending-deletes flush in onSaveAll.

  // ─── Row-level actions ──────────────────────────────────────────────
  protected setAsPreferred(vp: VendorPart): void {
    const partId = this.partId();
    if (partId == null) return;
    // Server enforces single-preferred uniqueness — flipping isPreferred
    // on this row clears it on every other row for the same part within
    // one SaveChanges (per backend invariant).
    this.vendorPartsService.update(vp.id, { isPreferred: true }).subscribe({
      next: () => {
        this.preferredVendorChanged.emit(vp.vendorId);
        this.load(partId);
        this.changed.emit();
      },
    });
  }

  protected removeRow(vp: VendorPart): void {
    const partId = this.partId();
    if (partId == null) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: this.translate.instant('vendorSources.removeRow.confirmTitle'),
        message: this.translate.instant('vendorSources.removeRow.confirmMessage', { vendor: vp.vendorCompanyName }),
        confirmLabel: this.translate.instant('common.remove'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.vendorPartsService.delete(vp.id).subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('vendorSources.removed'));
          this.load(partId);
          this.changed.emit();
        },
      });
    });
  }

  // ─── Add-vendor flow ────────────────────────────────────────────────
  protected startAddVendor(): void {
    this.addingVendor.set(true);
  }

  protected cancelAddVendor(): void {
    this.addingVendor.set(false);
    this.addVendorControl.setValue(null, { emitEvent: false });
  }

  /**
   * Picker emits the selected vendor id. We immediately POST a
   * VendorPart row (with no fields filled — they'll fill inline)
   * and exit add-mode.
   */
  protected onVendorSelected(vendorId: unknown): void {
    if (typeof vendorId !== 'number') return;
    const partId = this.partId();
    if (partId == null) return;
    // Reject duplicate — server would 409 anyway, give friendlier message.
    if (this.vendorParts().some(v => v.vendorId === vendorId)) {
      this.snackbar.error(this.translate.instant('vendorSources.duplicate'));
      return;
    }
    this.vendorPartsService.create({ vendorId, partId, isPreferred: false }).subscribe({
      next: () => {
        this.addingVendor.set(false);
        this.addVendorControl.setValue(null, { emitEvent: false });
        this.load(partId);
        this.changed.emit();
      },
      error: () => this.snackbar.error(this.translate.instant('vendorSources.saveFailed')),
    });
  }

  /** Inline-create-vendor — same as the rest of the app's pickers. */
  protected onCreateNewVendor(typedTerm: string): void {
    this.dialog.open<
      VendorQuickCreateDialogComponent,
      VendorQuickCreateDialogData,
      VendorListItem | null
    >(VendorQuickCreateDialogComponent, {
      width: '420px',
      data: { initialCompanyName: typedTerm },
    }).afterClosed().subscribe((created) => {
      if (!created) return;
      // Fall through to the same code path as picking an existing vendor.
      this.onVendorSelected(created.id);
    });
  }

  // ─── Panel-level Save / Cancel ──────────────────────────────────────
  /**
   * Flush every dirty per-row form, then signal the parent to exit edit
   * mode. Most fields are already saved by the on-blur handler; this
   * catches the field the user is still focused on (no blur yet) and
   * acts as a visible "I'm done" affordance — the lack of one was the
   * top user complaint about this panel.
   */
  protected onSaveAll(): void {
    // Catch any empty-row values the user typed but never tabbed out of
    // before clicking Save. Promotes them into pendingTiersByVp so
    // Phase 2 picks them up. Without this sweep, in-flight typing is
    // silently dropped on Save.
    this.flushEmptyRowsBeforeSave();

    // Two-phase orchestration so price tiers entered against the
    // preferred-vendor stub (or any other not-yet-materialized row)
    // can land under their REAL vp.id after the create() POST completes.
    //
    // Phase 1: every dirty row form. saveRow$ for the stub returns the
    //   newly-created VendorPart and (via adoptStubMaterializedRow)
    //   re-keys STUB_ID-prefixed pending tiers + tier forms under the
    //   real id. PATCH calls for already-materialized rows just emit
    //   the unchanged row.
    //
    // Phase 2: every pending tier across all vendors. By the time we
    //   reach Phase 2, no STUB_ID-keyed pending tiers exist (the stub
    //   re-key in Phase 1 promoted them to the real id, or there was
    //   no stub to begin with). POSTs run in parallel via forkJoin.
    //
    // forkJoin waits for ALL inner observables to complete (or any to
    // error) before emitting. After both phases land, we reload, clear
    // local pending state, and exit edit mode.
    const partId = this.partId();

    const rowSaves: Observable<VendorPart | null>[] = [];
    for (const [key, form] of this.rowForms.entries()) {
      if (!form.dirty || form.invalid) continue;
      const row = key === this.STUB_ID
        ? null
        : (this.vendorParts().find(v => v.id === key) ?? null);
      rowSaves.push(this.saveRow$(row));
    }

    const phase1$ = rowSaves.length > 0 ? forkJoin(rowSaves) : of([]);

    phase1$.subscribe({
      next: () => {
        // Phase 2 — flush every batched tier mutation in parallel:
        //   • pending inserts (new tiers the user typed)
        //   • dirty existing-tier edits (SCD Type 2 supersede via the
        //     same addPriceTier endpoint — server marks the old row
        //     superseded and inserts the new effective row)
        //   • pending deletes (tiers the user clicked the trash on,
        //     queued via markTierForDelete)
        const tierSaves: Observable<unknown>[] = [];

        const slotsMap = this.tierSlotsByVp();
        for (const [vpId, slots] of slotsMap.entries()) {
          if (vpId === this.STUB_ID) continue; // shouldn't happen post-Phase-1; defensive
          for (const s of slots) {
            if (s.kind !== 'pending' || !s.tempId) continue;
            if (s.form.invalid) continue;
            const v = s.form.getRawValue();
            const tempId = s.tempId;
            tierSaves.push(
              this.vendorPartsService.addPriceTier(vpId, {
                minQuantity: v.minQuantity!,
                unitPrice: v.unitPrice!,
                // toIsoDate sends midnight-UTC of the picked LOCAL date
                // (YYYY-MM-DDT00:00:00Z). Plain .toISOString() would
                // send midnight-LOCAL converted to UTC, which lands
                // hours in the future for negative-UTC timezones — and
                // the server's "currently effective" filter
                // (effective_from <= now) would then exclude the just-
                // created active tier from non-history queries.
                effectiveFrom: toIsoDate(v.effectiveFrom),
              }).pipe(
                tap(() => this.tierForms.delete(this.tierKey(vpId, tempId))),
              ),
            );
          }
        }

        // Dirty existing-tier forms — supersede via addPriceTier.
        const deletesMap = this.pendingDeletesByVp();
        for (const vp of this.vendorParts()) {
          const deletes = deletesMap.get(vp.id);
          for (const tier of (vp.priceTiers ?? [])) {
            if (tier.effectiveTo) continue;
            if (deletes?.has(tier.id)) continue;
            const form = this.tierForms.get(this.tierKey(vp.id, tier.id));
            if (!form || !form.dirty || form.invalid) continue;
            const v = form.getRawValue();
            tierSaves.push(
              this.vendorPartsService.addPriceTier(vp.id, {
                minQuantity: v.minQuantity!,
                unitPrice: v.unitPrice!,
                // toIsoDate sends midnight-UTC of the picked LOCAL date
                // (YYYY-MM-DDT00:00:00Z). Plain .toISOString() would
                // send midnight-LOCAL converted to UTC, which lands
                // hours in the future for negative-UTC timezones — and
                // the server's "currently effective" filter
                // (effective_from <= now) would then exclude the just-
                // created active tier from non-history queries.
                effectiveFrom: toIsoDate(v.effectiveFrom),
              }),
            );
          }
        }

        // Pending deletes.
        for (const [vpId, set] of deletesMap.entries()) {
          for (const tierId of set) {
            tierSaves.push(this.vendorPartsService.deletePriceTier(vpId, tierId));
          }
        }

        const phase2$ = tierSaves.length > 0 ? forkJoin(tierSaves) : of([]);
        phase2$.subscribe({
          next: () => {
            this.tierSlotsByVp.set(new Map());
            this.pendingDeletesByVp.set(new Map());
            this.formsTicker.update(n => n + 1);
            if (partId != null) this.reload(partId);
            this.changed.emit();
            this.cancelled.emit();
          },
          error: () => {
            this.snackbar.error(this.translate.instant('vendorSources.tierSaveFailed'));
            // Even on tier-save failure, the rows are saved — reload so
            // the UI matches server state, but DON'T clear the pending
            // list so the user sees what didn't land.
            if (partId != null) this.reload(partId);
            this.changed.emit();
          },
        });
      },
      error: () => {
        // Row-save failed; saveRow$ already toasted. Don't proceed to
        // tier inserts — leave the panel open so the user can retry.
      },
    });
  }

  /**
   * Discard any in-progress field edits + every pending new tier (which
   * never round-tripped the server) by reloading from the source of
   * truth and clearing the pending list, then signal the parent to exit
   * edit mode.
   */
  protected onCancel(): void {
    this.clearPendingTiers();
    // Drop every existing-tier form (numeric tierId keys) so the reload
    // re-seeds them pristine. seedExistingTierForms preserves dirty
    // forms by design (so a passive reload doesn't clobber in-progress
    // edits) — Cancel is the explicit "throw those away" path.
    for (const key of [...this.tierForms.keys()]) {
      const colon = key.indexOf(':');
      const tierId = colon < 0 ? key : key.substring(colon + 1);
      if (tierId !== 'new' && !tierId.startsWith('pending-')) {
        this.tierForms.delete(key);
      }
    }
    const id = this.partId();
    if (id != null) this.load(id);
    this.cancelled.emit();
  }

  // ─── Display helpers ────────────────────────────────────────────────
  protected hasNoTiers(vp: VendorPart): boolean {
    return !vp.priceTiers || vp.priceTiers.length === 0;
  }

  /** ISO-4217 → symbol fallback for tier display. */
  protected currencySymbol(code: string): string {
    switch (code) {
      case 'USD':
      case 'CAD':
      case 'MXN': return '$';
      case 'EUR': return '€';
      case 'GBP': return '£';
      case 'JPY':
      case 'CNY': return '¥';
      default: return code + ' ';
    }
  }
}

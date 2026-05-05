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
import { firstValueFrom } from 'rxjs';
import { DestroyRef } from '@angular/core';
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
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { VendorListItem } from '../../../vendors/models/vendor-list-item.model';
import { VendorQuickCreateDialogComponent, VendorQuickCreateDialogData } from '../../../vendors/components/vendor-quick-create-dialog/vendor-quick-create-dialog.component';
import { VendorPart, VendorPartPriceTier } from '../../models/vendor-part.model';
import { VendorPartsService } from '../../services/vendor-parts.service';

/**
 * Pending tier change held in client state until the modal-level Save
 * flushes the batch to the server. Pattern A — single save on the page,
 * no per-row save buttons. See vendor-sources-panel.component.ts for the
 * full editing-model rationale.
 */
type TierValues = {
  minQuantity: number;
  unitPrice: number;
  effectiveFrom: Date;
};
type TierMutation =
  | { type: 'add'; vpId: number; tempId: number; values: TierValues }
  | { type: 'edit'; vpId: number; tierId: number; values: TierValues }
  | { type: 'delete'; vpId: number; tierId: number };

/**
 * Row shape for tier rendering — overlays server tier values with any
 * in-flight client-side mutations so the user sees their pending state
 * (struck-through for delete, modified values + indicator for edit, fresh
 * row for add) before committing via the modal Save.
 */
export type TierViewRow = VendorPartPriceTier & {
  _pendingAdd?: boolean;
  _pendingEdit?: boolean;
  _pendingDelete?: boolean;
};

/**
 * Row shape for the cross-vendor "Pricing" view — one row per tier
 * across every source. Carries the vendor identity inline so the table
 * is self-contained.
 */
export type FlatTierRow = {
  tierId: number;
  vendorPartId: number;
  vendorCompanyName: string;
  isPreferred: boolean;
  minQuantity: number;
  unitPrice: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

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
    EmptyStateComponent, LoadingBlockDirective,
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
   * Which EXISTING tier is currently in cell-edit mode (only one row at
   * a time — Pattern A: single-row edit). Keyed by `${vendorPartId}:${tierId}`.
   * Clicking a cell on another row commits the previous row's edits to
   * local pending state and opens the new row for edit.
   */
  protected readonly editingTierKey = signal<string | null>(null);

  /**
   * Pending tier mutations held in client state. The modal-level Save
   * (onSaveAll) flushes all of these to the server in one batch; Cancel
   * discards them. No per-row Save button — the only commit affordance
   * is the modal-level Save (Pattern A: single save on the page).
   *
   * - `add`: a new tier the user typed into the empty bottom form
   * - `edit`: changes to an existing tier (server supersedes via SCD-2)
   * - `delete`: existing tier marked for soft-close
   *
   * `tempId` on adds is a session-local counter so multiple new tiers
   * keep distinct keys; resolved server-side at flush time.
   */
  protected readonly pendingMutations = signal<TierMutation[]>([]);
  private nextTempId = 1;

  /**
   * The tier-row key that just appeared (newly committed to local state)
   * — drives the 1000ms green-border-fade animation that confirms the
   * commit and signals "you can keep adding."
   */
  protected readonly justSavedKey = signal<string | null>(null);

  /** "Show history" toggle — when true the tier list returns superseded rows too. */
  protected readonly showTierHistory = signal(false);

  // ─── Stage 2: detail disclosure (Pattern C with B toggle) ───────────
  /**
   * View mode for the source list:
   *  - 'inspector' (default, Pattern C): cards collapsed to header +
   *    summary + tier table; full per-source details shown in a
   *    right-side property inspector for the selected card.
   *  - 'compare' (Pattern B, on demand): cards stacked with summary line
   *    each; click an "Show details" affordance per card to accordion-
   *    expand its full details inline. Better for side-by-side scanning.
   *  - 'pricing': flat cross-vendor table — one row per tier across
   *    every source. Columns: Vendor | Min Qty | Unit Price | Effective
   *    From. Sorted by min qty asc then vendor name. Same showHistory
   *    toggle applies (superseded rows greyed-out when on). Best for
   *    "where can I get this part cheapest at qty N?" comparisons.
   */
  protected readonly viewMode = signal<'inspector' | 'compare' | 'pricing'>('inspector');

  /** Which source card's details show in the right inspector pane. */
  protected readonly selectedSourceId = signal<number | null>(null);

  /** In compare mode, which cards have their details accordion expanded. */
  protected readonly expandedDetailIds = signal<Set<number>>(new Set());

  /** Resolves the selected source object for the inspector pane. */
  protected readonly selectedSource = computed<VendorPart | null>(() => {
    const id = this.selectedSourceId();
    if (id == null) return null;
    return this.vendorParts().find(v => v.id === id) ?? null;
  });

  /**
   * Flat list of every tier across every vendor source on this part —
   * powers the "Pricing" view. Sorted by min_qty asc, then vendor name
   * (alphabetical) within each min_qty bracket so the user reads down
   * "at qty N, here's everyone." Respects the showTierHistory toggle:
   * superseded rows appear (greyed by template class) only when on.
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

    // Inspector mode: auto-select the preferred (or first) source when
    // nothing is selected and sources are present. Single-source case
    // never makes the user click — the inspector pane just shows it.
    effect(() => {
      if (this.viewMode() !== 'inspector') return;
      if (this.selectedSourceId() != null) return;
      const rows = this.sortedRows();
      if (rows.length === 0) return;
      const preferred = rows.find(r => r.isPreferred);
      this.selectedSourceId.set((preferred ?? rows[0]).id);
    });
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
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // ─── Per-row form access (created lazily) ───────────────────────────
  /** Stub key for the preferred-vendor-no-row-yet group. */
  protected readonly STUB_ID = -1;

  /** Returns the form for a row, creating it if first access. */
  protected formFor(row: VendorPart | null): FormGroup {
    const key = row?.id ?? this.STUB_ID;
    let form = this.rowForms.get(key);
    if (!form) {
      form = this.fb.group({
        vendorPartNumber: [row?.vendorPartNumber ?? '', [Validators.maxLength(100)]],
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
      this.rowForms.set(key, form);
    }
    return form;
  }

  /** Compose the tierForms key — one form per (vendorPart, tier) edit slot. */
  protected tierKey(vpId: number, tierId: number | 'new'): string {
    return `${vpId}:${tierId}`;
  }

  /**
   * Lazy-create form for editing a tier OR for the empty bottom row
   * ('new'). Existing-tier forms get pre-populated from the live values
   * via {@link startEditTier}; the 'new' form starts blank with
   * effectiveFrom defaulted to today so the user only has to type qty +
   * price before committing.
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

  /**
   * Tiers visible in the table for one vendor source. Overlays the live
   * server-side rows with any in-flight client-side mutations:
   *  - server rows whose ids appear in pending deletes get
   *    `_pendingDelete = true` so the row renders struck-through
   *  - server rows whose ids appear in pending edits get their values
   *    swapped with the pending values + `_pendingEdit = true`
   *  - pending adds (no server id yet) are appended as fresh rows
   *    with negative `id = -tempId` so trackBy keys stay stable
   *
   * The empty bottom row (the always-visible "type to add" form) is NOT
   * part of this list — it's rendered separately in the template so it
   * can hold its own form-bound inputs.
   */
  protected visibleTiers(row: VendorPart): TierViewRow[] {
    const baseline = (row.priceTiers ?? []).filter(t =>
      this.showTierHistory() || !t.effectiveTo);
    const muts = this.pendingMutations().filter(m => 'vpId' in m && m.vpId === row.id);
    const deletes = new Set<number>(
      muts.filter((m): m is Extract<TierMutation, { type: 'delete' }> => m.type === 'delete')
        .map(m => m.tierId));
    const edits = new Map<number, TierValues>(
      muts.filter((m): m is Extract<TierMutation, { type: 'edit' }> => m.type === 'edit')
        .map(m => [m.tierId, m.values]));
    const adds = muts.filter((m): m is Extract<TierMutation, { type: 'add' }> => m.type === 'add');

    const overlaid: TierViewRow[] = baseline.map(t => {
      const edit = edits.get(t.id);
      return {
        ...t,
        minQuantity: edit?.minQuantity ?? t.minQuantity,
        unitPrice: edit?.unitPrice ?? t.unitPrice,
        effectiveFrom: edit ? edit.effectiveFrom.toISOString() : t.effectiveFrom,
        _pendingDelete: deletes.has(t.id),
        _pendingEdit: !!edit,
      };
    });
    const newRows: TierViewRow[] = adds.map(a => ({
      id: -a.tempId,
      vendorPartId: a.vpId,
      minQuantity: a.values.minQuantity,
      unitPrice: a.values.unitPrice,
      currency: row.currency,
      effectiveFrom: a.values.effectiveFrom.toISOString(),
      effectiveTo: null,
      notes: null,
      _pendingAdd: true,
    }));
    return [...overlaid, ...newRows];
  }

  // ─── Save-on-blur for 1:1 fields ────────────────────────────────────
  /**
   * Called from blur events on any per-row field. For real rows: PATCHes
   * the row with the form's current values if dirty. For the stub row
   * (preferred vendor with no VendorPart yet): creates the row first via
   * POST, then continues editing.
   */
  protected saveRow(row: VendorPart | null): void {
    const partId = this.partId();
    if (partId == null) return;
    const form = this.formFor(row);
    if (!form.dirty || form.invalid) return;
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
      lastQuotedDate: v.lastQuotedDate ? new Date(v.lastQuotedDate).toISOString().slice(0, 10) : null,
      notes: v.notes || null,
      currency: v.currency || 'USD',
    };

    if (!row) {
      // Stub: materialize with the preferred vendor + this part.
      const vendorId = this.preferredVendorId();
      if (vendorId == null) return;
      this.vendorPartsService.create({
        vendorId, partId, isPreferred: true, ...payload,
      }).subscribe({
        next: (created) => {
          // Move the stub form's key to the real id so subsequent edits
          // attach to the right row.
          this.rowForms.delete(this.STUB_ID);
          form.markAsPristine();
          this.rowForms.set(created.id, form);
          this.load(partId);
          this.changed.emit();
        },
        error: () => this.snackbar.error(this.translate.instant('vendorSources.saveFailed')),
      });
    } else {
      this.vendorPartsService.update(row.id, payload).subscribe({
        next: () => {
          form.markAsPristine();
          // No reload — local state is the truth, server confirmed.
          this.changed.emit();
        },
        error: () => this.snackbar.error(this.translate.instant('vendorSources.saveFailed')),
      });
    }
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
   * Click a cell on an existing tier row → enter cell-edit mode for
   * that row. Per Pattern A (single-row edit), if another row is already
   * in edit, commit its in-flight values to local pending state first.
   */
  protected startEditTier(vpId: number, tier: TierViewRow): void {
    if (tier._pendingDelete || tier.effectiveTo) return; // can't edit deleted or superseded
    const previousKey = this.editingTierKey();
    if (previousKey) this.commitOpenEditToLocal(previousKey);
    const key = this.tierKey(vpId, tier.id);
    this.tierForms.delete(key);
    const form = this.tierFormFor(vpId, tier.id);
    form.patchValue({
      minQuantity: tier.minQuantity,
      unitPrice: tier.unitPrice,
      effectiveFrom: new Date(tier.effectiveFrom),
    });
    this.editingTierKey.set(key);
  }

  /**
   * Esc / explicit cancel — drop the in-flight form, exit edit mode.
   * Does NOT touch any previously committed pending mutations.
   */
  protected cancelEditTier(): void {
    const key = this.editingTierKey();
    if (key) this.tierForms.delete(key);
    this.editingTierKey.set(null);
  }

  /**
   * Internal: take the values from a row currently in edit mode and
   * push them onto pendingMutations (as an 'edit'). For a positive
   * tier id this becomes a server-side supersede on flush; for a
   * negative id (a pending-add row) it re-overrides the existing add.
   * No-op if the form is invalid.
   */
  private commitOpenEditToLocal(key: string): void {
    const form = this.tierForms.get(key);
    if (!form || form.invalid) return;
    const [vpStr, tierStr] = key.split(':');
    const vpId = parseInt(vpStr, 10);
    const tierId = parseInt(tierStr, 10);
    const v = form.getRawValue();
    const values: TierValues = {
      minQuantity: v.minQuantity!,
      unitPrice: v.unitPrice!,
      effectiveFrom: v.effectiveFrom ? new Date(v.effectiveFrom) : new Date(),
    };
    this.upsertEditMutation(vpId, tierId, values);
    this.tierForms.delete(key);
    this.editingTierKey.set(null);
  }

  /**
   * Called from the empty-bottom-row form when the user has typed values
   * and clicks elsewhere or commits via Save. Pushes a fresh 'add'
   * mutation, resets the form to empty, and pulses the just-added row
   * green so the user sees confirmation.
   */
  protected commitNewTierFromEmptyForm(vpId: number): void {
    const form = this.tierFormFor(vpId, 'new');
    if (form.invalid) return;
    const v = form.getRawValue();
    if (v.minQuantity == null && v.unitPrice == null) return; // empty — nothing to add
    if (form.invalid) return;
    const tempId = this.nextTempId++;
    const values: TierValues = {
      minQuantity: v.minQuantity!,
      unitPrice: v.unitPrice!,
      effectiveFrom: v.effectiveFrom ? new Date(v.effectiveFrom) : new Date(),
    };
    this.pendingMutations.update(list => [
      ...list,
      { type: 'add', vpId, tempId, values },
    ]);
    // Reset the empty form so it's ready for the next entry.
    form.reset({ minQuantity: null, unitPrice: null, effectiveFrom: new Date() });
    // Pulse the just-added row green.
    const newKey = `${vpId}:add-${tempId}`;
    this.justSavedKey.set(newKey);
    setTimeout(() => {
      if (this.justSavedKey() === newKey) this.justSavedKey.set(null);
    }, 1000);
  }

  /** Track-by key for tier rows in the table — handles both real and pending. */
  protected tierTrackBy(_idx: number, t: TierViewRow): string {
    if (t._pendingAdd) return `add-${t.id}`;
    return `id-${t.id}`;
  }

  /**
   * focusout handler on the empty bottom row — commits the form to
   * pending state ONLY when focus is leaving the row entirely. Tabbing
   * between cells inside the same row keeps the user "still entering
   * this row" so we don't commit mid-entry.
   */
  protected onEmptyRowFocusOut(event: FocusEvent, vpId: number): void {
    const row = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as HTMLElement | null;
    if (row && next && row.contains(next)) return;
    this.commitNewTierFromEmptyForm(vpId);
  }

  /** Replace any prior 'edit' for this tier with the new values. */
  private upsertEditMutation(vpId: number, tierId: number, values: TierValues): void {
    this.pendingMutations.update(list => {
      // For pending adds (negative id), update the matching add in place.
      if (tierId < 0) {
        const tempId = -tierId;
        return list.map(m =>
          m.type === 'add' && m.vpId === vpId && m.tempId === tempId
            ? { ...m, values }
            : m);
      }
      const filtered = list.filter(m =>
        !(m.type === 'edit' && m.vpId === vpId && m.tierId === tierId));
      return [...filtered, { type: 'edit', vpId, tierId, values }];
    });
  }

  /**
   * Mark a tier for deletion in local pending state. Toggle: if the tier
   * is already pending-delete, un-delete it. Confirmed only at modal
   * Save time.
   */
  protected removeTier(vp: VendorPart, tier: TierViewRow): void {
    if (tier._pendingAdd) {
      // Drop the unsaved add entirely.
      const tempId = -tier.id;
      this.pendingMutations.update(list => list.filter(m =>
        !(m.type === 'add' && m.vpId === vp.id && m.tempId === tempId)));
      return;
    }
    if (tier._pendingDelete) {
      // Toggle off — un-delete.
      this.pendingMutations.update(list => list.filter(m =>
        !(m.type === 'delete' && m.vpId === vp.id && m.tierId === tier.id)));
      return;
    }
    this.pendingMutations.update(list => [
      ...list,
      { type: 'delete', vpId: vp.id, tierId: tier.id },
    ]);
  }

  /** Reload tiers — pulls history when the toggle is on. */
  private reload(partId: number): void {
    this.loading.set(true);
    this.vendorPartsService.listForPart(partId, this.showTierHistory()).subscribe({
      next: (list) => {
        this.vendorParts.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

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
   * THE only commit affordance — Pattern A (single save on the page).
   * Fold any open in-flight tier edit + the empty-form's pending values
   * into local pending state, flush:
   *   1. dirty per-row 1:1 fields (vendorPartNumber, lead time, etc.)
   *   2. pending tier mutations (deletes first, then adds, then edits)
   * Then signal the parent to exit edit mode.
   */
  protected onSaveAll(): void {
    const partId = this.partId();
    if (partId == null) {
      this.cancelled.emit();
      return;
    }

    // Sweep open in-flight tier edit into local mutations.
    const openKey = this.editingTierKey();
    if (openKey) this.commitOpenEditToLocal(openKey);

    // Sweep any typed-but-uncommitted values from each row's empty form.
    for (const row of this.vendorParts()) {
      this.commitNewTierFromEmptyForm(row.id);
    }

    // Commit per-row 1:1 field edits via the existing per-row save path
    // (saveRow handles its own dirty check + immediate PATCH).
    for (const [key, form] of this.rowForms.entries()) {
      if (!form.dirty || form.invalid) continue;
      const row = key === this.STUB_ID
        ? null
        : (this.vendorParts().find(v => v.id === key) ?? null);
      this.saveRow(row);
    }

    // Flush pending tier mutations to the server. Deletes first (so a
    // subsequent add at the same min_qty gets a clean SCD-2 supersede
    // path on the next read), then adds + edits (server's upsert path
    // handles supersede semantics for edits transparently).
    const muts = this.pendingMutations();
    const calls: Promise<unknown>[] = [];
    for (const m of muts) {
      if (m.type === 'delete') {
        calls.push(firstValueFrom(this.vendorPartsService.deletePriceTier(m.vpId, m.tierId)));
      }
    }
    for (const m of muts) {
      if (m.type === 'add' || m.type === 'edit') {
        calls.push(firstValueFrom(this.vendorPartsService.addPriceTier(m.vpId, {
          minQuantity: m.values.minQuantity,
          unitPrice: m.values.unitPrice,
          effectiveFrom: m.values.effectiveFrom.toISOString(),
        })));
      }
    }

    Promise.all(calls)
      .then(() => {
        this.pendingMutations.set([]);
        this.changed.emit();
        this.cancelled.emit();
      })
      .catch(() => this.snackbar.error(this.translate.instant('vendorSources.tierSaveFailed')));
  }

  /**
   * Discard any pending tier mutations + any in-flight 1:1 field edits
   * (reload from server) and signal the parent to exit edit mode.
   */
  protected onCancel(): void {
    this.pendingMutations.set([]);
    this.editingTierKey.set(null);
    this.tierForms.clear();
    const id = this.partId();
    if (id != null) this.load(id);
    this.cancelled.emit();
  }

  // ─── Display helpers ────────────────────────────────────────────────
  protected hasNoTiers(vp: VendorPart): boolean {
    return !vp.priceTiers || vp.priceTiers.length === 0;
  }

  /** Inspector mode: select a source card → its details fill the right pane. */
  protected selectSource(id: number): void {
    // Toggle: clicking the already-selected card un-selects.
    this.selectedSourceId.update(prev => prev === id ? null : id);
  }

  /** Compare mode: toggle the per-card accordion that reveals full details. */
  protected toggleDetails(id: number): void {
    this.expandedDetailIds.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected isExpanded(id: number): boolean {
    return this.expandedDetailIds().has(id);
  }

  /**
   * One-line summary of supplementary fields for the source-card header.
   * Used by both inspector + compare modes — surfaces the most-glanced
   * source attributes (lead time, MOQ, country) without expanding the
   * full details. Skips empty fields gracefully.
   */
  protected summary(row: VendorPart): string {
    const bits: string[] = [];
    if (row.leadTimeDays != null) bits.push(`Lead ${row.leadTimeDays}d`);
    if (row.minOrderQty != null) bits.push(`MOQ ${row.minOrderQty}`);
    if (row.countryOfOrigin) bits.push(row.countryOfOrigin);
    if (row.priceTiers && row.priceTiers.filter(t => !t.effectiveTo).length > 0) {
      const n = row.priceTiers.filter(t => !t.effectiveTo).length;
      bits.push(`${n} tier${n === 1 ? '' : 's'}`);
    }
    return bits.join(' · ');
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

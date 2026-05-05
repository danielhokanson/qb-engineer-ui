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
   * Which existing tier is currently in cell-edit mode, keyed by
   * `${vendorPartId}:${tierId}` (or `${vendorPartId}:new` for the always-
   * present empty bottom row, but that's never set here — the empty row
   * is implicitly always editable). Null means no existing tier is open
   * for editing.
   */
  protected readonly editingTierKey = signal<string | null>(null);

  /**
   * The tier-row key that just successfully saved — drives the 1000ms
   * green-border-fade animation that confirms the save and signals
   * "you can keep typing." Cleared after the animation timeout.
   */
  protected readonly justSavedKey = signal<string | null>(null);

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

  /** Tiers visible in the table — currently effective always; superseded only when toggle is on. */
  protected visibleTiers(row: VendorPart): VendorPartPriceTier[] {
    const all = row.priceTiers ?? [];
    if (this.showTierHistory()) return all;
    return all.filter(t => !t.effectiveTo);
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

  /** Switch an existing tier row into cell-edit mode and seed its form. */
  protected startEditTier(vpId: number, tier: VendorPartPriceTier): void {
    const key = this.tierKey(vpId, tier.id);
    // Drop any stale form so we re-seed from current data.
    this.tierForms.delete(key);
    const form = this.tierFormFor(vpId, tier.id);
    form.patchValue({
      minQuantity: tier.minQuantity,
      unitPrice: tier.unitPrice,
      effectiveFrom: new Date(tier.effectiveFrom),
    });
    this.editingTierKey.set(key);
  }

  /** Cancel without saving — form discarded so next open re-seeds clean. */
  protected cancelEditTier(): void {
    const key = this.editingTierKey();
    if (key) this.tierForms.delete(key);
    this.editingTierKey.set(null);
  }

  /**
   * Commit the form values for either an existing tier (server supersedes
   * the old row) or the empty bottom row (server inserts new). On
   * success, animate the next empty row in with the green-border pulse.
   */
  protected commitTier(vpId: number, tierId: number | 'new'): void {
    const partId = this.partId();
    if (partId == null) return;
    const key = this.tierKey(vpId, tierId);
    const form = this.tierFormFor(vpId, tierId);
    if (form.invalid) return;
    const v = form.getRawValue();
    this.vendorPartsService.addPriceTier(vpId, {
      minQuantity: v.minQuantity!,
      unitPrice: v.unitPrice!,
      effectiveFrom: v.effectiveFrom
        ? new Date(v.effectiveFrom).toISOString()
        : null,
    }).subscribe({
      next: () => {
        this.tierForms.delete(key);
        if (tierId !== 'new') this.editingTierKey.set(null);
        // Animate the new bottom row to confirm the save and signal
        // "you can keep typing" — full green border, fade to default.
        const newKey = this.tierKey(vpId, 'new');
        this.justSavedKey.set(newKey);
        setTimeout(() => {
          if (this.justSavedKey() === newKey) this.justSavedKey.set(null);
        }, 1000);
        this.reload(partId);
        this.changed.emit();
      },
      error: () => this.snackbar.error(this.translate.instant('vendorSources.tierSaveFailed')),
    });
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

  protected removeTier(vp: VendorPart, tier: VendorPartPriceTier): void {
    const partId = this.partId();
    if (partId == null) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('vendorSources.removeTier.confirmTitle'),
        message: this.translate.instant('vendorSources.removeTier.confirmMessage'),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.vendorPartsService.deletePriceTier(vp.id, tier.id).subscribe({
        next: () => {
          this.load(partId);
          this.changed.emit();
        },
      });
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
   * Flush every dirty per-row form, then signal the parent to exit edit
   * mode. Most fields are already saved by the on-blur handler; this
   * catches the field the user is still focused on (no blur yet) and
   * acts as a visible "I'm done" affordance — the lack of one was the
   * top user complaint about this panel.
   */
  protected onSaveAll(): void {
    for (const [key, form] of this.rowForms.entries()) {
      if (!form.dirty || form.invalid) continue;
      const row = key === this.STUB_ID
        ? null
        : (this.vendorParts().find(v => v.id === key) ?? null);
      this.saveRow(row);
    }
    this.cancelled.emit();
  }

  /**
   * Discard any in-progress field edits by reloading from the server
   * (the source of truth — auto-save-on-blur means committed edits
   * are already there) and signal the parent to exit edit mode.
   */
  protected onCancel(): void {
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

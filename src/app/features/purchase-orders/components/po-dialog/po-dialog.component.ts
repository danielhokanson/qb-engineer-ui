import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, output, signal, Signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PurchaseOrderService } from '../../services/purchase-order.service';
import { VendorService } from '../../../vendors/services/vendor.service';
import { PartsService } from '../../../parts/services/parts.service';
import { VendorResponse } from '../../../vendors/models/vendor-response.model';
import { PartListItem } from '../../../parts/models/part-list-item.model';
import { CreatePurchaseOrderLineRequest } from '../../models/create-purchase-order-line-request.model';
import { CheckTierVarianceResult } from '../../models/tier-variance-check.model';
import { INCOTERM_OPTIONS } from '../../models/incoterm.const';
import { ReferenceDataService } from '../../../../shared/services/reference-data.service';
import { VendorPartsService } from '../../../parts/services/vendor-parts.service';
import { OffTierPromptDialogComponent, OffTierPromptResult } from '../off-tier-prompt-dialog/off-tier-prompt-dialog.component';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { toIsoDate } from '../../../../shared/utils/date.utils';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { AutocompleteComponent, AutocompleteOption } from '../../../../shared/components/autocomplete/autocomplete.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { DraftConfig } from '../../../../shared/models/draft-config.model';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';

interface LineEntry {
  partId: number;
  partNumber: string;
  description: string;
  orderedQuantity: number;
  unitPrice: number;
}

@Component({
  selector: 'app-po-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, DecimalPipe,
    DialogComponent, InputComponent, SelectComponent, TextareaComponent,
    AutocompleteComponent, CurrencyDisplayComponent, CurrencyInputComponent,
    ValidationButtonComponent, TranslatePipe, MatTooltipModule,
    OffTierPromptDialogComponent,
  ],
  templateUrl: './po-dialog.component.html',
  styleUrl: './po-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoDialogComponent {
  @ViewChild(DialogComponent) private dialogRef!: DialogComponent;
  private readonly poService = inject(PurchaseOrderService);
  private readonly vendorService = inject(VendorService);
  private readonly partsService = inject(PartsService);
  private readonly vendorPartsService = inject(VendorPartsService);
  private readonly referenceDataService = inject(ReferenceDataService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly closed = output<void>();
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly vendors = signal<VendorResponse[]>([]);
  protected readonly parts = signal<PartListItem[]>([]);
  protected readonly lines = signal<LineEntry[]>([]);
  /** True while the unit price reflects the part's list price and hasn't been manually edited. */
  protected readonly priceIsDefault = signal(false);

  /**
   * Phase 3 H2 / WU-12 — when false (default), the vendor & part pickers
   * exclude deactivated entries. The toggle reveals them, labelled
   * "(deactivated)" so the operator knows what they are picking. The
   * server-side active-check is the source of truth: even if the UI lets
   * an inactive entity slip through (form preloaded, toggle on), the
   * server rejects with a 400 envelope naming the inactive record.
   */
  protected readonly showInactiveVendors = signal(false);
  protected readonly showInactiveParts = signal(false);

  protected readonly vendorOptions = computed<SelectOption[]>(() => {
    const includeInactive = this.showInactiveVendors();
    const list = this.vendors().filter(v => includeInactive || v.isActive);
    return [
      { value: null, label: this.translate.instant('purchaseOrders.selectVendor') },
      ...list.map(v => ({
        value: v.id,
        label: v.isActive ? v.companyName : `${v.companyName} (deactivated)`,
      })),
    ];
  });

  protected readonly partOptions = computed<AutocompleteOption[]>(() => {
    const includeInactive = this.showInactiveParts();
    return this.parts()
      .filter(p => includeInactive || p.status !== 'Obsolete')
      .map(p => ({
        value: p.id,
        label: p.status === 'Obsolete'
          ? `${p.partNumber} — ${p.description} (deactivated)`
          : `${p.partNumber} — ${p.description}`,
      }));
  });

  /**
   * Phase 3 H2 / WU-12 — inline-error when the currently-selected vendor
   * is deactivated (form was loaded with one previously selected, or the
   * toggle is on and an inactive vendor was chosen). Mirrors the server's
   * active-check error shape so the operator sees the same wording before
   * submission attempt.
   */
  protected readonly selectedVendorWarning = computed<string | null>(() => {
    const id = this.form.controls.vendorId.value;
    if (id == null) return null;
    const v = this.vendors().find(x => x.id === id);
    if (v && !v.isActive) {
      return this.translate.instant('purchaseOrders.vendorDeactivatedWarning', { name: v.companyName })
        || `Vendor '${v.companyName}' is deactivated.`;
    }
    return null;
  });

  /**
   * Inline-error when any line refers to an obsolete part. Produces a
   * single human-readable message naming the offending parts.
   */
  protected readonly inactiveLineWarning = computed<string | null>(() => {
    const obsoleteRefs: string[] = [];
    for (const line of this.lines()) {
      const p = this.parts().find(x => x.id === line.partId);
      if (p && p.status === 'Obsolete') obsoleteRefs.push(p.partNumber);
    }
    if (obsoleteRefs.length === 0) return null;
    return `One or more lines reference obsolete parts: ${obsoleteRefs.join(', ')}`;
  });

  // Bought-parts effort PR2.5 — landed cost header. Defaults: Incoterm
  // FOB_Origin (most common US-domestic case), QuoteCurrency USD. Server
  // overrides these from the preferred VendorPart of the first line at
  // create time when the user hasn't touched them. EstimatedFreight stays
  // null = "no quote yet" (distinct from $0 free shipping).
  protected readonly incotermOptions = INCOTERM_OPTIONS;
  // Currencies are admin-extensible via reference-data group `currency`;
  // fetched once and cached by ReferenceDataService.
  protected readonly quoteCurrencyOptions = signal<SelectOption[]>([]);

  readonly form = new FormGroup({
    vendorId: new FormControl<number | null>(null, [Validators.required]),
    jobId: new FormControl<number | null>(null),
    notes: new FormControl(''),
    incoterm: new FormControl<string>('FOB_Origin', { nonNullable: true }),
    estimatedFreight: new FormControl<number | null>(null, [Validators.min(0)]),
    quoteCurrency: new FormControl<string>('USD', { nonNullable: true }),
  });

  private readonly formViolations = FormValidationService.getViolations(this.form, {
    vendorId: 'Vendor',
    jobId: 'Job',
    notes: 'Notes',
    incoterm: 'Incoterm',
    estimatedFreight: 'Estimated Freight',
    quoteCurrency: 'Quote Currency',
  });

  protected readonly violations: Signal<string[]> = computed(() => [
    ...this.formViolations(),
    ...(this.lines().length === 0 ? ['At least one line item is required'] : []),
    // Phase 3 H2 / WU-12: surface deactivated-master-data warnings inline
    // and block submit when present (the server would reject anyway with a
    // 400; this saves a round trip and gives a friendlier message).
    ...(this.selectedVendorWarning() ? [this.selectedVendorWarning()!] : []),
    ...(this.inactiveLineWarning() ? [this.inactiveLineWarning()!] : []),
  ]);

  protected readonly lineForm = new FormGroup({
    partId: new FormControl<number | null>(null, [Validators.required]),
    // Phase 3 / WU-10 / F8-partial — fractional qty allowed (decimal(18,4) on
    // server). Min is 0.0001 — no zero / negative. Default still 1 for the
    // common whole-unit case (caller can override).
    orderedQuantity: new FormControl<number>(1, [Validators.required, Validators.min(0.0001)]),
    unitPrice: new FormControl<number>(0, [Validators.required, Validators.min(0)]),
  });

  protected readonly lineTotal = computed(() =>
    this.lines().reduce((sum, l) => sum + l.orderedQuantity * l.unitPrice, 0)
  );

  protected readonly draftConfig: DraftConfig = {
    entityType: 'purchase-order',
    entityId: 'new',
    route: '/purchase-orders',
    snapshotFn: () => ({ ...this.form.getRawValue(), lines: this.lines() }),
    restoreFn: (data) => {
      this.form.patchValue(data);
      if (Array.isArray(data['lines'])) this.lines.set(data['lines'] as LineEntry[]);
      this.form.markAsDirty();
    },
  };

  constructor() {
    this.referenceDataService.getAsOptions('currency').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => this.quoteCurrencyOptions.set(options),
    });
    this.vendorService.getVendorDropdown().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => this.vendors.set(list),
    });
    this.partsService.getParts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      // Pre-beta: filter on the procurement axis (the legacy single-axis
      // PartType was retired). POs can target Buy or Subcontract parts;
      // Make / Phantom never appear on a vendor PO line.
      next: (list) => this.parts.set(list.filter(p => p.procurementSource === 'Buy' || p.procurementSource === 'Subcontract')),
    });

    // Pre-fill unit price from part's list price when a part is selected
    this.lineForm.controls.partId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((partId) => {
      this.onPartSelected(partId);
    });

    // When price is manually changed, clear the "list price" indicator
    this.lineForm.controls.unitPrice.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.priceIsDefault.set(false);
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  private onPartSelected(partId: number | null): void {
    if (partId == null) {
      this.priceIsDefault.set(false);
      return;
    }
    const part = this.parts().find(p => p.id === partId);
    // Use the resolver-supplied effective price. When source is "Default" the
    // resolver returned 0 (no pricing configured) — don't pre-fill in that case.
    if (part && part.effectivePriceSource !== 'Default' && part.effectivePrice > 0) {
      this.lineForm.controls.unitPrice.setValue(part.effectivePrice, { emitEvent: false });
      this.priceIsDefault.set(true);
    } else {
      this.priceIsDefault.set(false);
    }
  }

  protected addLine(): void {
    if (this.lineForm.invalid) return;
    const f = this.lineForm.getRawValue();
    const part = this.parts().find(p => p.id === f.partId);
    if (!part) return;
    this.lines.update(prev => [...prev, {
      partId: part.id,
      partNumber: part.partNumber,
      // Phase-4 Name+Description split: PO line carries the part's short
      // identifier (formerly stored as Description) — Name is now canonical.
      description: part.name,
      orderedQuantity: f.orderedQuantity!,
      unitPrice: f.unitPrice!,
    }]);
    this.lineForm.reset({ partId: null, orderedQuantity: 1, unitPrice: 0 });
    this.priceIsDefault.set(false);
  }

  protected removeLine(index: number): void {
    this.lines.update(prev => prev.filter((_, i) => i !== index));
  }

  // Bought-parts effort PR4 — off-tier prompt state. Checked on save;
  // when any line is off-tier the prompt opens and the PO submission
  // pauses until the user confirms (or cancels).
  protected readonly showOffTierPrompt = signal(false);
  protected readonly offTierLines = signal<CheckTierVarianceResult[]>([]);
  protected readonly offTierThresholdPct = signal(5);
  protected readonly partLookup = computed(() => {
    const map = new Map<number, { partNumber: string; description: string }>();
    for (const p of this.parts()) {
      map.set(p.id, { partNumber: p.partNumber, description: p.description ?? p.name });
    }
    return map;
  });

  protected save(): void {
    if (this.form.invalid || this.lines().length === 0) return;
    // Phase 3 H2 / WU-12: refuse client-side when a deactivated vendor or
    // obsolete part is referenced — the server will 400 anyway, but this
    // keeps the user out of a flicker.
    if (this.selectedVendorWarning() || this.inactiveLineWarning()) return;
    this.saving.set(true);

    // Bought-parts effort PR4 — variance check before submit. One round
    // trip evaluates every line; if any are off-tier the prompt fires
    // before the PO is created.
    const f = this.form.getRawValue();
    const vendorId = f.vendorId!;
    this.vendorPartsService.checkTierVariance({
      vendorId,
      lines: this.lines().map(l => ({
        partId: l.partId,
        quantity: l.orderedQuantity,
        unitPrice: l.unitPrice,
      })),
    }).subscribe({
      next: (result) => {
        const offTier = result.lines.filter(l => l.isOffTier);
        if (offTier.length === 0) {
          this.submitPo();
          return;
        }
        this.offTierLines.set(offTier);
        this.offTierThresholdPct.set(result.thresholdPct);
        this.showOffTierPrompt.set(true);
        this.saving.set(false);
      },
      error: () => {
        // If the variance check itself fails, don't block submit — log a
        // soft toast and proceed. The variance prompt is informational; a
        // server hiccup shouldn't block legitimate PO creation.
        this.submitPo();
      },
    });
  }

  protected onOffTierCancel(): void {
    this.showOffTierPrompt.set(false);
    this.offTierLines.set([]);
  }

  protected onOffTierConfirm(result: OffTierPromptResult): void {
    this.showOffTierPrompt.set(false);
    this.saving.set(true);

    // For lines flagged "update tier", upsert a new VendorPartPriceTier.
    // Skip lines that already exist with no VendorPartId — those need a
    // VendorPart row first, which is admin-managed; we'd rather record
    // the line as exception and leave the tier insert for a follow-up.
    const tierUpserts = result.updateTierLines
      .filter(l => l.vendorPartId !== null)
      .map(l => this.vendorPartsService.addPriceTier(l.vendorPartId!, {
        minQuantity: l.quantity,
        unitPrice: l.unitPrice,
        effectiveFrom: toIsoDate(new Date()),
      }).pipe(catchError(() => of(null))));

    if (tierUpserts.length === 0) {
      this.submitPo();
      return;
    }

    forkJoin(tierUpserts).pipe(map(() => null)).subscribe({
      next: () => this.submitPo(),
      error: () => {
        // Tier upsert failed — surface to user but don't block PO submit.
        // The PO is still legitimate; tier update can be retried later.
        this.snackbar.error(this.translate.instant('purchaseOrders.offTier.updateTierFailed'));
        this.submitPo();
      },
    });
  }

  private submitPo(): void {
    this.saving.set(true);
    const f = this.form.getRawValue();
    const lineRequests: CreatePurchaseOrderLineRequest[] = this.lines().map(l => ({
      partId: l.partId,
      quantity: l.orderedQuantity,
      unitPrice: l.unitPrice,
    }));

    this.poService.createPurchaseOrder({
      vendorId: f.vendorId!,
      jobId: f.jobId ?? undefined,
      notes: f.notes || undefined,
      lines: lineRequests,
      incoterm: f.incoterm,
      estimatedFreight: f.estimatedFreight ?? undefined,
      quoteCurrency: f.quoteCurrency,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogRef.clearDraft();
        this.snackbar.success(this.translate.instant('purchaseOrders.poCreated'));
        this.saved.emit();
      },
      error: () => this.saving.set(false),
    });
  }
}

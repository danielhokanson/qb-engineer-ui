import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { CurrencyDisplayComponent } from '../../../../../shared/components/currency-display/currency-display.component';
import { CurrencyInputComponent } from '../../../../../shared/components/currency-input/currency-input.component';
import { DataTableComponent } from '../../../../../shared/components/data-table/data-table.component';
import { DatepickerComponent } from '../../../../../shared/components/datepicker/datepicker.component';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { SelectComponent } from '../../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../../shared/components/textarea/textarea.component';
import { ValidationButtonComponent } from '../../../../../shared/components/validation-button/validation-button.component';
import { ColumnCellDirective } from '../../../../../shared/directives/column-cell.directive';
import { LoadingBlockDirective } from '../../../../../shared/directives/loading-block.directive';
import { ColumnDef } from '../../../../../shared/models/column-def.model';
import { CURRENCY_OPTIONS } from '../../../../../shared/models/currency.const';
import { CurrencyService } from '../../../../../shared/services/currency.service';
import { FormValidationService } from '../../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../../shared/services/snackbar.service';
import { toIsoDate } from '../../../../../shared/utils/date.utils';

import { PartDetail } from '../../../models/part-detail.model';
import { PartPrice } from '../../../models/part-price.model';
import { PartsService } from '../../../services/parts.service';

/**
 * Dispatch C — Part-pricing cluster.
 *
 * Surfaces the resolver-current effective sales price for a part (read from
 * `entity().effectivePrice` / `effectivePriceCurrency` / `effectivePriceSource`,
 * already populated server-side via IPartPricingResolver) plus the
 * chronological history of PartPrice rows for the part. History is
 * immutable — only an "add new effective price" form is allowed in edit
 * mode, which causes the server to close out the previous open row.
 *
 * The cluster manages its own data fetch (history is independent of the
 * PartDetail aggregate); the parent panel just hands it the part record
 * and an `editing` flag.
 */
@Component({
  selector: 'app-part-pricing-cluster',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule, TranslatePipe,
    MatTooltipModule,
    CurrencyDisplayComponent, CurrencyInputComponent,
    DataTableComponent, ColumnCellDirective, LoadingBlockDirective,
    DatepickerComponent, InputComponent, SelectComponent, TextareaComponent,
    EmptyStateComponent, ValidationButtonComponent,
  ],
  templateUrl: './part-pricing-cluster.component.html',
  styleUrls: ['../part-clusters.shared.scss', './part-pricing-cluster.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartPricingClusterComponent {
  private readonly partsService = inject(PartsService);
  private readonly translate = inject(TranslateService);
  private readonly snackbar = inject(SnackbarService);
  private readonly currencyService = inject(CurrencyService);
  private readonly dialog = inject(MatDialog);

  /** Loaded PartDetail; the cluster reads `effectivePrice*` fields from it. */
  readonly entity = input.required<PartDetail>();
  readonly editing = input(false);

  /**
   * Pricing cluster manages its own state (history is independent from
   * the PartDetail aggregate). Parent panel still wires `save` / `cancelled`
   * to maintain a uniform contract with the other clusters; both events
   * are emitted with empty payloads.
   */
  readonly save = output<Partial<PartDetail>>();
  readonly cancelled = output<void>();

  protected readonly history = signal<PartPrice[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly currencyOptions = CURRENCY_OPTIONS;

  /** Resolves the source-badge label for the resolver-current price. */
  protected readonly sourceLabelKey = computed(() => {
    const src = this.entity().effectivePriceSource;
    switch (src) {
      case 'PriceListEntry': return 'parts.pricing.priceSourcePriceListEntry';
      case 'PartPrice': return 'parts.pricing.priceSourcePartPrice';
      case 'VendorPartTier': return 'parts.pricing.priceSourceVendorPartTier';
      default: return 'parts.pricing.priceSourceDefault';
    }
  });

  /** ID of the most-recent open row (delete affordance is only on this one). */
  protected readonly openRowId = computed(() => {
    return this.history().find(p => p.effectiveTo === null)?.id ?? null;
  });

  protected readonly columns: ColumnDef[] = [
    { field: 'effectiveFrom', header: this.translate.instant('parts.pricing.effectiveFromLabel'), sortable: true, width: '110px' },
    { field: 'effectiveTo', header: '→', width: '110px' },
    { field: 'unitPrice', header: this.translate.instant('parts.pricing.unitPriceLabel'), sortable: true, width: '130px', align: 'right' },
    { field: 'notes', header: this.translate.instant('parts.pricing.notesLabel') },
    { field: 'actions', header: '', width: '50px' },
  ];

  /** Add-new-price form. Defaults the currency to the install base. */
  protected readonly form = new FormGroup({
    unitPrice: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    currency: new FormControl<string>('USD', { nonNullable: true, validators: [Validators.required, Validators.maxLength(3), Validators.minLength(3)] }),
    effectiveFrom: new FormControl<Date | null>(new Date(), [Validators.required]),
    notes: new FormControl<string | null>(''),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    unitPrice: this.translate.instant('parts.pricing.unitPriceLabel'),
    currency: this.translate.instant('parts.pricing.currencyLabel'),
    effectiveFrom: this.translate.instant('parts.pricing.effectiveFromLabel'),
  });

  constructor() {
    // Reload history whenever the bound part changes.
    effect(() => {
      const part = this.entity();
      if (part?.id) {
        this.loadHistory(part.id);
        // Keep the form's currency default aligned with the install base.
        this.form.patchValue({ currency: this.currencyService.baseCurrency() }, { emitEvent: false });
      }
    });
  }

  private loadHistory(partId: number): void {
    this.loading.set(true);
    this.partsService.getPartPriceHistory(partId).subscribe({
      next: (rows) => {
        this.history.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected addPrice(): void {
    if (this.form.invalid) return;
    const part = this.entity();
    if (!part?.id) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.partsService.addPartPrice(part.id, {
      unitPrice: v.unitPrice!,
      currency: v.currency,
      effectiveFrom: v.effectiveFrom ? toIsoDate(v.effectiveFrom) ?? undefined : undefined,
      notes: v.notes ?? undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.reset({
          currency: this.currencyService.baseCurrency(),
          effectiveFrom: new Date(),
          notes: '',
        });
        this.snackbar.success(this.translate.instant('parts.pricing.addedSnack'));
        this.loadHistory(part.id);
      },
      error: () => this.saving.set(false),
    });
  }

  protected deleteRow(row: PartPrice): void {
    const part = this.entity();
    if (!part?.id) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('common.confirm'),
        message: this.translate.instant('parts.pricing.confirmDelete'),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.partsService.deletePartPrice(part.id, row.id).subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('parts.pricing.deletedSnack'));
          this.loadHistory(part.id);
        },
      });
    });
  }
}

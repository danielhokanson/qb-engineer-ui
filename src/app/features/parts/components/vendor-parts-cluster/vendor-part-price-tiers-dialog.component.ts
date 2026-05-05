import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { SelectComponent } from '../../../../shared/components/select/select.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { CURRENCY_OPTIONS } from '../../../../shared/models/currency.const';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { toIsoDate } from '../../../../shared/utils/date.utils';

import { VendorPartsService } from '../../services/vendor-parts.service';
import { VendorPart, VendorPartPriceTier } from '../../models/vendor-part.model';

export interface VendorPartPriceTiersDialogData {
  vendorPart: VendorPart;
}

@Component({
  selector: 'app-vendor-part-price-tiers-dialog',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule, TranslatePipe,
    MatTooltipModule,
    DialogComponent, DatepickerComponent, InputComponent, CurrencyInputComponent,
    SelectComponent,
    CurrencyDisplayComponent,
    DataTableComponent, ColumnCellDirective,
    EmptyStateComponent, ValidationButtonComponent,
  ],
  templateUrl: './vendor-part-price-tiers-dialog.component.html',
  styleUrl: './vendor-part-price-tiers-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorPartPriceTiersDialogComponent {
  private readonly vendorPartsService = inject(VendorPartsService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly matDialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<VendorPartPriceTiersDialogComponent>);
  protected readonly data = inject<VendorPartPriceTiersDialogData>(MAT_DIALOG_DATA);

  protected readonly tiers = signal<VendorPartPriceTier[]>(this.data.vendorPart.priceTiers ?? []);
  protected readonly saving = signal(false);
  protected readonly currencyOptions = CURRENCY_OPTIONS;

  protected readonly title = computed(() =>
    `${this.data.vendorPart.partNumber} — ${this.data.vendorPart.vendorCompanyName}`,
  );

  protected readonly columns: ColumnDef[] = [
    { field: 'minQuantity', header: this.translate.instant('vendorPart.priceTiers.minQuantity'), sortable: true, width: '90px', align: 'right' },
    { field: 'unitPrice', header: this.translate.instant('vendorPart.priceTiers.unitPrice'), sortable: true, width: '110px', align: 'right' },
    { field: 'currency', header: this.translate.instant('vendorPart.priceTiers.currency'), width: '70px', align: 'center' },
    { field: 'effectiveFrom', header: this.translate.instant('vendorPart.priceTiers.effectiveFrom'), sortable: true, width: '110px' },
    { field: 'effectiveTo', header: this.translate.instant('vendorPart.priceTiers.effectiveTo'), sortable: true, width: '110px' },
    { field: 'notes', header: this.translate.instant('vendorPart.notes') },
    { field: 'actions', header: '', width: '50px' },
  ];

  protected readonly form = new FormGroup({
    minQuantity: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    unitPrice: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    currency: new FormControl<string>('USD', { nonNullable: true, validators: [Validators.required, Validators.maxLength(3), Validators.minLength(3)] }),
    effectiveFrom: new FormControl<Date | null>(new Date()),
    effectiveTo: new FormControl<Date | null>(null),
    notes: new FormControl<string | null>(''),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    minQuantity: this.translate.instant('vendorPart.priceTiers.minQuantity'),
    unitPrice: this.translate.instant('vendorPart.priceTiers.unitPrice'),
    currency: this.translate.instant('vendorPart.priceTiers.currency'),
  });

  close(): void {
    this.dialogRef.close();
  }

  protected addTier(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.vendorPartsService.addPriceTier(this.data.vendorPart.id, {
      minQuantity: v.minQuantity!,
      unitPrice: v.unitPrice!,
      // Currency moved to VendorPart-level — server snapshots from parent.
      effectiveFrom: v.effectiveFrom ? toIsoDate(v.effectiveFrom) : null,
      effectiveTo: v.effectiveTo ? toIsoDate(v.effectiveTo) : null,
      notes: v.notes || null,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.reset({ currency: 'USD', effectiveFrom: new Date() });
        this.refreshTiers();
      },
      error: () => this.saving.set(false),
    });
  }

  protected deleteTier(tier: VendorPartPriceTier): void {
    this.matDialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('common.confirm'),
        message: 'Remove this price tier?',
        confirmLabel: this.translate.instant('common.remove'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.vendorPartsService.deletePriceTier(this.data.vendorPart.id, tier.id).subscribe({
        next: () => {
          this.snackbar.success('Price tier removed');
          this.refreshTiers();
        },
      });
    });
  }

  private refreshTiers(): void {
    this.vendorPartsService.get(this.data.vendorPart.id).subscribe({
      next: (vp) => this.tiers.set(vp.priceTiers ?? []),
    });
  }
}

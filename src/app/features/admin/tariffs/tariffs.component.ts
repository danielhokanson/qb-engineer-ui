import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';

import { TariffRateService } from '../services/tariff-rate.service';
import { TariffRate } from '../models/tariff-rate.model';
import { PageLayoutComponent } from '../../../shared/components/page-layout/page-layout.component';
import { ToolbarComponent } from '../../../shared/components/toolbar/toolbar.component';
import { SpacerDirective } from '../../../shared/directives/spacer.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../shared/models/column-def.model';
import { DialogComponent } from '../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { DatepickerComponent } from '../../../shared/components/datepicker/datepicker.component';
import { ValidationButtonComponent } from '../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { toIsoDate } from '../../../shared/utils/date.utils';

/**
 * Bought-parts effort PR4 — TariffRate admin page.
 *
 * Admin imports HTS-code tariffs that feed the landed-cost duty
 * component on the part Cost tab. SCD-2 supersession is the admin's
 * responsibility: to retire a rate, edit the row, set EffectiveTo,
 * and add a new row with a fresh EffectiveFrom. Soft-delete (DELETE
 * endpoint) is for genuinely-bad entries; the audit trail prefers
 * supersession over erasure.
 */
@Component({
  selector: 'app-tariffs',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, ReactiveFormsModule, TranslatePipe,
    PageLayoutComponent, ToolbarComponent, SpacerDirective,
    DataTableComponent, ColumnCellDirective,
    DialogComponent, InputComponent, DatepickerComponent,
    ValidationButtonComponent, LoadingBlockDirective,
  ],
  templateUrl: './tariffs.component.html',
  styleUrl: './tariffs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TariffsComponent {
  private readonly tariffService = inject(TariffRateService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tariffs = signal<TariffRate[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showDialog = signal(false);
  protected readonly editingId = signal<number | null>(null);

  protected readonly columns: ColumnDef[] = [
    { field: 'htsCode', header: 'HTS Code', sortable: true, width: '160px' },
    { field: 'countryOfOrigin', header: 'Origin', sortable: true, width: '90px' },
    { field: 'ratePct', header: 'Rate %', sortable: true, type: 'number', align: 'right', width: '100px' },
    { field: 'effectiveFrom', header: 'Effective From', sortable: true, type: 'date', width: '130px' },
    { field: 'effectiveTo', header: 'Effective To', sortable: true, type: 'date', width: '130px' },
    { field: 'source', header: 'Source', sortable: true },
    { field: 'actions', header: '', width: '110px', align: 'right' },
  ];

  protected readonly form = new FormGroup({
    htsCode: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(20)] }),
    countryOfOrigin: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(2)],
    }),
    ratePct: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(0), Validators.max(1000)] }),
    effectiveFrom: new FormControl<Date | null>(new Date(), [Validators.required]),
    effectiveTo: new FormControl<Date | null>(null),
    source: new FormControl<string>(''),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    htsCode: 'HTS Code',
    countryOfOrigin: 'Country of Origin',
    ratePct: 'Rate %',
    effectiveFrom: 'Effective From',
    effectiveTo: 'Effective To',
    source: 'Source',
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.tariffService.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => {
        this.tariffs.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openNew(): void {
    this.editingId.set(null);
    this.form.reset({
      htsCode: '',
      countryOfOrigin: '',
      ratePct: 0,
      effectiveFrom: new Date(),
      effectiveTo: null,
      source: '',
    });
    this.showDialog.set(true);
  }

  protected openEdit(row: TariffRate): void {
    this.editingId.set(row.id);
    this.form.reset({
      htsCode: row.htsCode,
      countryOfOrigin: row.countryOfOrigin,
      ratePct: row.ratePct,
      effectiveFrom: row.effectiveFrom ? new Date(row.effectiveFrom) : null,
      effectiveTo: row.effectiveTo ? new Date(row.effectiveTo) : null,
      source: row.source ?? '',
    });
    // HTS code + country are immutable on edit (they're the natural key).
    this.form.controls.htsCode.disable();
    this.form.controls.countryOfOrigin.disable();
    this.showDialog.set(true);
  }

  protected close(): void {
    this.showDialog.set(false);
    this.form.controls.htsCode.enable();
    this.form.controls.countryOfOrigin.enable();
  }

  protected save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const f = this.form.getRawValue();
    const id = this.editingId();
    const effectiveFrom = toIsoDate(f.effectiveFrom!)!.slice(0, 10);
    const effectiveTo = f.effectiveTo ? toIsoDate(f.effectiveTo)!.slice(0, 10) : null;

    if (id !== null) {
      this.tariffService.update(id, {
        ratePct: f.ratePct,
        effectiveFrom,
        effectiveTo,
        source: f.source || null,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.snackbar.success(this.translate.instant('admin.tariffs.updated'));
          this.close();
          this.load();
        },
        error: () => this.saving.set(false),
      });
    } else {
      this.tariffService.create({
        htsCode: f.htsCode.trim(),
        countryOfOrigin: f.countryOfOrigin.trim().toUpperCase(),
        ratePct: f.ratePct,
        effectiveFrom,
        effectiveTo,
        source: f.source || null,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.snackbar.success(this.translate.instant('admin.tariffs.created'));
          this.close();
          this.load();
        },
        error: () => this.saving.set(false),
      });
    }
  }

  protected confirmDelete(row: TariffRate): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: this.translate.instant('admin.tariffs.deleteTitle'),
        message: this.translate.instant('admin.tariffs.deleteMessage', {
          hts: row.htsCode, country: row.countryOfOrigin,
        }),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.tariffService.delete(row.id).subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('admin.tariffs.deleted'));
          this.load();
        },
      });
    });
  }
}

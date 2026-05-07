import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PurchasingService } from '../../services/purchasing.service';
import { VendorService } from '../../../vendors/services/vendor.service';
import { VendorResponse } from '../../../vendors/models/vendor-response.model';
import { RfqDetail, RfqVendorResponse } from '../../models/rfq.model';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EntityLinkComponent } from '../../../../shared/components/entity-link/entity-link.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { toIsoDate } from '../../../../shared/utils/date.utils';

export interface RfqDetailDialogData {
  rfqId: number;
}

@Component({
  selector: 'app-rfq-detail-dialog',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule, TranslatePipe,
    DialogComponent, InputComponent, SelectComponent, TextareaComponent,
    DatepickerComponent, DataTableComponent, ColumnCellDirective,
    LoadingBlockDirective, ValidationButtonComponent, EntityLinkComponent,
    CurrencyDisplayComponent,
  ],
  templateUrl: './rfq-detail-dialog.component.html',
  styleUrl: './rfq-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RfqDetailDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<RfqDetailDialogComponent, boolean>);
  private readonly dialog = inject(MatDialog);
  private readonly purchasingService = inject(PurchasingService);
  private readonly vendorService = inject(VendorService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<RfqDetailDialogData>(MAT_DIALOG_DATA);

  protected readonly loading = signal(true);
  protected readonly rfq = signal<RfqDetail | null>(null);
  protected readonly vendors = signal<VendorResponse[]>([]);
  protected readonly saving = signal(false);
  protected readonly showSendForm = signal(false);
  protected readonly showResponseForm = signal(false);
  private hasChanged = false;

  // Send to Vendors form
  protected readonly sendVendorControl = new FormControl<number[]>([], [Validators.required]);
  protected readonly vendorOptions = computed<SelectOption[]>(() => {
    const existing = this.rfq()?.vendorResponses.map(r => r.vendorId) ?? [];
    return this.vendors()
      .filter(v => !existing.includes(v.id))
      .map(v => ({ value: v.id, label: v.companyName }));
  });

  // Record Response form
  protected readonly responseForm = new FormGroup({
    vendorId: new FormControl<number | null>(null, [Validators.required]),
    unitPrice: new FormControl<number | null>(null),
    leadTimeDays: new FormControl<number | null>(null),
    minimumOrderQuantity: new FormControl<number | null>(null),
    toolingCost: new FormControl<number | null>(null),
    quoteValidUntil: new FormControl<Date | null>(null),
    notes: new FormControl(''),
  });

  protected readonly responseViolations = FormValidationService.getViolations(this.responseForm, {
    vendorId: this.translate.instant('purchasing.cols.vendor'),
    unitPrice: this.translate.instant('purchasing.unitPrice'),
    leadTimeDays: this.translate.instant('purchasing.leadTime'),
    minimumOrderQuantity: this.translate.instant('purchasing.moq'),
    toolingCost: this.translate.instant('purchasing.toolingCost'),
    quoteValidUntil: this.translate.instant('purchasing.quoteValidUntil'),
    notes: this.translate.instant('purchasing.notes'),
  });

  protected readonly pendingVendorOptions = computed<SelectOption[]>(() => {
    const responses = this.rfq()?.vendorResponses ?? [];
    return responses
      .filter(r => r.responseStatus === 'Pending')
      .map(r => ({ value: r.vendorId, label: r.vendorName }));
  });

  protected readonly responseColumns: ColumnDef[] = [
    { field: 'vendorName', header: this.translate.instant('purchasing.cols.vendor'), sortable: true },
    { field: 'responseStatus', header: this.translate.instant('purchasing.cols.status'), sortable: true, width: '120px' },
    { field: 'unitPrice', header: this.translate.instant('purchasing.cols.unitPrice'), sortable: true, width: '110px', align: 'right' },
    { field: 'leadTimeDays', header: this.translate.instant('purchasing.cols.leadTime'), sortable: true, width: '100px', align: 'center' },
    { field: 'minimumOrderQuantity', header: this.translate.instant('purchasing.cols.moq'), sortable: true, width: '80px', align: 'center' },
    { field: 'toolingCost', header: this.translate.instant('purchasing.cols.tooling'), sortable: true, width: '100px', align: 'right' },
    { field: 'quoteValidUntil', header: this.translate.instant('purchasing.cols.validUntil'), sortable: true, type: 'date', width: '110px' },
  ];

  constructor() {
    this.loadRfq();
    this.vendorService.getVendorDropdown().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => this.vendors.set(list),
    });
  }

  protected loadRfq(): void {
    this.loading.set(true);
    this.purchasingService.getRfqById(this.data.rfqId).subscribe({
      next: (rfq) => {
        this.rfq.set(rfq);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected close(): void {
    this.dialogRef.close(this.hasChanged);
  }

  // --- Send to Vendors ---
  protected toggleSendForm(): void {
    this.showSendForm.set(!this.showSendForm());
  }

  protected sendToVendors(): void {
    const vendorIds = this.sendVendorControl.value;
    if (!vendorIds?.length) return;

    this.saving.set(true);
    this.purchasingService.sendToVendors(this.data.rfqId, { vendorIds }).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('purchasing.snackbar.rfqSent'));
        this.saving.set(false);
        this.showSendForm.set(false);
        this.sendVendorControl.reset([]);
        this.hasChanged = true;
        this.loadRfq();
      },
      error: () => this.saving.set(false),
    });
  }

  // --- Record Response ---
  protected toggleResponseForm(): void {
    this.showResponseForm.set(!this.showResponseForm());
  }

  protected recordResponse(): void {
    if (this.responseForm.invalid || this.saving()) return;

    this.saving.set(true);
    const val = this.responseForm.getRawValue();
    this.purchasingService.recordVendorResponse(this.data.rfqId, {
      vendorId: val.vendorId!,
      unitPrice: val.unitPrice ?? undefined,
      leadTimeDays: val.leadTimeDays ?? undefined,
      minimumOrderQuantity: val.minimumOrderQuantity ?? undefined,
      toolingCost: val.toolingCost ?? undefined,
      quoteValidUntil: val.quoteValidUntil ? toIsoDate(val.quoteValidUntil)! : undefined,
      notes: val.notes || undefined,
    }).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('purchasing.snackbar.responseRecorded'));
        this.saving.set(false);
        this.showResponseForm.set(false);
        this.responseForm.reset();
        this.hasChanged = true;
        this.loadRfq();
      },
      error: () => this.saving.set(false),
    });
  }

  // --- Award ---
  protected awardVendor(response: RfqVendorResponse): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('purchasing.awardRfqTitle'),
        message: this.translate.instant('purchasing.awardRfqMessage', { vendor: response.vendorName }),
        confirmLabel: this.translate.instant('purchasing.award'),
        severity: 'info',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;

      this.saving.set(true);
      this.purchasingService.awardRfq(this.data.rfqId, response.id).subscribe({
        next: () => {
          this.snackbar.successWithNav(this.translate.instant('purchasing.snackbar.rfqAwarded'), `/purchase-orders`, 'View PO');
          this.saving.set(false);
          this.hasChanged = true;
          this.loadRfq();
        },
        error: () => this.saving.set(false),
      });
    });
  }

  // --- Helpers ---
  protected getResponseStatusClass(status: string): string {
    const map: Record<string, string> = {
      Pending: 'chip--muted',
      Received: 'chip--success',
      Declined: 'chip--error',
      Awarded: 'chip--primary',
      NotAwarded: 'chip--warning',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  protected canSend(): boolean {
    const rfq = this.rfq();
    return !!rfq && (rfq.status === 'Draft' || rfq.status === 'Sent');
  }

  protected canRecordResponse(): boolean {
    const rfq = this.rfq();
    return !!rfq && (rfq.status === 'Sent' || rfq.status === 'Receiving');
  }

  protected canAward(): boolean {
    const rfq = this.rfq();
    return !!rfq && rfq.status !== 'Awarded' && rfq.status !== 'Cancelled' && rfq.status !== 'Expired';
  }

  protected isReceived(response: RfqVendorResponse): boolean {
    return response.responseStatus === 'Received';
  }
}

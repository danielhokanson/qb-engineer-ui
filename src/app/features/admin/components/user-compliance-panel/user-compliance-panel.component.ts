import { ChangeDetectionStrategy, Component, inject, input, signal, effect } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { FileUploadZoneComponent, UploadedFile } from '../../../../shared/components/file-upload-zone/file-upload-zone.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { toIsoDate } from '../../../../shared/utils/date.utils';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { AdminService } from '../../services/admin.service';
import { UserComplianceDetail, ComplianceFormSubmission, IdentityDocument } from '../../../account/models/compliance-form.model';
import { CompleteI9DialogComponent, CompleteI9DialogData } from '../complete-i9-dialog/complete-i9-dialog.component';
import { PayrollService } from '../../../account/services/payroll.service';
import { PayStub, TaxDocument } from '../../../account/models/payroll.model';

@Component({
  selector: 'app-user-compliance-panel',
  standalone: true,
  imports: [DatePipe, CurrencyPipe, ReactiveFormsModule, TranslatePipe, LoadingBlockDirective, EmptyStateComponent, FileUploadZoneComponent, InputComponent, SelectComponent, DatepickerComponent, MatTooltipModule, DataTableComponent, ColumnCellDirective],
  templateUrl: './user-compliance-panel.component.html',
  styleUrl: './user-compliance-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserCompliancePanelComponent {
  private readonly adminService = inject(AdminService);
  private readonly payrollService = inject(PayrollService);
  private readonly snackbar = inject(SnackbarService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  readonly userId = input<number | null>(null);
  protected readonly detail = signal<UserComplianceDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly sending = signal(false);

  // Payroll
  protected readonly payStubs = signal<PayStub[]>([]);
  protected readonly taxDocuments = signal<TaxDocument[]>([]);
  protected readonly payrollLoading = signal(false);

  // Upload state — last uploaded file ID for linking to payroll record
  protected readonly lastPayStubFileId = signal<number | null>(null);
  protected readonly lastTaxDocFileId = signal<number | null>(null);

  // Pay stub form controls
  protected readonly psPayDate = new FormControl<Date | null>(null);
  protected readonly psPeriodStart = new FormControl<Date | null>(null);
  protected readonly psPeriodEnd = new FormControl<Date | null>(null);
  protected readonly psGrossPay = new FormControl('');
  protected readonly psNetPay = new FormControl('');

  // Tax document form controls
  protected readonly tdDocType = new FormControl('W2');
  protected readonly tdYear = new FormControl(new Date().getFullYear().toString());
  protected readonly taxDocTypeOptions: SelectOption[] = [
    { value: 'W2', label: 'W-2' },
    { value: 'W2c', label: 'W-2c (Corrected)' },
    { value: 'Misc1099', label: '1099-MISC' },
    { value: 'Nec1099', label: '1099-NEC' },
    { value: 'Other', label: 'Other' },
  ];

  protected readonly payStubColumns: ColumnDef[] = [
    { field: 'payDate', header: 'Pay Date', sortable: true, type: 'date', width: '100px' },
    { field: 'period', header: 'Period', sortable: false, width: '160px' },
    { field: 'grossPay', header: 'Gross', sortable: true, type: 'number', width: '100px', align: 'right' },
    { field: 'netPay', header: 'Net', sortable: true, type: 'number', width: '100px', align: 'right' },
    { field: 'source', header: 'Source', sortable: true, width: '90px' },
    { field: 'actions', header: 'Actions', sortable: false, width: '80px' },
  ];

  constructor() {
    effect(() => {
      const id = this.userId();
      if (id) {
        this.loadDetail(id);
        this.loadPayroll(id);
      } else {
        this.detail.set(null);
        this.payStubs.set([]);
        this.taxDocuments.set([]);
      }
    });
  }

  private loadDetail(userId: number): void {
    this.loading.set(true);
    this.adminService.getUserComplianceDetail(userId).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadPayroll(userId: number): void {
    this.payrollLoading.set(true);
    this.payrollService.getUserPayStubs(userId).subscribe({
      next: (stubs) => {
        this.payStubs.set(stubs);
        this.payrollLoading.set(false);
      },
      error: () => this.payrollLoading.set(false),
    });
    this.payrollService.getUserTaxDocuments(userId).subscribe({
      next: (docs) => this.taxDocuments.set(docs),
    });
  }

  protected getStatusClass(status: string): string {
    switch (status) {
      case 'Completed': return 'chip chip--success';
      case 'Pending': return 'chip chip--warning';
      case 'Opened': return 'chip chip--info';
      case 'Expired': return 'chip chip--error';
      case 'Declined': return 'chip chip--error';
      default: return 'chip chip--muted';
    }
  }

  protected verifyDocument(doc: IdentityDocument): void {
    this.adminService.verifyIdentityDocument(doc.id).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('admin.documentVerified'));
        const id = this.userId();
        if (id) this.loadDetail(id);
      },
    });
  }

  protected sendReminder(): void {
    const id = this.userId();
    if (!id) return;
    this.sending.set(true);
    this.adminService.sendComplianceReminder(id).subscribe({
      next: () => {
        this.sending.set(false);
        this.snackbar.success(this.translate.instant('admin.reminderSent'));
      },
      error: () => this.sending.set(false),
    });
  }

  protected downloadSignedPdf(sub: ComplianceFormSubmission): void {
    if (!sub.signedPdfFileId) return;
    window.open(`/api/v1/files/${sub.signedPdfFileId}`, '_blank');
  }

  protected openCompleteI9Dialog(sub: ComplianceFormSubmission): void {
    this.dialog.open(CompleteI9DialogComponent, {
      width: '640px',
      data: { submission: sub } satisfies CompleteI9DialogData,
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) {
        const id = this.userId();
        if (id) this.loadDetail(id);
      }
    });
  }

  // ── Payroll ──

  protected downloadPayStubPdf(id: number): void {
    this.payrollService.downloadPayStubPdf(id);
  }

  protected downloadTaxDocumentPdf(id: number): void {
    this.payrollService.downloadTaxDocumentPdf(id);
  }

  protected onPayStubFileUploaded(event: UploadedFile): void {
    this.lastPayStubFileId.set(+event.id);
    this.snackbar.success(this.translate.instant('admin.fileUploadedPayStub'));
  }

  protected onTaxDocFileUploaded(event: UploadedFile): void {
    this.lastTaxDocFileId.set(+event.id);
    this.snackbar.success(this.translate.instant('admin.fileUploadedTaxDoc'));
  }

  protected savePayStub(): void {
    const id = this.userId();
    const fileId = this.lastPayStubFileId();
    const payDate = this.psPayDate.value;
    const periodStart = this.psPeriodStart.value;
    const periodEnd = this.psPeriodEnd.value;
    const grossPay = this.psGrossPay.value;
    const netPay = this.psNetPay.value;
    if (!id || !fileId || !payDate || !periodStart || !periodEnd || !grossPay || !netPay) {
      this.snackbar.error(this.translate.instant('admin.uploadAndFillFields'));
      return;
    }
    this.payrollService.uploadPayStub(id, {
      // Calendar dates — use toIsoDate so the local date the user picked
      // is preserved as midnight-UTC of that date. Plain .toISOString()
      // would shift the day for any negative-UTC timezone.
      payDate: toIsoDate(payDate)!,
      payPeriodStart: toIsoDate(periodStart)!,
      payPeriodEnd: toIsoDate(periodEnd)!,
      grossPay: parseFloat(grossPay),
      netPay: parseFloat(netPay),
      fileAttachmentId: fileId,
    }).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('admin.payStubUploaded'));
        this.lastPayStubFileId.set(null);
        this.psPayDate.reset(); this.psPeriodStart.reset(); this.psPeriodEnd.reset();
        this.psGrossPay.reset(''); this.psNetPay.reset('');
        this.loadPayroll(id);
      },
    });
  }

  protected saveTaxDocument(): void {
    const id = this.userId();
    const fileId = this.lastTaxDocFileId();
    const documentType = this.tdDocType.value;
    const taxYear = this.tdYear.value;
    if (!id || !fileId || !documentType || !taxYear) {
      this.snackbar.error(this.translate.instant('admin.uploadAndFillFields'));
      return;
    }
    this.payrollService.uploadTaxDocument(id, {
      documentType,
      taxYear: parseInt(taxYear, 10),
      fileAttachmentId: fileId,
    }).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('admin.taxDocUploaded'));
        this.lastTaxDocFileId.set(null);
        this.tdDocType.reset('W2'); this.tdYear.reset(new Date().getFullYear().toString());
        this.loadPayroll(id);
      },
    });
  }

  protected deletePayStub(stub: PayStub): void {
    if (stub.source !== 'Manual') return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Delete Pay Stub?',
        message: `This will remove the manually uploaded pay stub for ${stub.payDate.toLocaleDateString()}.`,
        confirmLabel: 'Delete',
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.payrollService.deletePayStub(stub.id).subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('admin.payStubDeleted'));
          const id = this.userId();
          if (id) this.loadPayroll(id);
        },
      });
    });
  }

  protected deleteTaxDocument(doc: TaxDocument): void {
    if (doc.source !== 'Manual') return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Delete Tax Document?',
        message: `This will remove the manually uploaded ${doc.documentType} for ${doc.taxYear}.`,
        confirmLabel: 'Delete',
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.payrollService.deleteTaxDocument(doc.id).subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('admin.taxDocDeleted'));
          const id = this.userId();
          if (id) this.loadPayroll(id);
        },
      });
    });
  }

  protected getI9StatusClass(sub: ComplianceFormSubmission): string {
    if (sub.formType !== 'I9') return '';
    if (!sub.i9Section1SignedAt) return 'chip chip--warning';
    if (sub.i9Section2OverdueAt && sub.i9Section2OverdueAt.getTime() <= new Date().getTime() && !sub.i9Section2SignedAt)
      return 'chip chip--error';
    if (!sub.i9Section2SignedAt) return 'chip chip--info';
    return 'chip chip--success';
  }

  protected getI9StatusLabel(sub: ComplianceFormSubmission): string {
    if (sub.formType !== 'I9') return '';
    if (!sub.i9Section1SignedAt) return 'Sec 1 Pending';
    if (sub.i9Section2OverdueAt && sub.i9Section2OverdueAt.getTime() <= new Date().getTime() && !sub.i9Section2SignedAt)
      return 'Sec 2 Overdue';
    if (!sub.i9Section2SignedAt) return 'Awaiting Sec 2';
    return 'I-9 Complete';
  }

  protected getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      W2: 'W-2',
      W2c: 'W-2c (Corrected)',
      Misc1099: '1099-MISC',
      Nec1099: '1099-NEC',
      Other: 'Other',
    };
    return labels[type] ?? type;
  }
}

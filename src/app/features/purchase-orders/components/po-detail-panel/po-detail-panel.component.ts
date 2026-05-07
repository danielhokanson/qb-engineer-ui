import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, OnInit, output, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PurchaseOrderService } from '../../services/purchase-order.service';
import { PurchaseOrderDetail } from '../../models/purchase-order-detail.model';
import { PurchaseOrderRelease, CreatePurchaseOrderReleaseRequest } from '../../models/purchase-order-release.model';
import { ReceiveDialogComponent } from '../receive-dialog/receive-dialog.component';
import { BarcodeInfoComponent } from '../../../../shared/components/barcode-info/barcode-info.component';
import { EntityActivitySectionComponent } from '../../../../shared/components/entity-activity-section/entity-activity-section.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { toIsoDate } from '../../../../shared/utils/date.utils';
import { EntityLinkComponent } from '../../../../shared/components/entity-link/entity-link.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { INCOTERM_OPTIONS } from '../../models/incoterm.const';
import { ReferenceDataService } from '../../../../shared/services/reference-data.service';

@Component({
  selector: 'app-po-detail-panel',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, TranslatePipe, ReactiveFormsModule,
    MatTooltipModule,
    BarcodeInfoComponent, EntityActivitySectionComponent,
    ReceiveDialogComponent, LoadingBlockDirective,
    DialogComponent, InputComponent, SelectComponent, DatepickerComponent, TextareaComponent,
    ValidationButtonComponent,
    EntityLinkComponent, CurrencyDisplayComponent, CurrencyInputComponent,
    DataTableComponent, ColumnCellDirective,
  ],
  templateUrl: './po-detail-panel.component.html',
  styleUrl: './po-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoDetailPanelComponent implements OnInit {
  private readonly poService = inject(PurchaseOrderService);
  private readonly referenceDataService = inject(ReferenceDataService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Bought-parts effort PR2.5 — load currency options from reference-data
    // (group `currency`). Cached at the service so re-opening the panel
    // doesn't re-fetch.
    this.referenceDataService.getAsOptions('currency').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => this.quoteCurrencyOptions.set(options),
    });
  }

  // Phase 3 / WU-14 / H3 — short-close is gated to roles that handle PO
  // closure / AP follow-up. Mirrors the server-side [Authorize] list.
  protected readonly canShortCloseRole = this.auth.hasAnyRole(['Admin', 'Manager', 'OfficeManager', 'Procurement']);

  readonly purchaseOrderId = input.required<number>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  protected readonly po = signal<PurchaseOrderDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly showReceiveDialog = signal(false);
  protected readonly releases = signal<PurchaseOrderRelease[]>([]);
  protected readonly showCreateReleaseDialog = signal(false);
  protected readonly releaseSaving = signal(false);

  protected readonly releaseColumns: ColumnDef[] = [
    { field: 'releaseNumber', header: '#', sortable: true, width: '60px' },
    { field: 'partNumber', header: 'Part', sortable: true, width: '120px' },
    { field: 'quantity', header: 'Qty', sortable: true, type: 'number', width: '80px', align: 'right' },
    { field: 'requestedDeliveryDate', header: 'Req. Delivery', sortable: true, type: 'date', width: '120px' },
    { field: 'status', header: 'Status', sortable: true, width: '110px' },
  ];

  ngOnInit(): void {
    this.loadDetail();
  }

  protected loadDetail(): void {
    this.loading.set(true);
    this.poService.getPurchaseOrderById(this.purchaseOrderId()).subscribe({
      next: (detail) => {
        this.po.set(detail);
        this.loading.set(false);
        if (detail.isBlanket) this.loadReleases();
      },
      error: () => this.loading.set(false),
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  // --- Receive ---
  protected openReceiveDialog(): void { this.showReceiveDialog.set(true); }
  protected closeReceiveDialog(): void { this.showReceiveDialog.set(false); }

  protected onReceiveSaved(): void {
    this.closeReceiveDialog();
    this.loadDetail();
    this.changed.emit();
  }

  // --- Status Actions ---
  protected submitPo(): void {
    const po = this.po();
    if (!po) return;
    this.poService.submitPurchaseOrder(po.id).subscribe({
      next: () => {
        this.loadDetail();
        this.changed.emit();
        this.snackbar.success(this.translate.instant('purchaseOrders.poSubmitted'));
      },
    });
  }

  protected acknowledgePo(): void {
    const po = this.po();
    if (!po) return;
    this.poService.acknowledgePurchaseOrder(po.id).subscribe({
      next: () => {
        this.loadDetail();
        this.changed.emit();
        this.snackbar.success(this.translate.instant('purchaseOrders.poAcknowledged'));
      },
    });
  }

  protected cancelPo(): void {
    const po = this.po();
    if (!po) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('purchaseOrders.cancelPoTitle'),
        message: this.translate.instant('purchaseOrders.cancelPoMessage', { number: po.poNumber }),
        confirmLabel: this.translate.instant('purchaseOrders.cancelPo'),
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.poService.cancelPurchaseOrder(po.id).subscribe({
        next: () => {
          this.loadDetail();
          this.changed.emit();
          this.snackbar.success(this.translate.instant('purchaseOrders.poCancelled'));
        },
      });
    });
  }

  protected closePo(): void {
    const po = this.po();
    if (!po) return;
    this.poService.closePurchaseOrder(po.id).subscribe({
      next: () => {
        this.loadDetail();
        this.changed.emit();
        this.snackbar.success(this.translate.instant('purchaseOrders.poClosed'));
      },
    });
  }

  // Phase 3 / WU-14 / H3 — short-close a partially-received PO. Confirm
  // dialog gathers the required reason and POSTs to /short-close.
  protected readonly showShortCloseDialog = signal(false);
  protected readonly shortCloseSaving = signal(false);
  protected readonly shortCloseReasonCtrl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(2000)],
  });

  protected openShortClose(): void {
    this.shortCloseReasonCtrl.reset('');
    this.showShortCloseDialog.set(true);
  }

  protected confirmShortClose(): void {
    const po = this.po();
    if (!po) return;
    if (this.shortCloseReasonCtrl.invalid) {
      this.shortCloseReasonCtrl.markAsTouched();
      return;
    }
    const reason = this.shortCloseReasonCtrl.value.trim();
    this.shortCloseSaving.set(true);
    this.poService.shortClosePurchaseOrder(po.id, reason).subscribe({
      next: () => {
        this.showShortCloseDialog.set(false);
        this.shortCloseSaving.set(false);
        this.loadDetail();
        this.changed.emit();
        this.snackbar.success(this.translate.instant('purchaseOrders.poShortClosed'));
      },
      error: () => this.shortCloseSaving.set(false),
    });
  }

  // PO is short-close-eligible when partially-received OR submitted/acknowledged
  // with at least one line received < ordered. Mirror server gate.
  protected canShortClose(po: PurchaseOrderDetail): boolean {
    if (!this.canShortCloseRole) return false;
    if (po.status === 'Draft' || po.status === 'Closed' || po.status === 'Cancelled') return false;
    return po.lines.some(l => l.orderedQuantity > l.receivedQuantity + (l.cancelledShortCloseQuantity ?? 0));
  }

  protected deletePo(): void {
    const po = this.po();
    if (!po) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('purchaseOrders.deletePoTitle'),
        message: this.translate.instant('purchaseOrders.deletePoMessage', { number: po.poNumber }),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.poService.deletePurchaseOrder(po.id).subscribe({
        next: () => {
          this.changed.emit();
          this.closed.emit();
          this.snackbar.success(this.translate.instant('purchaseOrders.poDeleted'));
        },
      });
    });
  }

  // --- Releases ---
  protected readonly lineOptions = computed<SelectOption[]>(() => {
    const po = this.po();
    if (!po) return [];
    return po.lines.map(l => ({ value: l.id, label: `${l.partNumber} — ${l.description}` }));
  });

  protected readonly releaseForm = new FormGroup({
    purchaseOrderLineId: new FormControl<number | null>(null, [Validators.required]),
    quantity: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    requestedDeliveryDate: new FormControl<Date | null>(null, [Validators.required]),
    notes: new FormControl(''),
  });

  protected readonly releaseViolations = FormValidationService.getViolations(this.releaseForm, {
    purchaseOrderLineId: 'Line Item',
    quantity: 'Quantity',
    requestedDeliveryDate: 'Delivery Date',
  });

  protected loadReleases(): void {
    const po = this.po();
    if (!po?.isBlanket) return;
    this.poService.getReleases(po.id).subscribe({
      next: (data) => this.releases.set(data),
    });
  }

  protected openCreateRelease(): void {
    this.releaseForm.reset();
    this.showCreateReleaseDialog.set(true);
  }

  protected saveRelease(): void {
    const po = this.po();
    if (!po || this.releaseForm.invalid) return;
    this.releaseSaving.set(true);
    const form = this.releaseForm.getRawValue();
    const request: CreatePurchaseOrderReleaseRequest = {
      purchaseOrderLineId: form.purchaseOrderLineId!,
      quantity: form.quantity!,
      requestedDeliveryDate: toIsoDate(form.requestedDeliveryDate!)!,
      notes: form.notes || undefined,
    };
    this.poService.createRelease(po.id, request).subscribe({
      next: () => {
        this.snackbar.success('Release created');
        this.showCreateReleaseDialog.set(false);
        this.releaseSaving.set(false);
        this.loadReleases();
        this.loadDetail();
        this.changed.emit();
      },
      error: () => this.releaseSaving.set(false),
    });
  }

  // ─── Bought-parts effort PR2.5 — edit shipping/currency (Draft only) ─────
  // Inline-edit dialog for Incoterm, EstimatedFreight, QuoteCurrency,
  // FxRate, FxRateSource. Server enforces Draft-only on these fields; the
  // UI gates the action button by status. FX rate locks at Submit when
  // QuoteCurrency == base; non-base currencies require an explicit value
  // before Submit.
  protected readonly incotermOptions = INCOTERM_OPTIONS;
  protected readonly quoteCurrencyOptions = signal<SelectOption[]>([]);
  protected readonly showShippingDialog = signal(false);
  protected readonly shippingSaving = signal(false);

  protected readonly shippingForm = new FormGroup({
    incoterm: new FormControl<string>('FOB_Origin', { nonNullable: true, validators: [Validators.required] }),
    estimatedFreight: new FormControl<number | null>(null, [Validators.min(0)]),
    quoteCurrency: new FormControl<string>('USD', { nonNullable: true, validators: [Validators.required] }),
    fxRate: new FormControl<number | null>(null, [Validators.min(0.0001)]),
    fxRateSource: new FormControl<string>(''),
  });

  protected readonly shippingViolations = FormValidationService.getViolations(this.shippingForm, {
    incoterm: 'Incoterm',
    estimatedFreight: 'Estimated Freight',
    quoteCurrency: 'Quote Currency',
    fxRate: 'FX Rate',
    fxRateSource: 'FX Rate Source',
  });

  protected canEditShipping(po: PurchaseOrderDetail): boolean {
    return po.status === 'Draft';
  }

  protected openShippingDialog(): void {
    const po = this.po();
    if (!po) return;
    this.shippingForm.reset({
      incoterm: po.incoterm ?? 'FOB_Origin',
      estimatedFreight: po.estimatedFreight,
      quoteCurrency: po.quoteCurrency ?? 'USD',
      fxRate: po.fxRate,
      fxRateSource: po.fxRateSource ?? '',
    });
    this.showShippingDialog.set(true);
  }

  protected saveShipping(): void {
    const po = this.po();
    if (!po || this.shippingForm.invalid) return;
    this.shippingSaving.set(true);
    const f = this.shippingForm.getRawValue();
    this.poService.updatePurchaseOrder(po.id, {
      incoterm: f.incoterm,
      estimatedFreight: f.estimatedFreight ?? undefined,
      quoteCurrency: f.quoteCurrency,
      fxRate: f.fxRate ?? undefined,
      fxRateSource: f.fxRateSource || undefined,
    }).subscribe({
      next: () => {
        this.showShippingDialog.set(false);
        this.shippingSaving.set(false);
        this.loadDetail();
        this.changed.emit();
        this.snackbar.success(this.translate.instant('purchaseOrders.shippingUpdated'));
      },
      error: () => this.shippingSaving.set(false),
    });
  }

  protected getReleaseStatusClass(status: string): string {
    const map: Record<string, string> = {
      Open: 'chip--info',
      Sent: 'chip--primary',
      PartialReceived: 'chip--warning',
      Received: 'chip--success',
      Cancelled: 'chip--error',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  // --- Helpers ---
  protected getStatusClass(status: string): string {
    const map: Record<string, string> = {
      Draft: 'chip--muted',
      Submitted: 'chip--info',
      Acknowledged: 'chip--primary',
      PartiallyReceived: 'chip--warning',
      Received: 'chip--success',
      Closed: 'chip--muted',
      Cancelled: 'chip--error',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  protected getStatusLabel(status: string): string {
    const key = 'purchaseOrders.status' + status;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : status;
  }

  protected canSubmit(status: string): boolean { return status === 'Draft'; }
  protected canAcknowledge(status: string): boolean { return status === 'Submitted'; }
  protected canReceive(status: string): boolean {
    return status === 'Acknowledged' || status === 'PartiallyReceived';
  }
  protected canCancel(status: string): boolean {
    return status === 'Draft' || status === 'Submitted' || status === 'Acknowledged';
  }
  protected canClose(status: string): boolean { return status === 'Received'; }
  protected canDelete(status: string): boolean { return status === 'Draft'; }
}

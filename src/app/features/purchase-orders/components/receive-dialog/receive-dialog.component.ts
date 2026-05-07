import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal, ViewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PurchaseOrderService } from '../../services/purchase-order.service';
import { PurchaseOrderDetail } from '../../models/purchase-order-detail.model';
import { PurchaseOrderLine } from '../../models/purchase-order-line.model';
import { ReceiveLineRequest } from '../../models/receive-line-request.model';
import { FreightAllocationMethod } from '../../models/receive-items-request.model';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { DraftConfig } from '../../../../shared/models/draft-config.model';
import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';

@Component({
  selector: 'app-receive-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, DecimalPipe,
    DialogComponent, EmptyStateComponent, CurrencyInputComponent, SelectComponent,
    TranslatePipe,
  ],
  templateUrl: './receive-dialog.component.html',
  styleUrl: './receive-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReceiveDialogComponent implements OnInit {
  @ViewChild(DialogComponent) private dialogRef!: DialogComponent;

  private readonly poService = inject(PurchaseOrderService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly purchaseOrder = input.required<PurchaseOrderDetail>();
  readonly closed = output<void>();
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly receivableLines = signal<PurchaseOrderLine[]>([]);
  protected readonly lineControls = signal<FormControl<number>[]>([]);

  // Bought-parts effort PR3 — receipt-level freight capture. ActualFreight
  // defaults from PO.EstimatedFreight on init so the "matches estimate"
  // case is one click. Allocation method is admin-overridable per receipt.
  protected readonly actualFreightCtrl = new FormControl<number | null>(null, [Validators.min(0)]);
  protected readonly allocationMethodCtrl = new FormControl<FreightAllocationMethod>('ByExtendedValue', { nonNullable: true });

  protected readonly allocationOptions: SelectOption[] = [
    { value: 'ByExtendedValue', label: 'By Extended Value (default)' },
    { value: 'ByQuantity', label: 'By Quantity' },
    { value: 'Manual', label: 'Manual (per-line)' },
  ];

  /** Variance % between actual freight and the PO estimate. Null when either side missing. */
  protected readonly freightVariancePct = computed(() => {
    const est = this.purchaseOrder().estimatedFreight;
    const actual = this.actualFreightCtrl.value;
    if (est == null || est <= 0 || actual == null) return null;
    return ((actual - est) / est) * 100;
  });

  /** Wrapper FormGroup for draft system — holds line quantities keyed by line ID */
  protected readonly formGroup = new FormGroup({});

  protected draftConfig!: DraftConfig;

  ngOnInit(): void {
    const po = this.purchaseOrder();
    const lines = po.lines.filter(l => l.remainingQuantity > 0);
    this.receivableLines.set(lines);
    this.lineControls.set(
      lines.map(l => new FormControl<number>(0, {
        nonNullable: true,
        validators: [Validators.min(0), Validators.max(l.remainingQuantity)],
      }))
    );
    // Default actual freight to the PO's estimate so the common case is
    // one-click. Buyer can override.
    if (po.estimatedFreight != null) {
      this.actualFreightCtrl.setValue(po.estimatedFreight);
    }

    this.draftConfig = {
      entityType: 'po-receipt',
      entityId: po.id.toString(),
      route: '/purchase-orders',
      snapshotFn: () => {
        const snapshot: Record<string, unknown> = {};
        const ls = this.receivableLines();
        const cs = this.lineControls();
        ls.forEach((l, i) => { snapshot[l.id.toString()] = cs[i].value; });
        return snapshot;
      },
      restoreFn: (data: Record<string, unknown>) => {
        const ls = this.receivableLines();
        const cs = this.lineControls();
        ls.forEach((l, i) => {
          const val = data[l.id.toString()];
          if (val !== undefined && typeof val === 'number') {
            cs[i].setValue(val);
            cs[i].markAsDirty();
          }
        });
      },
    };
  }

  protected get hasAnyQuantity(): boolean {
    return this.lineControls().some(c => (c.value ?? 0) > 0);
  }

  protected close(): void {
    this.closed.emit();
  }

  protected receiveAll(): void {
    const lines = this.receivableLines();
    const controls = this.lineControls();
    lines.forEach((l, i) => controls[i].setValue(l.remainingQuantity));
  }

  protected save(): void {
    const lines = this.receivableLines();
    const controls = this.lineControls();

    const receiveLines: ReceiveLineRequest[] = [];
    lines.forEach((l, i) => {
      const qty = controls[i].value ?? 0;
      if (qty > 0) {
        receiveLines.push({ lineId: l.id, quantity: qty });
      }
    });

    if (receiveLines.length === 0) return;

    this.saving.set(true);
    this.poService.receiveItems(this.purchaseOrder().id, {
      lines: receiveLines,
      actualFreight: this.actualFreightCtrl.value ?? undefined,
      freightAllocationMethod: this.allocationMethodCtrl.value,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogRef.clearDraft();
        this.snackbar.success(this.translate.instant('purchaseOrders.itemsReceived'));
        this.saved.emit();
      },
      error: () => this.saving.set(false),
    });
  }
}

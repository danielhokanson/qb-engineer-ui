import { ChangeDetectionStrategy, Component, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { DatePipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ShipmentService } from '../../services/shipment.service';
import { ShipmentDetail } from '../../models/shipment-detail.model';
import { ShipmentTracking } from '../../models/shipment-tracking.model';
import { ShippingLabel } from '../../models/shipping-label.model';
import { TrackingTimelineComponent } from '../tracking-timeline/tracking-timeline.component';
import { ShippingRatesDialogComponent } from '../shipping-rates-dialog/shipping-rates-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EntityActivitySectionComponent } from '../../../../shared/components/entity-activity-section/entity-activity-section.component';
import { EntityLinkComponent } from '../../../../shared/components/entity-link/entity-link.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';

@Component({
  selector: 'app-shipment-detail-panel',
  standalone: true,
  imports: [
    DatePipe, CurrencyPipe, DecimalPipe, TranslatePipe,
    MatTooltipModule,
    TrackingTimelineComponent, ShippingRatesDialogComponent, LoadingBlockDirective,
    EntityActivitySectionComponent, EntityLinkComponent,
  ],
  templateUrl: './shipment-detail-panel.component.html',
  styleUrl: './shipment-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShipmentDetailPanelComponent implements OnInit {
  private readonly shipmentService = inject(ShipmentService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly shipmentId = input.required<number>();

  readonly closed = output<void>();
  readonly editRequested = output<ShipmentDetail>();
  readonly shipmentChanged = output<void>();

  protected readonly shipment = signal<ShipmentDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly trackingData = signal<ShipmentTracking | null>(null);
  protected readonly trackingLoading = signal(false);
  protected readonly showRatesDialog = signal(false);

  constructor() {
    effect(() => {
      const id = this.shipmentId();
      if (id) {
        this.loadDetail(id);
      }
    });
  }

  ngOnInit(): void {
    this.loadDetail(this.shipmentId());
  }

  private loadDetail(id: number): void {
    this.loading.set(true);
    this.shipmentService.getShipmentById(id).subscribe({
      next: (detail) => {
        this.shipment.set(detail);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  // --- Rates Dialog ---
  protected openRatesDialog(): void { this.showRatesDialog.set(true); }
  protected closeRatesDialog(): void { this.showRatesDialog.set(false); }
  protected onLabelCreated(_label: ShippingLabel): void {
    this.refreshDetail();
    this.shipmentChanged.emit();
  }

  // --- Tracking ---
  protected loadTracking(): void {
    const shipment = this.shipment();
    if (!shipment || !shipment.trackingNumber) return;
    this.trackingLoading.set(true);
    this.shipmentService.getTracking(shipment.id).subscribe({
      next: (tracking) => {
        this.trackingData.set(tracking);
        this.trackingLoading.set(false);
      },
      error: () => {
        this.trackingLoading.set(false);
        this.snackbar.error(this.translate.instant('shipments.failedTracking'));
      },
    });
  }

  protected closeTracking(): void { this.trackingData.set(null); }

  // --- Status Actions ---
  protected markShipped(): void {
    const shipment = this.shipment();
    if (!shipment) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('shipments.markShippedTitle'),
        message: this.translate.instant('shipments.markShippedMessage', { number: shipment.shipmentNumber }),
        confirmLabel: this.translate.instant('shipments.markShipped'),
        severity: 'info',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.shipmentService.shipShipment(shipment.id).subscribe({
        next: () => {
          this.refreshDetail();
          this.shipmentChanged.emit();
          this.snackbar.success(this.translate.instant('shipments.shipmentShipped'));
        },
      });
    });
  }

  protected markDelivered(): void {
    const shipment = this.shipment();
    if (!shipment) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('shipments.markDeliveredTitle'),
        message: this.translate.instant('shipments.markDeliveredMessage', { number: shipment.shipmentNumber }),
        confirmLabel: this.translate.instant('shipments.markDelivered'),
        severity: 'info',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.shipmentService.deliverShipment(shipment.id).subscribe({
        next: () => {
          this.refreshDetail();
          this.shipmentChanged.emit();
          this.snackbar.success(this.translate.instant('shipments.shipmentDelivered'));
        },
      });
    });
  }

  // --- Helpers ---
  protected getStatusClass(status: string): string {
    const map: Record<string, string> = {
      Pending: 'chip--muted',
      Packed: 'chip--info',
      Shipped: 'chip--primary',
      InTransit: 'chip--warning',
      Delivered: 'chip--success',
      Cancelled: 'chip--error',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  protected getStatusLabel(status: string): string {
    const key = 'shipments.status' + status;
    return this.translate.instant(key);
  }

  protected canShip(status: string): boolean {
    return status === 'Pending' || status === 'Packed';
  }

  protected canDeliver(status: string): boolean {
    return status === 'Shipped' || status === 'InTransit';
  }

  private refreshDetail(): void {
    const shipment = this.shipment();
    if (!shipment) return;
    this.shipmentService.getShipmentById(shipment.id).subscribe(d => this.shipment.set(d));
  }
}

import {
  ChangeDetectionStrategy, Component, computed, effect, inject,
  input, output, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { VendorService } from '../../services/vendor.service';
import { VendorDetail } from '../../models/vendor-detail.model';
import { VendorDialogComponent } from '../vendor-dialog/vendor-dialog.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { EntityActivitySectionComponent } from '../../../../shared/components/entity-activity-section/entity-activity-section.component';
import { VendorScorecardTabComponent } from '../vendor-scorecard-tab/vendor-scorecard-tab.component';
import { VendorPartListPanelComponent } from '../../../parts/components/vendor-parts-cluster/vendor-part-list-panel.component';
import { VendorPartFormDialogComponent, VendorPartFormDialogData } from '../../../parts/components/vendor-parts-cluster/vendor-part-form-dialog.component';
import { VendorPartPriceTiersDialogComponent, VendorPartPriceTiersDialogData } from '../../../parts/components/vendor-parts-cluster/vendor-part-price-tiers-dialog.component';
import { VendorPartPriceTierHistoryDialogComponent, VendorPartPriceTierHistoryDialogData } from '../../../parts/components/vendor-parts-cluster/vendor-part-price-tier-history-dialog.component';
import { VendorPartsService } from '../../../parts/services/vendor-parts.service';
import { VendorPart } from '../../../parts/models/vendor-part.model';
import { EntityCompletenessChipComponent } from '../../../../shared/components/entity-completeness-chip/entity-completeness-chip.component';

@Component({
  selector: 'app-vendor-detail-panel',
  standalone: true,
  imports: [
    DatePipe,
    MatTooltipModule,
    TranslatePipe,
    DataTableComponent, ColumnCellDirective,
    EmptyStateComponent, LoadingBlockDirective,
    VendorDialogComponent, EntityActivitySectionComponent, VendorScorecardTabComponent,
    VendorPartListPanelComponent,
    EntityCompletenessChipComponent,
  ],
  templateUrl: './vendor-detail-panel.component.html',
  styleUrl: './vendor-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorDetailPanelComponent {
  private readonly vendorService = inject(VendorService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly vendorId = input.required<number>();
  readonly closed = output<void>();
  readonly vendorChanged = output<void>();

  protected readonly loading = signal(false);
  protected readonly vendor = signal<VendorDetail | null>(null);
  protected readonly activeTab = signal<'info' | 'purchase-orders' | 'scorecard' | 'catalog'>('info');

  // Catalog tab (Vendor Parts)
  private readonly vendorPartsService = inject(VendorPartsService);
  protected readonly vendorParts = signal<VendorPart[]>([]);
  protected readonly vendorPartsLoading = signal(false);

  // Inline edit dialog
  protected readonly showEditDialog = signal(false);

  protected readonly vendorName = computed(() => this.vendor()?.companyName ?? '');

  protected readonly poColumns: ColumnDef[] = [
    { field: 'poNumber', header: this.translate.instant('vendors.poNumber'), sortable: true, width: '120px' },
    { field: 'status', header: this.translate.instant('common.status'), sortable: true, width: '140px' },
    { field: 'lineCount', header: this.translate.instant('vendors.lines'), sortable: true, width: '70px', align: 'center' },
    { field: 'expectedDeliveryDate', header: this.translate.instant('vendors.expected'), sortable: true, type: 'date', width: '110px' },
    { field: 'createdAt', header: this.translate.instant('common.createdAt'), sortable: true, type: 'date', width: '110px' },
  ];

  constructor() {
    effect(() => {
      const id = this.vendorId();
      if (id) {
        this.loadVendor(id);
      }
    });
  }

  private loadVendor(id: number): void {
    this.loading.set(true);
    this.vendorService.getVendorById(id).subscribe({
      next: (detail) => {
        this.vendor.set(detail);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openEditVendor(): void {
    this.showEditDialog.set(true);
  }

  protected closeEditDialog(): void {
    this.showEditDialog.set(false);
  }

  protected onEditSaved(): void {
    this.showEditDialog.set(false);
    this.loadVendor(this.vendorId());
    this.vendorChanged.emit();
  }

  protected toggleActive(): void {
    const v = this.vendor();
    if (!v) return;
    this.vendorService.updateVendor(v.id, { isActive: !v.isActive }).subscribe({
      next: () => {
        this.loadVendor(v.id);
        this.vendorChanged.emit();
        this.snackbar.success(this.translate.instant(v.isActive ? 'vendors.vendorDeactivated' : 'vendors.vendorActivated'));
      },
    });
  }

  protected deleteVendor(): void {
    const v = this.vendor();
    if (!v) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('vendors.deleteVendorTitle'),
        message: this.translate.instant('vendors.deleteVendorMessage', { name: v.companyName }),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.vendorService.deleteVendor(v.id).subscribe({
        next: () => {
          this.vendorChanged.emit();
          this.closed.emit();
          this.snackbar.success(this.translate.instant('vendors.vendorDeleted'));
        },
      });
    });
  }

  protected getPoStatusClass(status: string): string {
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

  protected getPoStatusLabel(status: string): string {
    return status === 'PartiallyReceived' ? this.translate.instant('vendors.poStatusPartial') : status;
  }

  protected openPurchaseOrder(row: { id: number }): void {
    this.router.navigate(['/purchase-orders'], { queryParams: { detail: `purchase-order:${row.id}` } });
  }

  // ── Catalog Tab (Vendor Parts) ──

  protected onCatalogTabActivated(): void {
    this.activeTab.set('catalog');
    this.loadVendorParts();
  }

  protected loadVendorParts(): void {
    const v = this.vendor();
    if (!v) return;
    this.vendorPartsLoading.set(true);
    this.vendorPartsService.listForVendor(v.id).subscribe({
      next: (list) => {
        const sorted = [...list].sort((a, b) => a.partNumber.localeCompare(b.partNumber));
        this.vendorParts.set(sorted);
        this.vendorPartsLoading.set(false);
      },
      error: () => this.vendorPartsLoading.set(false),
    });
  }

  protected openVendorPartCreate(): void {
    const v = this.vendor();
    if (!v) return;
    this.dialog.open<
      VendorPartFormDialogComponent,
      VendorPartFormDialogData,
      VendorPart | null
    >(VendorPartFormDialogComponent, {
      width: '600px',
      data: {
        vendorPart: null,
        parentEntityType: 'vendor',
        parentEntityId: v.id,
        parentLabel: v.companyName,
      },
    }).afterClosed().subscribe(result => {
      if (result) this.loadVendorParts();
    });
  }

  protected openVendorPartEdit(vp: VendorPart): void {
    const v = this.vendor();
    if (!v) return;
    this.dialog.open<
      VendorPartFormDialogComponent,
      VendorPartFormDialogData,
      VendorPart | null
    >(VendorPartFormDialogComponent, {
      width: '600px',
      data: {
        vendorPart: vp,
        parentEntityType: 'vendor',
        parentEntityId: v.id,
      },
    }).afterClosed().subscribe(result => {
      if (result) this.loadVendorParts();
    });
  }

  protected deleteVendorPart(vp: VendorPart): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('vendorPart.removePart'),
        message: this.translate.instant('vendorPart.confirmDelete'),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.vendorPartsService.delete(vp.id).subscribe({
        next: () => {
          this.snackbar.success('Removed from catalog');
          this.loadVendorParts();
        },
      });
    });
  }

  protected toggleVendorPartPreferred(vp: VendorPart): void {
    this.vendorPartsService.update(vp.id, { isPreferred: !vp.isPreferred }).subscribe({
      next: () => this.loadVendorParts(),
    });
  }

  protected openVendorPartTiers(vp: VendorPart): void {
    this.dialog.open<
      VendorPartPriceTiersDialogComponent,
      VendorPartPriceTiersDialogData
    >(VendorPartPriceTiersDialogComponent, {
      width: '700px',
      data: { vendorPart: vp },
    }).afterClosed().subscribe(() => this.loadVendorParts());
  }

  /** Dispatch C — read-only tier history dialog. */
  protected openVendorPartTierHistory(vp: VendorPart): void {
    this.dialog.open<
      VendorPartPriceTierHistoryDialogComponent,
      VendorPartPriceTierHistoryDialogData
    >(VendorPartPriceTierHistoryDialogComponent, {
      width: '700px',
      data: { vendorPart: vp },
    });
  }
}

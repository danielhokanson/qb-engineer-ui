import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MissingValidator } from '../../../../shared/models/workflow-missing-validator.model';
import { WorkflowService } from '../../../../shared/services/workflow.service';

import { PartsService } from '../../services/parts.service';
import { PartDetail } from '../../models/part-detail.model';
import { BOMEntry } from '../../models/bom-entry.model';
import { BOMSourceType } from '../../models/bom-source-type.type';
import { PartInventorySummary } from '../../models/part-inventory-summary.model';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { FileAttachment } from '../../../../shared/models/file.model';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { EntityPickerComponent } from '../../../../shared/components/entity-picker/entity-picker.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { StlViewerComponent } from '../../../../shared/components/stl-viewer/stl-viewer.component';
import { BarcodeInfoComponent } from '../../../../shared/components/barcode-info/barcode-info.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { BomTreeComponent } from '../bom-tree/bom-tree.component';
import { BomRevisionHistoryComponent } from '../bom-revision-history/bom-revision-history.component';
import { SerialNumbersTabComponent } from '../serial-numbers-tab/serial-numbers-tab.component';
import { VendorPartListPanelComponent } from '../vendor-parts-cluster/vendor-part-list-panel.component';
import { VendorPartFormDialogComponent, VendorPartFormDialogData } from '../vendor-parts-cluster/vendor-part-form-dialog.component';
import { VendorPartPriceTiersDialogComponent, VendorPartPriceTiersDialogData } from '../vendor-parts-cluster/vendor-part-price-tiers-dialog.component';
import { VendorPartPriceTierHistoryDialogComponent, VendorPartPriceTierHistoryDialogData } from '../vendor-parts-cluster/vendor-part-price-tier-history-dialog.component';
import { VendorPartsService } from '../../services/vendor-parts.service';
import { VendorPart } from '../../models/vendor-part.model';
import { PartIdentityClusterComponent } from '../part-clusters/part-identity-cluster.component';
import { PartInventoryClusterComponent } from '../part-clusters/part-inventory-cluster.component';
import { PartCostClusterComponent } from '../part-clusters/part-cost-cluster.component';
import { PartActivityClusterComponent } from '../part-clusters/part-activity-cluster.component';
import { PartPricingClusterComponent } from '../part-clusters/part-pricing-cluster/part-pricing-cluster.component';
import { PartFilesClusterComponent } from '../part-clusters/part-files-cluster.component';
import { PartMaterialClusterComponent } from '../part-clusters/part-material-cluster/part-material-cluster.component';
import { PartUomClusterComponent } from '../part-clusters/part-uom-cluster/part-uom-cluster.component';
import { PartMrpClusterComponent } from '../part-clusters/part-mrp-cluster/part-mrp-cluster.component';
// PartBomClusterComponent exists as a thin wrapper for future polish but is
// not currently imported here — the BOM tab keeps its rich inline UI
// (view toggle, add dialog, revision history) which the cluster wrapper
// does not yet replicate.
import { PartRoutingClusterComponent } from '../part-clusters/part-routing-cluster/part-routing-cluster.component';
import { PartAlternatesClusterComponent } from '../part-clusters/part-alternates-cluster/part-alternates-cluster.component';
import { PartQualityClusterComponent } from '../part-clusters/part-quality-cluster/part-quality-cluster.component';
import {
  PartDetailLayoutResolverService,
  PartDetailTabId,
  TabLayoutEntry,
} from '../../services/part-detail-layout-resolver.service';
import { EntityCompletenessChipComponent } from '../../../../shared/components/entity-completeness-chip/entity-completeness-chip.component';

type BomViewMode = 'table' | 'tree';

/**
 * Pillar 4 — Part detail panel.
 *
 * Tabs are now driven by `PartDetailLayoutResolverService.resolve(...)`,
 * which maps the (procurementSource, inventoryClass) axes to an ordered
 * list of tab descriptors. Identity is always first; Activity → Files
 * always last. Tab id is bound to `?tab=<id>` so refresh holds.
 *
 * Cluster tabs (identity, inventory, cost, activity, files, material,
 * uom, mrp, quality, routing, alternates) render the
 * new `<app-part-*-cluster>` components. Existing inline implementations
 * are reused for sourcing (vendor list panel) and BOM (rich inline UI
 * with view toggle, add dialog, and revision history — `PartBomClusterComponent`
 * exists as a thin wrapper for future polish but is not currently wired
 * into the BOM tab to preserve full add/delete/tree/revisions UX).
 */
@Component({
  selector: 'app-part-detail-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    MatTooltipModule,
    DialogComponent, InputComponent, SelectComponent, TextareaComponent,
    EntityPickerComponent, LoadingBlockDirective, ValidationButtonComponent,
    StlViewerComponent, BarcodeInfoComponent,
    DataTableComponent, ColumnCellDirective,
    BomTreeComponent, BomRevisionHistoryComponent,
    SerialNumbersTabComponent, VendorPartListPanelComponent,
    PartIdentityClusterComponent, PartInventoryClusterComponent, PartCostClusterComponent,
    PartActivityClusterComponent, PartFilesClusterComponent,
    PartMaterialClusterComponent, PartUomClusterComponent, PartMrpClusterComponent,
    PartRoutingClusterComponent, PartAlternatesClusterComponent,
    PartQualityClusterComponent, PartPricingClusterComponent,
    EntityCompletenessChipComponent,
  ],
  templateUrl: './part-detail-panel.component.html',
  styleUrl: './part-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartDetailPanelComponent {
  protected readonly partsService = inject(PartsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly workflowService = inject(WorkflowService);
  private readonly layoutResolver = inject(PartDetailLayoutResolverService);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  /** Phase 5: Promote-to-Active workflow state. */
  protected readonly promoting = signal(false);
  protected readonly promoteMissing = signal<MissingValidator[]>([]);

  readonly partId = input.required<number>();
  readonly closed = output<void>();
  readonly editRequested = output<PartDetail>();

  protected readonly part = signal<PartDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly saving = signal(false);
  /** Whether the global edit toggle is on; clusters render edit forms. */
  protected readonly editing = signal(false);

  /**
   * Currently active tab id. Includes the resolver's PartDetailTabId set
   * plus two conditional extras ('serials', 'viewer') that the panel
   * surfaces independently of the resolver when the part has serial
   * tracking or an STL file attached.
   */
  protected readonly activeTabId = signal<PartDetailTabId | 'serials' | 'viewer'>('identity');

  /** Resolved tab layout for the loaded Part. */
  protected readonly tabLayout = computed<TabLayoutEntry[]>(() => {
    const p = this.part();
    if (!p) return [];
    return this.layoutResolver.resolve(p.procurementSource, p.inventoryClass);
  });

  // ── Sources Tab ──
  private readonly vendorPartsService = inject(VendorPartsService);
  protected readonly vendorParts = signal<VendorPart[]>([]);
  protected readonly vendorPartsLoading = signal(false);

  // ── BOM view mode ──
  protected readonly bomViewMode = signal<BomViewMode>('table');

  // Phase 3 H4 / WU-20 — bumped on every BOM mutation so the
  // revision-history widget refreshes its list.
  protected readonly bomRefreshToken = signal(0);

  // ── Files & Inventory ──
  // Inventory summary is loaded for the future Inventory-summary section
  // (KPI strip) and to drive the file STL detection. The cluster component
  // currently only consumes the part record itself.
  protected readonly partFiles = signal<FileAttachment[]>([]);
  protected readonly inventorySummary = signal<PartInventorySummary | null>(null);
  protected readonly stlFile = computed(() => {
    return this.partFiles().find(f => f.fileName.toLowerCase().endsWith('.stl')) ?? null;
  });
  protected readonly stlFileUrl = computed(() => {
    const file = this.stlFile();
    return file ? this.partsService.getFileDownloadUrl(file.id) : null;
  });

  // ── BOM Dialog ──
  protected readonly showBomDialog = signal(false);

  protected readonly bomForm = new FormGroup({
    childPartId: new FormControl<number | null>(null, [Validators.required]),
    quantity: new FormControl(1, [Validators.required, Validators.min(0.01)]),
    sourceType: new FormControl('Buy'),
    referenceDesignator: new FormControl(''),
    leadTimeDays: new FormControl<number | null>(null),
    notes: new FormControl(''),
  });

  protected readonly bomViolations = FormValidationService.getViolations(this.bomForm, {
    childPartId: 'Child Part', quantity: 'Quantity',
  });

  protected readonly sourceTypeOptions: SelectOption[] = [
    { value: 'Make', label: this.translate.instant('parts.sourceMake') },
    { value: 'Buy', label: this.translate.instant('parts.sourceBuy') },
    { value: 'Stock', label: this.translate.instant('parts.sourceStock') },
  ];

  // ── BOM Table Columns ──
  protected readonly bomColumns: ColumnDef[] = [
    { field: 'sortOrder', header: '#', width: '40px', align: 'center' },
    { field: 'childPartNumber', header: this.translate.instant('parts.bomPart'), sortable: true },
    { field: 'quantity', header: this.translate.instant('parts.bomQty'), width: '60px', align: 'center', sortable: true },
    { field: 'sourceType', header: this.translate.instant('parts.bomSource'), width: '80px', sortable: true, filterable: true, type: 'enum',
      filterOptions: this.sourceTypeOptions },
    { field: 'leadTimeDays', header: this.translate.instant('parts.bomLeadTime'), width: '90px' },
    { field: 'referenceDesignator', header: this.translate.instant('parts.bomRefDes') },
    { field: 'actions', header: '', width: '40px' },
  ];

  // ── Used In Table Columns ──
  protected readonly usedInColumns: ColumnDef[] = [
    { field: 'parentPartNumber', header: this.translate.instant('parts.parentPart'), sortable: true },
    { field: 'parentName', header: this.translate.instant('common.name'), sortable: true },
    { field: 'quantity', header: this.translate.instant('parts.bomQty'), width: '60px', align: 'center', sortable: true },
  ];

  constructor() {
    effect(() => {
      const id = this.partId();
      if (id) {
        this.loadDetail(id);
      }
    });

    // Read `?tab=<id>` on init (URL as source of truth per CLAUDE.md).
    if (this.route) {
      const tabFromUrl = this.route.snapshot.queryParamMap.get('tab') as PartDetailTabId | 'serials' | 'viewer' | null;
      if (tabFromUrl) {
        this.activeTabId.set(tabFromUrl);
      }
    }

    // When the loaded part changes, ensure the active tab is in the resolved
    // layout — fall back to the first tab (always Identity) otherwise. Special
    // tabs (serials, viewer) are independent and remain active even if the
    // resolver doesn't list them.
    effect(() => {
      const layout = this.tabLayout();
      if (layout.length === 0) return;
      const current = this.activeTabId();
      if (current === 'serials' || current === 'viewer') return;
      if (!layout.some(t => t.id === current)) {
        this.activeTabId.set(layout[0].id);
      }
      // Vendor parts are loaded lazily when sourcing tab activates.
      if (this.activeTabId() === 'sourcing') {
        this.loadVendorParts();
      }
    });
  }

  // ── Data Loading ──

  private loadDetail(id: number): void {
    this.detailLoading.set(true);
    this.partFiles.set([]);
    this.inventorySummary.set(null);
    this.editing.set(false);
    this.partsService.getPartById(id).subscribe({
      next: (detail) => {
        this.part.set(detail);
        this.detailLoading.set(false);
        this.partsService.getPartFiles(detail.id).subscribe({
          next: (files) => this.partFiles.set(files),
        });
        this.partsService.getPartInventorySummary(detail.id).subscribe({
          next: (summary) => this.inventorySummary.set(summary),
        });
      },
      error: () => this.detailLoading.set(false),
    });
  }

  // ── Tab navigation ──

  protected selectTab(id: PartDetailTabId | 'serials' | 'viewer'): void {
    this.activeTabId.set(id);
    if (this.router && this.route) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: id },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    if (id === 'sourcing') {
      this.loadVendorParts();
    }
  }

  // ── Edit toggle ──

  protected toggleEdit(): void {
    this.editing.update(v => !v);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  /**
   * Generic save handler used by all editable cluster components. Each
   * cluster emits a `Partial<PartDetail>` patch; we forward it to the
   * server and refresh the bound part signal.
   */
  protected saveClusterPatch(patch: Partial<PartDetail>): void {
    const p = this.part();
    if (!p) return;
    // Map PartDetail subset → UpdatePartRequest. Only the fields the
    // shipped clusters edit are forwarded.
    const request: Record<string, unknown> = {};
    if ('name' in patch) request['name'] = patch.name;
    if ('description' in patch) request['description'] = patch.description ?? '';
    if ('revision' in patch) request['revision'] = patch.revision;
    if ('status' in patch) request['status'] = patch.status;
    if ('minStockThreshold' in patch) request['minStockThreshold'] = patch.minStockThreshold;
    if ('reorderPoint' in patch) request['reorderPoint'] = patch.reorderPoint;
    if ('reorderQuantity' in patch) request['reorderQuantity'] = patch.reorderQuantity;
    if ('safetyStockDays' in patch) request['safetyStockDays'] = patch.safetyStockDays;
    if ('traceabilityType' in patch) request['traceabilityType'] = patch.traceabilityType;
    if ('abcClass' in patch) request['abcClass'] = patch.abcClass;
    if ('manualCostOverride' in patch) {
      // Server uses sentinel -1 to mean "clear to null".
      request['manualCostOverride'] = patch.manualCostOverride === null ? -1 : patch.manualCostOverride;
    }
    // Pillar 4 Phase 2 — Material / UoM / MRP / Quality fields. The
    // server's PATCH endpoint may not accept all of these yet; the
    // workflow adapter does. We forward them either way so the wire
    // shape is correct as soon as the API surface widens.
    if ('materialSpecId' in patch) request['materialSpecId'] = patch.materialSpecId;
    if ('weightEach' in patch) request['weightEach'] = patch.weightEach;
    if ('weightDisplayUnit' in patch) request['weightDisplayUnit'] = patch.weightDisplayUnit;
    if ('lengthMm' in patch) request['lengthMm'] = patch.lengthMm;
    if ('widthMm' in patch) request['widthMm'] = patch.widthMm;
    if ('heightMm' in patch) request['heightMm'] = patch.heightMm;
    if ('dimensionDisplayUnit' in patch) request['dimensionDisplayUnit'] = patch.dimensionDisplayUnit;
    if ('volumeMl' in patch) request['volumeMl'] = patch.volumeMl;
    if ('volumeDisplayUnit' in patch) request['volumeDisplayUnit'] = patch.volumeDisplayUnit;
    if ('stockUomId' in patch) request['stockUomId'] = patch.stockUomId;
    if ('purchaseUomId' in patch) request['purchaseUomId'] = patch.purchaseUomId;
    if ('salesUomId' in patch) request['salesUomId'] = patch.salesUomId;
    if ('isMrpPlanned' in patch) request['isMrpPlanned'] = patch.isMrpPlanned;
    if ('lotSizingRule' in patch) request['lotSizingRule'] = patch.lotSizingRule;
    if ('fixedOrderQuantity' in patch) request['fixedOrderQuantity'] = patch.fixedOrderQuantity;
    if ('minimumOrderQuantity' in patch) request['minimumOrderQuantity'] = patch.minimumOrderQuantity;
    if ('orderMultiple' in patch) request['orderMultiple'] = patch.orderMultiple;
    if ('planningFenceDays' in patch) request['planningFenceDays'] = patch.planningFenceDays;
    if ('demandFenceDays' in patch) request['demandFenceDays'] = patch.demandFenceDays;
    if ('requiresReceivingInspection' in patch) request['requiresReceivingInspection'] = patch.requiresReceivingInspection;
    if ('receivingInspectionTemplateId' in patch) request['receivingInspectionTemplateId'] = patch.receivingInspectionTemplateId;
    if ('inspectionFrequency' in patch) request['inspectionFrequency'] = patch.inspectionFrequency;
    if ('inspectionSkipAfterN' in patch) request['inspectionSkipAfterN'] = patch.inspectionSkipAfterN;
    if ('hazmatClass' in patch) request['hazmatClass'] = patch.hazmatClass;
    if ('shelfLifeDays' in patch) request['shelfLifeDays'] = patch.shelfLifeDays;
    if ('backflushPolicy' in patch) request['backflushPolicy'] = patch.backflushPolicy;

    this.saving.set(true);
    this.partsService.updatePart(p.id, request).subscribe({
      next: (detail) => {
        this.part.set(detail);
        this.saving.set(false);
        this.editing.set(false);
        this.snackbar.success('Part updated');
      },
      error: () => this.saving.set(false),
    });
  }

  // ── Actions ──

  protected openEditPart(): void {
    const p = this.part();
    if (p) {
      this.editRequested.emit(p);
    }
  }

  protected closePanel(): void {
    this.closed.emit();
  }

  /**
   * Phase 5 — Promote-to-Active flow. Calls the readiness-gated server
   * endpoint; on success reloads the part. On 409 with missing validators,
   * shows the missing list inline so the user can address each gate
   * (e.g. "BOM not yet defined").
   */
  protected promoteToActive(): void {
    const p = this.part();
    if (!p) return;
    this.promoting.set(true);
    this.promoteMissing.set([]);
    this.workflowService.promoteEntityStatus('Part', p.id, 'Active').subscribe({
      next: (result) => {
        this.promoting.set(false);
        if (result.success) {
          this.snackbar.success(this.translate.instant('parts.workflow.promote.success'));
          this.loadDetail(p.id);
        } else {
          this.promoteMissing.set(result.missing);
          this.snackbar.error(this.translate.instant('parts.workflow.promote.missingShort'));
        }
      },
      error: () => {
        this.promoting.set(false);
        this.snackbar.error(this.translate.instant('parts.workflow.promote.failed'));
      },
    });
  }

  protected dismissPromoteMissing(): void {
    this.promoteMissing.set([]);
  }

  // ── BOM ──

  protected openAddBom(): void {
    this.bomForm.reset({
      childPartId: null, quantity: 1, referenceDesignator: '',
      sourceType: 'Buy', leadTimeDays: null, notes: '',
    });
    this.showBomDialog.set(true);
  }

  protected closeBomDialog(): void {
    this.showBomDialog.set(false);
  }

  protected saveBomEntry(): void {
    if (this.bomForm.invalid) return;
    const p = this.part();
    if (!p) return;
    const form = this.bomForm.getRawValue();
    this.partsService.createBOMEntry(p.id, {
      childPartId: form.childPartId!,
      quantity: form.quantity!,
      referenceDesignator: form.referenceDesignator || undefined,
      sourceType: (form.sourceType as BOMSourceType) ?? 'Buy',
      leadTimeDays: form.leadTimeDays ?? undefined,
      notes: form.notes || undefined,
    }).subscribe({
      next: (detail) => {
        this.part.set(detail);
        this.closeBomDialog();
        this.bomRefreshToken.update(v => v + 1);
        this.snackbar.success(this.translate.instant('parts.bomEntryAdded'));
      },
    });
  }

  protected deleteBomEntry(entry: BOMEntry): void {
    const p = this.part();
    if (!p) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('parts.deleteBomEntry'),
        message: this.translate.instant('parts.deleteBomMessage'),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.partsService.deleteBOMEntry(p.id, entry.id).subscribe({
        next: (detail) => {
          this.part.set(detail);
          this.bomRefreshToken.update(v => v + 1);
          this.snackbar.success(this.translate.instant('parts.bomEntryDeleted'));
        },
      });
    });
  }

  protected navigateToPart(usage: { parentPartId: number }): void {
    this.loadDetail(usage.parentPartId);
  }

  // ── Helpers ──

  /**
   * Picks an icon for the inline detail-header type indicator. Pre-beta:
   * keyed off the InventoryClass axis (the legacy single-axis PartType
   * was retired). Subassemblies render the tree icon; everything else
   * falls back to a generic settings icon.
   */
  protected getTypeIcon(inventoryClass: string): string {
    return inventoryClass === 'Subassembly' ? 'account_tree' : 'settings';
  }

  // ── Sources Tab (Vendor Parts) ──

  protected loadVendorParts(): void {
    const p = this.part();
    if (!p) return;
    this.vendorPartsLoading.set(true);
    this.vendorPartsService.listForPart(p.id).subscribe({
      next: (list) => {
        const sorted = [...list].sort((a, b) => {
          if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
          if (a.isApproved !== b.isApproved) return a.isApproved ? -1 : 1;
          return a.vendorCompanyName.localeCompare(b.vendorCompanyName);
        });
        this.vendorParts.set(sorted);
        this.vendorPartsLoading.set(false);
      },
      error: () => this.vendorPartsLoading.set(false),
    });
  }

  protected openVendorPartCreate(): void {
    const p = this.part();
    if (!p) return;
    // First-vendor shortcut: if this is the part's only source, default
    // preferred=true so the user doesn't have to think about preference
    // until an alternate actually exists.
    const isFirstSource = this.vendorParts().length === 0;
    this.dialog.open<
      VendorPartFormDialogComponent,
      VendorPartFormDialogData,
      VendorPart | null
    >(VendorPartFormDialogComponent, {
      width: '600px',
      data: {
        vendorPart: null,
        parentEntityType: 'part',
        parentEntityId: p.id,
        parentLabel: `${p.partNumber} — ${p.name}`,
        defaultIsPreferred: isFirstSource,
      },
    }).afterClosed().subscribe(result => {
      if (result) this.loadVendorParts();
    });
  }

  protected openVendorPartEdit(vp: VendorPart): void {
    const p = this.part();
    if (!p) return;
    this.dialog.open<
      VendorPartFormDialogComponent,
      VendorPartFormDialogData,
      VendorPart | null
    >(VendorPartFormDialogComponent, {
      width: '600px',
      data: {
        vendorPart: vp,
        parentEntityType: 'part',
        parentEntityId: p.id,
      },
    }).afterClosed().subscribe(result => {
      if (result) this.loadVendorParts();
    });
  }

  protected deleteVendorPart(vp: VendorPart): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('vendorPart.removeVendor'),
        message: this.translate.instant('vendorPart.confirmDelete'),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.vendorPartsService.delete(vp.id).subscribe({
        next: () => {
          this.snackbar.success('Vendor source removed');
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

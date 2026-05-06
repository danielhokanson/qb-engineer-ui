import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HttpErrorResponse } from '@angular/common/http';

import { PartsService } from './services/parts.service';
import { PartListItem, PartListRow } from './models/part-list-item.model';
import { PartDetail } from './models/part-detail.model';
import { PartStatus } from './models/part-status.type';
import { ProcurementSource } from './models/procurement-source.type';
import { InventoryClass } from './models/inventory-class.type';
import { TraceabilityType } from './models/traceability-type.type';
import { AbcClass } from './models/abc-class.type';
import { ScannerService } from '../../shared/services/scanner.service';
import { UserPreferencesService } from '../../shared/services/user-preferences.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { DialogComponent } from '../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../shared/components/select/select.component';
import { TextareaComponent } from '../../shared/components/textarea/textarea.component';
import { CurrencyDisplayComponent } from '../../shared/components/currency-display/currency-display.component';
import { DataTableComponent } from '../../shared/components/data-table/data-table.component';
import { EntityPickerComponent } from '../../shared/components/entity-picker/entity-picker.component';
import { ColumnCellDirective } from '../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../shared/models/column-def.model';
import { FormValidationService } from '../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../shared/components/validation-button/validation-button.component';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SnackbarService } from '../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../shared/directives/loading-block.directive';
import { PartsCardGridComponent } from './components/parts-card-grid/parts-card-grid.component';
import { DetailDialogService } from '../../shared/services/detail-dialog.service';
import { PartDetailDialogComponent, PartDetailDialogData } from './components/part-detail-dialog/part-detail-dialog.component';
import { WorkflowRun } from '../../shared/models/workflow-run.model';
import { WorkflowService } from '../../shared/services/workflow.service';
import { NewPartForkDialogComponent, NewPartForkResult } from './workflow/new-part-fork-dialog/new-part-fork-dialog.component';
import { EntityCompletenessChipComponent } from '../../shared/components/entity-completeness-chip/entity-completeness-chip.component';
import { EntityCompletenessBadgeComponent } from '../../shared/components/entity-completeness-badge/entity-completeness-badge.component';

type ViewMode = 'table' | 'cards';

@Component({
  selector: 'app-parts',
  standalone: true,
  imports: [
    DatePipe, NgTemplateOutlet,
    ReactiveFormsModule, TranslatePipe,
    PageHeaderComponent, DialogComponent,
    InputComponent, SelectComponent, TextareaComponent,
    CurrencyDisplayComponent,
    DataTableComponent, EntityPickerComponent, ColumnCellDirective, ValidationButtonComponent,
    LoadingBlockDirective, MatTooltipModule,
    PartsCardGridComponent,
    EntityCompletenessChipComponent, EntityCompletenessBadgeComponent,
  ],
  templateUrl: './parts.component.html',
  styleUrl: './parts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartsComponent {
  protected readonly partsService = inject(PartsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly scanner = inject(ScannerService);
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userPreferences = inject(UserPreferencesService);
  private readonly detailDialog = inject(DetailDialogService);
  private readonly workflowService = inject(WorkflowService);

  protected readonly loading = signal(false);
  protected readonly parts = signal<PartListItem[]>([]);
  /**
   * Entity-less workflow drafts the user has started but hasn't materialized
   * a Part row for yet. Surfaced as color-coded ghost rows at the top of the
   * parts table (see {@link combinedRows}) so they live in the user's natural
   * scan path rather than a separate region.
   */
  protected readonly entitylessDrafts = signal<WorkflowRun[]>([]);

  /**
   * Parts list with entity-less workflow drafts prepended as synthetic
   * "ghost" rows. Each ghost has `_draftRun` set so cell templates can
   * branch on it; the rest of the PartListItem fields are filled with
   * sentinel values that read as "not applicable" (`---`, etc.).
   */
  protected readonly combinedRows = computed<PartListRow[]>(() => {
    const ghosts: PartListRow[] = this.entitylessDrafts().map(run => ({
      // Negative id keeps it distinct from any real Part id and makes the
      // type-cast in onRowClick unambiguous.
      id: -run.id,
      partNumber: '',
      name: this.translate.instant('parts.drafts.unnamed'),
      description: null,
      revision: '',
      status: 'Draft' as const,
      procurementSource: 'Buy' as const,
      inventoryClass: 'Component' as const,
      bomEntryCount: 0,
      createdAt: new Date(run.startedAt),
      effectivePrice: 0,
      effectivePriceCurrency: 'USD',
      effectivePriceSource: 'Default' as const,
      pendingWorkflow: null,
      _draftRun: run,
    }));
    return [...ghosts, ...this.parts()];
  });
  // Phase 3 F7-partial / WU-17 — surfaces server-side totalCount.
  protected readonly totalCount = signal<number>(0);

  // ── View Mode (table / cards) — URL param + persisted preference ──
  protected readonly viewMode = toSignal(
    this.route.queryParamMap.pipe(
      map(p => (p.get('view') as ViewMode) ?? (this.userPreferences.get<ViewMode>('parts:viewMode') ?? 'table')),
    ),
    { initialValue: (this.userPreferences.get<ViewMode>('parts:viewMode') ?? 'table') as ViewMode },
  );

  // ── Page Filters ──
  protected readonly searchControl = new FormControl('');
  // Phase 5: status filter defaults to Active so Drafts (in-flight workflows) don't pollute the live list.
  // The user opts into Drafts/All explicitly when they want to resume / audit.
  protected readonly statusFilterControl = new FormControl<PartStatus | ''>('Active');
  // Pre-beta — replaced legacy single-axis `type` filter with the two
  // orthogonal axis filters that drive the catalog view.
  protected readonly procurementFilterControl = new FormControl<ProcurementSource | ''>('');
  protected readonly inventoryClassFilterControl = new FormControl<InventoryClass | ''>('');

  private readonly searchTerm = toSignal(this.searchControl.valueChanges.pipe(startWith('')), { initialValue: '' });
  private readonly statusFilter = toSignal(this.statusFilterControl.valueChanges.pipe(startWith('Active' as PartStatus | '')), { initialValue: 'Active' as PartStatus | '' });
  private readonly procurementFilter = toSignal(this.procurementFilterControl.valueChanges.pipe(startWith('' as ProcurementSource | '')), { initialValue: '' as ProcurementSource | '' });
  private readonly inventoryClassFilter = toSignal(this.inventoryClassFilterControl.valueChanges.pipe(startWith('' as InventoryClass | '')), { initialValue: '' as InventoryClass | '' });

  protected readonly statusFilterOptions: SelectOption[] = [
    { value: '', label: this.translate.instant('parts.allStatuses') },
    { value: 'Active', label: this.translate.instant('parts.statusActive') },
    { value: 'Draft', label: this.translate.instant('parts.statusDraft') },
    { value: 'Prototype', label: this.translate.instant('parts.statusPrototype') },
    { value: 'Obsolete', label: this.translate.instant('parts.statusObsolete') },
  ];

  protected readonly procurementFilterOptions: SelectOption[] = [
    { value: '', label: this.translate.instant('parts.allProcurementSources') },
    { value: 'Make', label: 'Make' },
    { value: 'Buy', label: 'Buy' },
    { value: 'Subcontract', label: 'Subcontract' },
    { value: 'Phantom', label: 'Phantom' },
  ];

  protected readonly inventoryClassFilterOptions: SelectOption[] = [
    { value: '', label: this.translate.instant('parts.allInventoryClasses') },
    { value: 'Raw', label: 'Raw' },
    { value: 'Component', label: 'Component' },
    { value: 'Subassembly', label: 'Subassembly' },
    { value: 'FinishedGood', label: 'Finished Good' },
    { value: 'Consumable', label: 'Consumable' },
    { value: 'Tool', label: 'Tool' },
  ];

  protected readonly partColumns: ColumnDef[] = [
    { field: 'partNumber', header: this.translate.instant('parts.partNumber'), sortable: true, width: '120px' },
    { field: 'name', header: this.translate.instant('common.name'), sortable: true },
    { field: 'revision', header: this.translate.instant('parts.rev'), width: '60px', align: 'center' },
    { field: 'procurementSource', header: 'Procurement', sortable: true, width: '110px' },
    { field: 'inventoryClass', header: 'Class', sortable: true, width: '110px' },
    { field: 'status', header: this.translate.instant('common.status'), sortable: true, filterable: true, type: 'enum', filterOptions: [
      { value: 'Active', label: this.translate.instant('parts.statusActive') }, { value: 'Draft', label: this.translate.instant('parts.statusDraft') }, { value: 'Prototype', label: this.translate.instant('parts.statusPrototype') }, { value: 'Obsolete', label: this.translate.instant('parts.statusObsolete') },
    ]},
    { field: 'effectivePrice', header: this.translate.instant('parts.effectivePrice'), sortable: true, width: '110px', align: 'right' },
    { field: 'bomEntryCount', header: this.translate.instant('parts.bom'), width: '60px', align: 'center' },
    // Hidden by default — power users opt in via column-manager. Renders the
    // full completeness chip (click → popover with per-capability gaps).
    { field: 'completeness', header: this.translate.instant('entityCompleteness.columnHeader'), width: '160px', align: 'center', visible: false },
  ];

  // ── Part Dialog ──
  protected readonly showPartDialog = signal(false);
  protected readonly editingPart = signal<PartDetail | null>(null);

  protected readonly partForm = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(256)]),
    description: new FormControl('', [Validators.maxLength(2000)]),
    revision: new FormControl('A'),
    procurementSource: new FormControl<ProcurementSource>('Buy', [Validators.required]),
    inventoryClass: new FormControl<InventoryClass>('Component', [Validators.required]),
    toolingAssetId: new FormControl<number | null>(null),
    minStockThreshold: new FormControl<number | null>(null, [Validators.min(0)]),
    reorderPoint: new FormControl<number | null>(null, [Validators.min(0)]),
    reorderQuantity: new FormControl<number | null>(null, [Validators.min(0.01)]),
    safetyStockDays: new FormControl<number | null>(null, [Validators.min(0)]),
    // Tier 0 — traceability + ABC class. (OEM identity moved to VendorPart.)
    traceabilityType: new FormControl<TraceabilityType>('None', [Validators.required]),
    abcClass: new FormControl<AbcClass | null>(null),
  });

  protected readonly partViolations = FormValidationService.getViolations(this.partForm, {
    name: 'Name', description: 'Description',
    procurementSource: 'Procurement Source', inventoryClass: 'Inventory Class',
  });

  protected readonly procurementSourceOptions: SelectOption[] = [
    { value: 'Make', label: 'Make' },
    { value: 'Buy', label: 'Buy' },
    { value: 'Subcontract', label: 'Subcontract' },
    { value: 'Phantom', label: 'Phantom' },
  ];

  protected readonly inventoryClassOptions: SelectOption[] = [
    { value: 'Raw', label: 'Raw' },
    { value: 'Component', label: 'Component' },
    { value: 'Subassembly', label: 'Subassembly' },
    { value: 'FinishedGood', label: 'Finished Good' },
    { value: 'Consumable', label: 'Consumable' },
    { value: 'Tool', label: 'Tool' },
  ];

  protected readonly traceabilityOptions: SelectOption[] = [
    { value: 'None', label: this.translate.instant('parts.workflow.basics.traceabilityNone') },
    { value: 'Lot', label: this.translate.instant('parts.workflow.basics.traceabilityLot') },
    { value: 'Serial', label: this.translate.instant('parts.workflow.basics.traceabilitySerial') },
  ];

  protected readonly abcClassOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('parts.workflow.basics.abcClassUnclassified') },
    { value: 'A', label: this.translate.instant('parts.workflow.basics.abcClassA') },
    { value: 'B', label: this.translate.instant('parts.workflow.basics.abcClassB') },
    { value: 'C', label: this.translate.instant('parts.workflow.basics.abcClassC') },
  ];

  constructor() {
    this.scanner.setContext('parts');
    this.loadParts();
    this.loadEntitylessDrafts();

    effect(() => {
      const scan = this.scanner.lastScan();
      if (!scan || scan.context !== 'parts') return;
      this.scanner.clearLastScan();
      this.searchControl.setValue(scan.value);
      this.loadParts();
    });

    // Phase 3 F7-partial / WU-17 — debounced search + filter changes fire the
    // standardised `?q=`, `?status=`, `?type=` query params against the
    // server (300ms debounce per the WU-17 charter).
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.loadParts());

    this.statusFilterControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.loadParts());

    this.procurementFilterControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.loadParts());

    this.inventoryClassFilterControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.loadParts());
  }

  // ── List ──

  protected loadParts(): void {
    this.loading.set(true);
    const status = (this.statusFilter() ?? '') || undefined;
    const procurementSource = (this.procurementFilter() ?? '') || undefined;
    const inventoryClass = (this.inventoryClassFilter() ?? '') || undefined;
    const search = (this.searchTerm() ?? '').trim() || undefined;
    // Phase 3 F7-partial / WU-17 — paged endpoint with the standardised
    // contract; pageSize=200 matches the server cap. The data-table slices
    // client-side for now; switch to true server-paging if a tenant grows
    // beyond the 200-row window.
    this.partsService.getPartsPaged({
      status,
      procurementSource,
      inventoryClass,
      q: search,
      pageSize: 200,
      sort: 'partNumber',
      order: 'asc',
    }).subscribe({
      next: (paged) => {
        this.parts.set(paged.items);
        this.totalCount.set(paged.totalCount);
        this.loading.set(false);
        this.autoOpenFromUrl();
      },
      error: () => this.loading.set(false),
    });
  }

  /** Auto-open detail dialog when URL contains ?detail=part:{id} */
  private autoOpenHandled = false;
  private autoOpenFromUrl(): void {
    if (this.autoOpenHandled) return;
    this.autoOpenHandled = true;
    const detail = this.detailDialog.getDetailFromUrl();
    if (detail?.entityType === 'part') {
      this.openPartDetail(detail.entityId);
    }
  }

  protected applyFilters(): void {
    this.loadParts();
  }

  protected clearSearch(): void {
    this.searchControl.setValue('');
    this.loadParts();
  }

  // ── Detail Dialog ──

  protected openPartDetail(partId: number): void {
    // Phase 5: if this is a Draft part, see if a workflow run exists and offer
    // to resume; otherwise fall back to the regular detail dialog.
    const part = this.parts().find(p => p.id === partId);
    if (part?.status === 'Draft') {
      this.tryResumeOrOpenDetail(partId);
      return;
    }
    this.openDetailDialog(partId);
  }

  private tryResumeOrOpenDetail(partId: number): void {
    this.workflowService.listActive().subscribe({
      next: (runs) => {
        const run = runs.find(r => r.entityType === 'Part' && r.entityId === partId
          && r.completedAt == null && r.abandonedAt == null);
        if (run) {
          this.router.navigate(['/parts', partId], {
            queryParams: { workflow: run.definitionId, step: run.currentStepId ?? 'basics', mode: run.mode },
          });
        } else {
          this.openDetailDialog(partId);
        }
      },
      error: () => this.openDetailDialog(partId),
    });
  }

  /**
   * Resume an in-progress workflow from the row indicator. The pendingWorkflow
   * payload comes from the list projection (single-query LEFT JOIN on
   * workflow_runs), so this navigates directly with no extra fetch.
   */
  protected resumeWorkflow(part: PartListItem): void {
    const pw = part.pendingWorkflow;
    if (!pw) return;
    this.router.navigate(['/parts', part.id], {
      queryParams: {
        workflow: pw.definitionId,
        step: pw.currentStepId ?? 'basics',
        mode: pw.mode,
        runId: pw.runId,
      },
    });
  }

  /**
   * Load workflow runs that haven't materialized a Part row yet — these
   * surface in the "Drafts in progress" section above the parts list, since
   * they have no row to attach a per-row indicator to. Without this surface
   * an abandoned wizard becomes orphaned data the user can never find.
   */
  protected loadEntitylessDrafts(): void {
    this.workflowService.listActive().subscribe({
      next: (runs) => {
        const drafts = runs.filter(r =>
          r.entityType === 'Part'
          && r.entityId == null
          && r.completedAt == null
          && r.abandonedAt == null);
        this.entitylessDrafts.set(drafts);
      },
      error: () => this.entitylessDrafts.set([]),
    });
  }

  /** Resume an entity-less draft by routing to /parts/new with its runId. */
  protected resumeEntitylessDraft(run: WorkflowRun): void {
    this.router.navigate(['/parts', 'new'], {
      queryParams: {
        runId: run.id,
        workflow: run.definitionId,
        step: run.currentStepId ?? 'basics',
        mode: run.mode,
      },
    });
  }

  /**
   * Abandon a draft from the Drafts section. Confirms first because the
   * action is destructive (run gets `abandonedAt` stamped, entity row
   * soft-deleted if Draft). After success the row drops off the list.
   */
  protected abandonDraft(run: WorkflowRun): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: this.translate.instant('parts.drafts.abandonConfirmTitle'),
        message: this.translate.instant('parts.drafts.abandonConfirmMessage'),
        confirmLabel: this.translate.instant('parts.drafts.abandonAction'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.workflowService.abandonRun(run.id, 'user').subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('parts.drafts.abandoned'));
          this.loadEntitylessDrafts();
          // Refresh the parts list too in case the abandon soft-deleted a
          // Draft row that was being shown as a row.
          this.loadParts();
        },
        error: () => this.snackbar.error(this.translate.instant('parts.workflow.abandonFailed')),
      });
    });
  }

  private openDetailDialog(partId: number): void {
    this.detailDialog.open<PartDetailDialogComponent, PartDetailDialogData, { action: string; part: PartDetail } | undefined>(
      'part', partId, PartDetailDialogComponent, { partId }
    ).afterClosed().subscribe(result => {
      if (result?.action === 'edit') {
        this.editPart(result.part);
      }
      this.loadParts(); // refresh list
    });
  }

  /**
   * Visual classifier for parts table rows. Synthetic draft rows
   * (`_draftRun` set) get the bright `part-row--draft-ghost` tint so they
   * read as "in progress, not a real part yet". Plain Draft-status parts
   * keep the subtler legacy marker.
   */
  protected readonly partRowClass = (row: unknown): string => {
    const part = row as PartListRow;
    if (part._draftRun) return 'part-row--draft-ghost';
    return part.status === 'Draft' ? 'part-row--draft' : '';
  };

  /**
   * Pin predicate for the data-table — draft ghost rows always render at
   * the top of the table regardless of the user's active sort column.
   */
  protected readonly isDraftRow = (row: unknown): boolean =>
    !!(row as PartListRow)._draftRun;

  /**
   * Row-click dispatcher. Real part rows go to the detail (or resume an
   * existing entity-bound workflow); ghost draft rows resume the entity-less
   * workflow run instead.
   */
  protected onRowClick(row: PartListRow): void {
    if (row._draftRun) {
      this.resumeEntitylessDraft(row._draftRun);
      return;
    }
    this.openPartDetail(row.id);
  }

  // ── Part CRUD ──

  /**
   * Pre-beta — Opens the axis-based New-Part fork dialog. The user answers
   * four questions:
   *   1. ProcurementSource (Make / Buy / Subcontract / Phantom)
   *   2. InventoryClass (filtered to viable combos for the chosen source)
   *   3. ItemKind (optional ref-data tag)
   *   4. Mode (express / guided, with per-combo recommended default)
   *
   * The 11 viable (procurement × inventory) combos each map to a canonical
   * workflow definition seeded server-side. Both modes route through the
   * same workflow infrastructure — the shell picks the express template or
   * the step-rail layout based on `mode`.
   */
  protected openCreatePart(): void {
    this.dialog.open(NewPartForkDialogComponent, { width: '560px' })
      .afterClosed().subscribe((result: NewPartForkResult | undefined) => {
        if (!result) return;
        this.startPartWorkflow(result);
      });
  }

  /**
   * Maps a (procurement, inventory) combo to its canonical workflow
   * definition id. The 11 viable combos are seeded server-side; the fork
   * dialog's Step-2 filter is the only enforcement point. Anything that
   * slips past — for instance an automated client poking the API directly
   * with a non-viable combo — would 404 server-side, which is the desired
   * outcome.
   */
  private workflowDefinitionForCombo(p: ProcurementSource, c: InventoryClass): string {
    const key = `${p.toLowerCase()}-${c.toLowerCase()}`;
    switch (key) {
      // Buy combos
      case 'buy-raw': return 'part-buy-raw-v1';
      case 'buy-component': return 'part-buy-component-v1';
      case 'buy-subassembly': return 'part-buy-subassembly-v1';
      case 'buy-finishedgood': return 'part-buy-finishedgood-v1';
      case 'buy-consumable': return 'part-buy-consumable-v1';
      case 'buy-tool': return 'part-buy-tool-v1';
      // Make combos
      case 'make-component': return 'part-make-component-v1';
      case 'make-subassembly': return 'part-make-subassembly-v1';
      case 'make-finishedgood': return 'part-make-finishedgood-v1';
      case 'make-tool': return 'part-make-tool-v1';
      // Subcontract combos
      case 'subcontract-component': return 'part-subcontract-component-v1';
      case 'subcontract-subassembly': return 'part-subcontract-subassembly-v1';
      // Phantom combos
      case 'phantom-subassembly': return 'part-phantom-subassembly-v1';
      case 'phantom-finishedgood': return 'part-phantom-finishedgood-v1';
      default:
        // Defensive fallback — should never hit because Step-2's filter
        // already excludes non-viable combos. Log loudly so the bug
        // surfaces in CI rather than silently routing to a wrong def.
        throw new Error(`No workflow definition for ${p} + ${c}`);
    }
  }

  private startPartWorkflow(result: NewPartForkResult): void {
    const definitionId = this.workflowDefinitionForCombo(result.procurementSource, result.inventoryClass);
    this.workflowService.startRun({
      entityType: 'Part',
      definitionId,
      mode: result.mode,
      initialEntityData: {
        procurementSource: result.procurementSource,
        inventoryClass: result.inventoryClass,
        itemKindId: result.itemKindId,
      },
    }).subscribe({
      next: (run) => {
        // Deferred materialization: the entity row isn't created at workflow
        // start, so `run.entityId` is null. Land on /parts/new with the
        // runId in the query string; the workflow page upgrades the URL to
        // /parts/{id} once the first step's patch materializes the entity.
        const queryParams: Record<string, string | number> = {
          runId: run.id,
          workflow: definitionId,
          mode: result.mode,
        };
        if (result.mode === 'guided' && run.currentStepId) {
          queryParams['step'] = run.currentStepId;
        }
        this.router.navigate(['/parts', 'new'], { queryParams });
      },
      error: () => this.snackbar.error(this.translate.instant('parts.workflow.startFailed')),
    });
  }

  protected editPart(part: PartDetail): void {
    this.editingPart.set(part);
    this.partForm.patchValue({
      name: part.name,
      description: part.description ?? '',
      revision: part.revision,
      procurementSource: part.procurementSource,
      inventoryClass: part.inventoryClass,
      toolingAssetId: part.toolingAssetId,
      minStockThreshold: part.minStockThreshold,
      reorderPoint: part.reorderPoint,
      reorderQuantity: part.reorderQuantity,
      safetyStockDays: part.safetyStockDays,
      traceabilityType: part.traceabilityType ?? 'None',
      abcClass: part.abcClass ?? null,
    });
    this.showPartDialog.set(true);
  }

  protected closePartDialog(): void {
    this.showPartDialog.set(false);
  }

  protected savePart(): void {
    if (this.partForm.invalid) return;

    // Drop any prior server messages so a re-submit doesn't accumulate.
    // (Phase 3 / WU-02 envelope pattern, mirroring customer-create.)
    FormValidationService.clearServerErrors(this.partForm);

    const form = this.partForm.getRawValue();
    const editing = this.editingPart();

    if (editing) {
      this.partsService.updatePart(editing.id, {
        name: form.name ?? '',
        description: form.description ?? '',
        revision: form.revision ?? 'A',
        procurementSource: (form.procurementSource as ProcurementSource) ?? 'Buy',
        inventoryClass: (form.inventoryClass as InventoryClass) ?? 'Component',
        toolingAssetId: form.toolingAssetId ?? undefined,
        minStockThreshold: form.minStockThreshold ?? undefined,
        reorderPoint: form.reorderPoint ?? undefined,
        reorderQuantity: form.reorderQuantity ?? undefined,
        safetyStockDays: form.safetyStockDays ?? undefined,
        traceabilityType: (form.traceabilityType as TraceabilityType) ?? 'None',
        abcClass: (form.abcClass as AbcClass | null) ?? null,
      }).subscribe({
        next: () => {
          this.closePartDialog();
          this.loadParts();
          this.snackbar.success(this.translate.instant('parts.partUpdated'));
        },
        error: (err: HttpErrorResponse) => {
          // Phase 3 / WU-02 / F6: surface per-field server errors against the
          // form so the validation popover lights up on the offending field
          // (e.g. partType). Legacy non-envelope errors fall through to the
          // central interceptor's snackbar. Keep the dialog open so the user
          // can correct the field rather than losing their input.
          FormValidationService.applyServerError(this.partForm, err);
        },
      });
    } else {
      this.partsService.createPart({
        name: form.name ?? '',
        description: form.description || undefined,
        revision: form.revision || undefined,
        procurementSource: (form.procurementSource as ProcurementSource) ?? 'Buy',
        inventoryClass: (form.inventoryClass as InventoryClass) ?? 'Component',
      }).subscribe({
        next: (detail) => {
          this.closePartDialog();
          this.loadParts();
          this.snackbar.success(this.translate.instant('parts.partCreated'));
          // Open the newly created part's detail dialog
          this.openPartDetail(detail.id);
        },
        error: (err: HttpErrorResponse) => {
          // Phase 3 / WU-02 / F6: see updatePart error handler for details.
          FormValidationService.applyServerError(this.partForm, err);
        },
      });
    }
  }

  // ── Helpers ──

  protected getStatusClass(status: string): string {
    switch (status) {
      case 'Active': return 'status-badge--active';
      case 'Draft': return 'status-badge--draft';
      case 'Prototype': return 'status-badge--prototype';
      case 'Obsolete': return 'status-badge--obsolete';
      default: return '';
    }
  }

  protected setViewMode(mode: ViewMode): void {
    this.router.navigate([], {
      queryParams: { view: mode === 'table' ? null : mode },
      queryParamsHandling: 'merge',
    });
    this.userPreferences.set('parts:viewMode', mode);
  }
}

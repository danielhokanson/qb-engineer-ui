import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { DataTableComponent } from '../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../shared/directives/column-cell.directive';
import { KpiChipComponent } from '../../shared/components/kpi-chip/kpi-chip.component';
import { SelectComponent, SelectOption } from '../../shared/components/select/select.component';
import { ToolbarComponent } from '../../shared/components/toolbar/toolbar.component';
import { SpacerDirective } from '../../shared/directives/spacer.directive';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { LoadingBlockDirective } from '../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../shared/services/snackbar.service';
import { ColumnDef } from '../../shared/models/column-def.model';

import { SchedulingService } from './services/scheduling.service';
import { toDateOnly } from '../../shared/utils/date.utils';
import {
  ScheduleRun,
  ScheduledOperation,
  WorkCenter,
  DispatchListItem,
  WorkCenterLoad,
  Shift,
} from './models/scheduling.model';

type SchedulingTab = 'gantt' | 'dispatch' | 'work-centers' | 'shifts' | 'runs';

const VALID_TABS = new Set<SchedulingTab>(['gantt', 'dispatch', 'work-centers', 'shifts', 'runs']);

@Component({
  selector: 'app-scheduling',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    PageHeaderComponent,
    DataTableComponent,
    ColumnCellDirective,
    KpiChipComponent,
    SelectComponent,
    ToolbarComponent,
    SpacerDirective,
    EmptyStateComponent,
    LoadingBlockDirective,
    TranslatePipe,
  ],
  templateUrl: './scheduling.component.html',
  styleUrl: './scheduling.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchedulingComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly schedulingService = inject(SchedulingService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  // Tab state from URL
  protected readonly activeTab = toSignal(
    this.route.paramMap.pipe(
      map(p => {
        const tab = p.get('tab') as SchedulingTab;
        return VALID_TABS.has(tab) ? tab : 'gantt';
      }),
    ),
    { initialValue: 'gantt' as SchedulingTab },
  );

  // Data signals
  protected readonly ganttOps = signal<ScheduledOperation[]>([]);
  protected readonly workCenters = signal<WorkCenter[]>([]);
  protected readonly shifts = signal<Shift[]>([]);
  protected readonly scheduleRuns = signal<ScheduleRun[]>([]);
  protected readonly dispatchList = signal<DispatchListItem[]>([]);
  protected readonly workCenterLoad = signal<WorkCenterLoad | null>(null);
  protected readonly loading = signal(false);

  // Work center select for dispatch/load
  protected readonly selectedWorkCenterControl = new FormControl<number | null>(null);
  protected readonly workCenterOptions = computed<SelectOption[]>(() =>
    this.workCenters().map(wc => ({ value: wc.id, label: `${wc.code} - ${wc.name}` })),
  );

  // Priority rule options
  protected readonly priorityOptions: SelectOption[] = [
    { value: 'DueDate', label: this.translate.instant('scheduling.priorityRules.dueDate') },
    { value: 'Priority', label: this.translate.instant('scheduling.priorityRules.priority') },
    { value: 'FIFO', label: this.translate.instant('scheduling.priorityRules.fifo') },
  ];

  // KPIs
  protected readonly totalScheduled = computed(() =>
    this.ganttOps().filter(o => o.status === 'Scheduled').length,
  );
  protected readonly totalInProgress = computed(() =>
    this.ganttOps().filter(o => o.status === 'InProgress').length,
  );
  protected readonly totalWorkCenters = computed(() =>
    this.workCenters().filter(wc => wc.isActive).length,
  );

  // Column definitions
  protected readonly ganttColumns: ColumnDef[] = [
    { field: 'jobNumber', header: this.translate.instant('scheduling.cols.jobNumber'), sortable: true, width: '100px' },
    { field: 'operationTitle', header: this.translate.instant('scheduling.cols.operation'), sortable: true },
    { field: 'workCenterName', header: this.translate.instant('scheduling.cols.workCenter'), sortable: true, filterable: true, type: 'text' },
    { field: 'scheduledStart', header: this.translate.instant('scheduling.cols.start'), sortable: true, type: 'date', width: '140px' },
    { field: 'scheduledEnd', header: this.translate.instant('scheduling.cols.end'), sortable: true, type: 'date', width: '140px' },
    { field: 'totalHours', header: this.translate.instant('scheduling.cols.hours'), sortable: true, type: 'number', width: '80px' },
    { field: 'status', header: this.translate.instant('scheduling.cols.status'), sortable: true, filterable: true, type: 'enum', width: '100px',
      filterOptions: [
        { value: 'Scheduled', label: this.translate.instant('scheduling.statuses.scheduled') },
        { value: 'InProgress', label: this.translate.instant('scheduling.statuses.inProgress') },
        { value: 'Complete', label: this.translate.instant('scheduling.statuses.complete') },
      ] },
    { field: 'isLocked', header: this.translate.instant('scheduling.cols.locked'), sortable: true, width: '70px' },
  ];

  protected readonly workCenterColumns: ColumnDef[] = [
    { field: 'code', header: this.translate.instant('scheduling.cols.code'), sortable: true, width: '100px' },
    { field: 'name', header: this.translate.instant('scheduling.cols.name'), sortable: true },
    { field: 'dailyCapacityHours', header: this.translate.instant('scheduling.cols.dailyCap'), sortable: true, type: 'number', width: '120px' },
    { field: 'efficiencyPercent', header: this.translate.instant('scheduling.cols.efficiency'), sortable: true, type: 'number', width: '110px' },
    { field: 'numberOfMachines', header: this.translate.instant('scheduling.cols.machines'), sortable: true, type: 'number', width: '90px' },
    { field: 'isActive', header: this.translate.instant('scheduling.cols.active'), sortable: true, width: '70px' },
    { field: 'assetName', header: this.translate.instant('scheduling.cols.asset'), sortable: true },
    { field: 'locationName', header: this.translate.instant('scheduling.cols.location'), sortable: true },
  ];

  protected readonly shiftColumns: ColumnDef[] = [
    { field: 'name', header: this.translate.instant('scheduling.cols.name'), sortable: true },
    { field: 'startTime', header: this.translate.instant('scheduling.cols.startTime'), sortable: true, width: '100px' },
    { field: 'endTime', header: this.translate.instant('scheduling.cols.endTime'), sortable: true, width: '100px' },
    { field: 'breakMinutes', header: this.translate.instant('scheduling.cols.breakMin'), sortable: true, type: 'number', width: '100px' },
    { field: 'netHours', header: this.translate.instant('scheduling.cols.netHours'), sortable: true, type: 'number', width: '100px' },
    { field: 'isActive', header: this.translate.instant('scheduling.cols.active'), sortable: true, width: '70px' },
  ];

  protected readonly runColumns: ColumnDef[] = [
    { field: 'runDate', header: this.translate.instant('scheduling.cols.runDate'), sortable: true, type: 'date', width: '140px' },
    { field: 'direction', header: this.translate.instant('scheduling.cols.direction'), sortable: true, width: '100px' },
    { field: 'status', header: this.translate.instant('scheduling.cols.status'), sortable: true, filterable: true, type: 'enum', width: '100px',
      filterOptions: [
        { value: 'Completed', label: this.translate.instant('scheduling.statuses.completed') },
        { value: 'Running', label: this.translate.instant('scheduling.statuses.running') },
        { value: 'Failed', label: this.translate.instant('scheduling.statuses.failed') },
      ] },
    { field: 'operationsScheduled', header: this.translate.instant('scheduling.cols.opsScheduled'), sortable: true, type: 'number', width: '120px' },
    { field: 'conflictsDetected', header: this.translate.instant('scheduling.cols.conflicts'), sortable: true, type: 'number', width: '100px' },
    { field: 'completedAt', header: this.translate.instant('scheduling.cols.completed'), sortable: true, type: 'date', width: '140px' },
  ];

  protected readonly dispatchColumns: ColumnDef[] = [
    { field: 'jobNumber', header: this.translate.instant('scheduling.cols.jobNumber'), sortable: true, width: '100px' },
    { field: 'operationTitle', header: this.translate.instant('scheduling.cols.operation'), sortable: true },
    { field: 'sequenceNumber', header: this.translate.instant('scheduling.cols.seq'), sortable: true, type: 'number', width: '60px' },
    { field: 'scheduledStart', header: this.translate.instant('scheduling.cols.start'), sortable: true, type: 'date', width: '140px' },
    { field: 'setupHours', header: this.translate.instant('scheduling.cols.setupHrs'), sortable: true, type: 'number', width: '100px' },
    { field: 'runHours', header: this.translate.instant('scheduling.cols.runHrs'), sortable: true, type: 'number', width: '100px' },
    { field: 'priority', header: this.translate.instant('scheduling.cols.priority'), sortable: true, width: '90px' },
    { field: 'jobDueDate', header: this.translate.instant('scheduling.cols.dueDate'), sortable: true, type: 'date', width: '120px' },
  ];

  constructor() {
    // Load work centers on init (needed for dispatch selector)
    this.loadWorkCenters();

    // Lazy load tab data
    effect(() => {
      const tab = this.activeTab();
      switch (tab) {
        case 'gantt':
          this.loadGanttData();
          break;
        case 'work-centers':
          this.loadWorkCenters();
          break;
        case 'shifts':
          this.loadShifts();
          break;
        case 'runs':
          this.loadRuns();
          break;
        case 'dispatch':
          // Loaded when work center is selected
          break;
      }
    });
  }

  protected switchTab(tab: string): void {
    this.router.navigate(['..', tab], { relativeTo: this.route });
  }

  // Data loading
  private loadGanttData(): void {
    this.loading.set(true);
    const now = new Date();
    // DateOnly query params; toDateOnly takes the local calendar date.
    const from = toDateOnly(now)!;
    const to = toDateOnly(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))!;
    this.schedulingService.getGanttData(from, to).subscribe({
      next: ops => { this.ganttOps.set(ops); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private loadWorkCenters(): void {
    this.schedulingService.getWorkCenters().subscribe({
      next: wcs => this.workCenters.set(wcs),
    });
  }

  private loadShifts(): void {
    this.loading.set(true);
    this.schedulingService.getShifts().subscribe({
      next: s => { this.shifts.set(s); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private loadRuns(): void {
    this.loading.set(true);
    this.schedulingService.getScheduleRuns().subscribe({
      next: r => { this.scheduleRuns.set(r); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  protected loadDispatch(): void {
    const wcId = this.selectedWorkCenterControl.value;
    if (!wcId) return;
    this.loading.set(true);
    this.schedulingService.getDispatchList(wcId).subscribe({
      next: d => { this.dispatchList.set(d); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  // Actions
  protected executeSchedule(): void {
    const now = new Date();
    const from = toDateOnly(now)!;
    const to = toDateOnly(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))!;

    this.schedulingService.runScheduler({
      direction: 'Forward',
      scheduleFrom: from,
      scheduleTo: to,
      priorityRule: 'DueDate',
    }).subscribe({
      next: run => {
        this.snackbar.success(`${this.translate.instant('scheduling.snackbar.scheduled')} ${run.operationsScheduled} ${this.translate.instant('scheduling.snackbar.operations')}`);
        this.loadGanttData();
        this.loadRuns();
      },
    });
  }

  protected toggleLock(op: ScheduledOperation): void {
    this.schedulingService.lockOperation(op.id, !op.isLocked).subscribe({
      next: () => {
        this.snackbar.success(op.isLocked ? this.translate.instant('scheduling.snackbar.unlocked') : this.translate.instant('scheduling.snackbar.locked'));
        this.loadGanttData();
      },
    });
  }

  protected getStatusClass(status: string): string {
    switch (status) {
      case 'Scheduled': return 'chip chip--info';
      case 'InProgress': return 'chip chip--warning';
      case 'Complete': return 'chip chip--success';
      case 'Cancelled': return 'chip chip--muted';
      case 'Completed': return 'chip chip--success';
      case 'Running': return 'chip chip--warning';
      case 'Failed': return 'chip chip--error';
      default: return 'chip';
    }
  }
}

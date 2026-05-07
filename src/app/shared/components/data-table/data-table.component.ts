import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  contentChildren,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OverlayModule } from '@angular/cdk/overlay';

import { unparse } from 'papaparse';
import { TranslatePipe } from '@ngx-translate/core';

import { ColumnDef } from '../../models/column-def.model';
import { SortState } from '../../models/sort-state.model';
import { TablePreferences } from '../../models/table-preferences.model';
import { ColumnCellDirective } from '../../directives/column-cell.directive';
import { RowExpandDirective } from '../../directives/row-expand.directive';
import { LoadingBlockDirective } from '../../directives/loading-block.directive';
import { EmptyStateComponent } from '../empty-state/empty-state.component';
import { ColumnFilterPopoverComponent, ColumnFilterState } from './column-filter-popover/column-filter-popover.component';
import { ColumnManagerPanelComponent, ColumnManagerState } from './column-manager-panel/column-manager-panel.component';
import { UserPreferencesService } from '../../services/user-preferences.service';
import { formatDateTime } from '../../utils/date.utils';

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    MatCheckboxModule,
    MatDividerModule,
    MatMenuModule,
    MatPaginatorModule,
    MatTooltipModule,
    OverlayModule,
    LoadingBlockDirective,
    EmptyStateComponent,
    ColumnFilterPopoverComponent,
    ColumnManagerPanelComponent,
    TranslatePipe,
  ],
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent implements OnInit {
  private readonly prefs = inject(UserPreferencesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tableId = input.required<string>();
  readonly columns = input.required<ColumnDef[]>();
  readonly data = input.required<unknown[]>();
  readonly selectable = input(false);
  readonly trackByField = input('id');
  readonly emptyIcon = input('search_off');
  readonly emptyMessage = input('No data found');
  readonly emptyHelpText = input<string>();
  readonly expandable = input(false);
  readonly loading = input(false);
  readonly stickyFirstColumn = input(false);
  readonly clickableRows = input(false);
  readonly rowClass = input<((row: unknown) => string) | null>(null);
  readonly rowStyle = input<((row: unknown) => Record<string, string>) | null>(null);
  /**
   * Optional predicate for rows that should always render at the top of the
   * table, ignoring the user's sort. Use for "drafts" / "pending" / "starred"
   * affordances where in-progress items should stay in the user's scan path
   * regardless of the active sort column. Returns true → row pins to top.
   */
  readonly pinPredicate = input<((row: unknown) => boolean) | null>(null);

  readonly rowClick = output<unknown>();
  readonly selectionChange = output<unknown[]>();

  readonly cellTemplates = contentChildren(ColumnCellDirective);
  readonly expandTemplate = contentChild(RowExpandDirective);

  protected readonly sortStates = signal<SortState[]>([]);
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(25);
  protected readonly selectedRows = signal<Set<unknown>>(new Set());
  protected readonly columnVisibility = signal<Record<string, boolean>>({});
  protected readonly columnOrder = signal<string[]>([]);
  protected readonly columnWidths = signal<Record<string, string>>({});
  protected readonly filters = signal<Record<string, unknown>>({});

  protected readonly filterOpenField = signal<string | null>(null);
  protected readonly columnManagerOpen = signal(false);
  protected readonly contextMenuPosition = signal({ x: 0, y: 0 });
  protected readonly contextMenuCol = signal<ColumnDef | null>(null);
  protected readonly contextMenuTrigger = viewChild<MatMenuTrigger>('contextMenuTrigger');
  protected resizingField: string | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly orderedColumns = computed(() => {
    const cols = this.columns();
    const order = this.columnOrder();
    if (!order.length) return cols;

    const colMap = new Map(cols.map(c => [c.field, c]));
    const ordered: ColumnDef[] = [];
    for (const field of order) {
      const col = colMap.get(field);
      if (col) ordered.push(col);
    }
    // Append any new columns not in saved order
    for (const col of cols) {
      if (!order.includes(col.field)) ordered.push(col);
    }
    return ordered;
  });

  protected readonly visibleColumns = computed(() => {
    const vis = this.columnVisibility();
    return this.orderedColumns().filter(col => {
      if (col.field in vis) return vis[col.field];
      return col.visible !== false;
    });
  });

  protected readonly filteredData = computed(() => {
    const data = this.data();
    const activeFilters = this.filters();
    const filterKeys = Object.keys(activeFilters);
    if (!filterKeys.length) return data;

    return data.filter(row => {
      const rec = row as Record<string, unknown>;
      return filterKeys.every(field => {
        const filterVal = activeFilters[field];
        if (filterVal == null) return true;

        const col = this.columns().find(c => c.field === field);
        const cellVal = rec[field];
        const type = col?.type ?? 'text';

        switch (type) {
          case 'text': {
            // filterVal can be a plain string (legacy "contains") or
            // { mode, value } from the new match-mode picker. Back-compat
            // treats a bare string as contains.
            const cell = cellVal == null ? '' : String(cellVal).toLowerCase();
            let needle: string;
            let mode: string;
            if (typeof filterVal === 'string') {
              needle = filterVal.toLowerCase();
              mode = 'contains';
            } else {
              const tv = filterVal as { mode?: string; value?: string };
              needle = (tv.value ?? '').toLowerCase();
              mode = tv.mode ?? 'contains';
            }
            if (!needle) return true;
            switch (mode) {
              case 'equals': return cell === needle;
              case 'startsWith': return cell.startsWith(needle);
              case 'endsWith': return cell.endsWith(needle);
              case 'notContains': return !cell.includes(needle);
              case 'notEquals': return cell !== needle;
              case 'contains':
              default: return cell.includes(needle);
            }
          }
          case 'number': {
            const range = filterVal as { min?: number; max?: number };
            const num = Number(cellVal);
            if (range.min != null && num < range.min) return false;
            if (range.max != null && num > range.max) return false;
            return true;
          }
          case 'date': {
            const range = filterVal as { from?: Date; to?: Date };
            const date = cellVal ? new Date(cellVal as string) : null;
            if (!date) return false;
            if (range.from && date < range.from) return false;
            if (range.to && date > range.to) return false;
            return true;
          }
          case 'enum': {
            const allowed = filterVal as unknown[];
            return allowed.includes(cellVal);
          }
          default:
            return true;
        }
      });
    });
  });

  protected readonly sortedData = computed(() => {
    const allData = [...this.filteredData()];
    const sorts = this.sortStates();
    const pin = this.pinPredicate();

    // Partition pinned rows out so they always render at the top regardless
    // of the active sort. Pinned rows preserve their incoming order; the
    // un-pinned rows go through the normal sort below.
    const pinned: unknown[] = [];
    const data: unknown[] = [];
    if (pin) {
      for (const row of allData) (pin(row) ? pinned : data).push(row);
    } else {
      data.push(...allData);
    }

    if (!sorts.length) return [...pinned, ...data];

    const columns = this.columns();
    const resolvers = new Map<string, (row: unknown) => unknown>();
    for (const sort of sorts) {
      const col = columns.find(c => c.field === sort.field);
      if (col?.sortValue) {
        resolvers.set(sort.field, col.sortValue);
      } else if (col?.sortField) {
        const key = col.sortField;
        resolvers.set(sort.field, row => (row as Record<string, unknown>)[key]);
      } else {
        resolvers.set(sort.field, row => (row as Record<string, unknown>)[sort.field]);
      }
    }

    const sorted = data.sort((a, b) => {
      for (const sort of sorts) {
        const resolve = resolvers.get(sort.field)!;
        const valA = resolve(a);
        const valB = resolve(b);

        let comparison: number;
        if (valA == null && valB == null) comparison = 0;
        else if (valA == null) comparison = -1;
        else if (valB == null) comparison = 1;
        else if (typeof valA === 'string' && typeof valB === 'string') comparison = valA.localeCompare(valB);
        else comparison = valA < valB ? -1 : valA > valB ? 1 : 0;

        if (comparison !== 0) {
          return sort.direction === 'desc' ? -comparison : comparison;
        }
      }
      return 0;
    });

    return [...pinned, ...sorted];
  });

  protected readonly pagedData = computed(() => {
    const all = this.sortedData();
    const start = this.pageIndex() * this.pageSize();
    return all.slice(start, start + this.pageSize());
  });

  protected readonly allSelected = computed(() => {
    const data = this.pagedData();
    if (!data.length) return false;
    const selected = this.selectedRows();
    return data.every(row => selected.has(this.getTrackValue(row)));
  });

  protected readonly someSelected = computed(() => {
    const data = this.pagedData();
    const selected = this.selectedRows();
    const count = data.filter(row => selected.has(this.getTrackValue(row))).length;
    return count > 0 && count < data.length;
  });

  protected readonly activeFilterCount = computed(() =>
    Object.keys(this.filters()).length
  );

  protected readonly expandedRows = signal<Set<unknown>>(new Set());

  protected readonly stickyLeftOffset = computed(() => {
    let offset = 0;
    if (this.expandable()) offset += 32;
    if (this.selectable()) offset += 40;
    return offset;
  });

  protected readonly totalColSpan = computed(() => {
    let count = this.visibleColumns().length + 1; // +1 for gear column
    if (this.selectable()) count++;
    if (this.expandable()) count++;
    return count;
  });

  ngOnInit(): void {
    this.loadPreferences();
  }

  getCellTemplate(field: string): TemplateRef<unknown> | null {
    const directive = this.cellTemplates().find(d => d.field() === field);
    return directive?.template ?? null;
  }

  getRowClasses(row: unknown): string {
    const fn = this.rowClass();
    return fn ? fn(row) : '';
  }

  getRowStyles(row: unknown): Record<string, string> {
    const fn = this.rowStyle();
    return fn ? fn(row) : {};
  }

  formatCellValue(row: unknown, col: ColumnDef): unknown {
    const val = (row as Record<string, unknown>)[col.field];
    if (col.type === 'date' && val) {
      return formatDateTime(val as string | Date);
    }
    return val;
  }

  getColumnWidth(col: ColumnDef): string | null {
    return this.columnWidths()[col.field] ?? col.width ?? null;
  }

  getSortState(field: string): SortState | undefined {
    return this.sortStates().find(s => s.field === field);
  }

  hasFilter(field: string): boolean {
    return field in this.filters();
  }

  onHeaderClick(col: ColumnDef, event: MouseEvent): void {
    if (!col.sortable) return;

    const current = this.sortStates();
    const existing = current.find(s => s.field === col.field);

    if (event.shiftKey) {
      if (existing) {
        if (existing.direction === 'asc') {
          this.sortStates.set(
            current.map(s => s.field === col.field ? { ...s, direction: 'desc' as const } : s)
          );
        } else {
          this.sortStates.set(current.filter(s => s.field !== col.field));
        }
      } else {
        this.sortStates.set([...current, { field: col.field, direction: 'asc' }]);
      }
    } else {
      if (existing) {
        if (existing.direction === 'asc') {
          this.sortStates.set([{ field: col.field, direction: 'desc' }]);
        } else {
          this.sortStates.set([]);
        }
      } else {
        this.sortStates.set([{ field: col.field, direction: 'asc' }]);
      }
    }
    this.debouncedSave();
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.debouncedSave();
  }

  onRowClick(row: unknown): void {
    this.rowClick.emit(row);
  }

  toggleSelectAll(): void {
    const data = this.pagedData();
    const selected = new Set(this.selectedRows());

    if (this.allSelected()) {
      data.forEach(row => selected.delete(this.getTrackValue(row)));
    } else {
      data.forEach(row => selected.add(this.getTrackValue(row)));
    }

    this.selectedRows.set(selected);
    this.selectionChange.emit(this.getSelectedData());
  }

  toggleRowSelection(row: unknown, event: Event): void {
    event.stopPropagation();
    const key = this.getTrackValue(row);
    const selected = new Set(this.selectedRows());

    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }

    this.selectedRows.set(selected);
    this.selectionChange.emit(this.getSelectedData());
  }

  isRowSelected(row: unknown): boolean {
    return this.selectedRows().has(this.getTrackValue(row));
  }

  trackByFn(_index: number, row: unknown): unknown {
    return this.getTrackValue(row);
  }

  // ─── Expandable Rows ───
  toggleRowExpand(row: unknown, event?: Event): void {
    event?.stopPropagation();
    const key = this.getTrackValue(row);
    const expanded = new Set(this.expandedRows());
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
    }
    this.expandedRows.set(expanded);
  }

  isRowExpanded(row: unknown): boolean {
    return this.expandedRows().has(this.getTrackValue(row));
  }

  // ─── CSV Export ───
  exportCsv(): void {
    const cols = this.visibleColumns();
    const rows = this.filteredData().map(row => {
      const rec = row as Record<string, unknown>;
      const mapped: Record<string, unknown> = {};
      for (const col of cols) {
        mapped[col.header] = rec[col.field] ?? '';
      }
      return mapped;
    });

    const csv = unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.tableId()}-export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ─── Filter ───
  openFilter(field: string, event: Event): void {
    event.stopPropagation();
    this.filterOpenField.set(this.filterOpenField() === field ? null : field);
  }

  onFilterApplied(state: ColumnFilterState): void {
    const current = { ...this.filters() };
    current[state.field] = state.value;
    this.filters.set(current);
    this.pageIndex.set(0);
    this.debouncedSave();
  }

  onFilterCleared(field: string): void {
    const current = { ...this.filters() };
    delete current[field];
    this.filters.set(current);
    this.pageIndex.set(0);
    this.debouncedSave();
  }

  closeFilter(): void {
    this.filterOpenField.set(null);
  }

  // ─── Column Manager ───
  toggleColumnManager(event: Event): void {
    event.stopPropagation();
    this.columnManagerOpen.update(v => !v);
  }

  onColumnManagerChange(state: ColumnManagerState): void {
    this.columnVisibility.set(state.visibility);
    this.columnOrder.set(state.order);
    this.debouncedSave();
  }

  onColumnManagerReset(): void {
    this.columnVisibility.set({});
    this.columnOrder.set(this.columns().map(c => c.field));
    this.columnWidths.set({});
    this.sortStates.set([]);
    this.filters.set({});
    this.pageSize.set(25);
    this.pageIndex.set(0);
    this.prefs.reset(`table:${this.tableId()}`);
  }

  closeColumnManager(): void {
    this.columnManagerOpen.set(false);
  }

  // ─── Context Menu ───
  onHeaderContextMenu(col: ColumnDef, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuPosition.set({ x: event.clientX, y: event.clientY });
    this.contextMenuCol.set(col);
    this.contextMenuTrigger()?.openMenu();
  }

  contextSortAsc(): void {
    const col = this.contextMenuCol();
    if (!col) return;
    this.sortStates.set([{ field: col.field, direction: 'asc' }]);
    this.debouncedSave();
  }

  contextSortDesc(): void {
    const col = this.contextMenuCol();
    if (!col) return;
    this.sortStates.set([{ field: col.field, direction: 'desc' }]);
    this.debouncedSave();
  }

  contextClearSort(): void {
    const col = this.contextMenuCol();
    if (!col) return;
    this.sortStates.update(sorts => sorts.filter(s => s.field !== col.field));
    this.debouncedSave();
  }

  contextFilter(): void {
    const col = this.contextMenuCol();
    if (!col) return;
    this.filterOpenField.set(col.field);
  }

  contextClearFilter(): void {
    const col = this.contextMenuCol();
    if (!col) return;
    this.onFilterCleared(col.field);
  }

  contextClearAllFilters(): void {
    this.filters.set({});
    this.pageIndex.set(0);
    this.debouncedSave();
  }

  contextHideColumn(): void {
    const col = this.contextMenuCol();
    if (!col) return;
    const vis = { ...this.columnVisibility() };
    vis[col.field] = false;
    this.columnVisibility.set(vis);
    this.debouncedSave();
  }

  contextResetWidth(): void {
    const col = this.contextMenuCol();
    if (!col) return;
    const widths = { ...this.columnWidths() };
    delete widths[col.field];
    this.columnWidths.set(widths);
    this.debouncedSave();
  }

  // ─── Column Resize ───
  onResizeStart(field: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizingField = field;
    this.resizeStartX = event.clientX;

    const th = (event.target as HTMLElement).closest('th');
    this.resizeStartWidth = th ? th.offsetWidth : 100;

    const onMouseMove = (e: MouseEvent) => {
      if (!this.resizingField) return;
      const diff = e.clientX - this.resizeStartX;
      const newWidth = Math.max(50, this.resizeStartWidth + diff);
      const widths = { ...this.columnWidths() };
      widths[this.resizingField] = `${newWidth}px`;
      this.columnWidths.set(widths);
    };

    const onMouseUp = () => {
      this.resizingField = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this.debouncedSave();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  onResizeDoubleClick(field: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const widths = { ...this.columnWidths() };
    delete widths[field];
    this.columnWidths.set(widths);
    this.debouncedSave();
  }

  // ─── Preferences ───
  private loadPreferences(): void {
    const saved = this.prefs.get<TablePreferences>(`table:${this.tableId()}`);
    if (!saved) {
      this.columnOrder.set(this.columns().map(c => c.field));
      return;
    }

    if (saved.columnVisibility) this.columnVisibility.set(saved.columnVisibility);
    if (saved.columnOrder?.length) this.columnOrder.set(saved.columnOrder);
    else this.columnOrder.set(this.columns().map(c => c.field));
    if (saved.columnWidths) this.columnWidths.set(saved.columnWidths);
    if (saved.sortState) this.sortStates.set(saved.sortState);
    if (saved.pageSize) this.pageSize.set(saved.pageSize);
    if (saved.filters) this.filters.set(saved.filters);
  }

  private savePreferences(): void {
    const prefs: TablePreferences = {
      columnVisibility: this.columnVisibility(),
      columnOrder: this.columnOrder(),
      columnWidths: this.columnWidths(),
      sortState: this.sortStates(),
      pageSize: this.pageSize(),
      filters: this.filters(),
    };
    this.prefs.set(`table:${this.tableId()}`, prefs);
  }

  private debouncedSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.savePreferences(), 500);
  }

  private getTrackValue(row: unknown): unknown {
    return (row as Record<string, unknown>)[this.trackByField()];
  }

  private getSelectedData(): unknown[] {
    const selected = this.selectedRows();
    return this.data().filter(row => selected.has(this.getTrackValue(row)));
  }
}

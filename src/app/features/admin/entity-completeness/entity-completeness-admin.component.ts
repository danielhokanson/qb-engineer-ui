import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged } from 'rxjs';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PageLayoutComponent } from '../../../shared/components/page-layout/page-layout.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../shared/components/select/select.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../shared/models/column-def.model';
import { ToolbarComponent } from '../../../shared/components/toolbar/toolbar.component';
import { SpacerDirective } from '../../../shared/directives/spacer.directive';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnackbarService } from '../../../shared/services/snackbar.service';

import { EntityCapabilityRequirementService } from '../services/entity-capability-requirement.service';
import { EntityCapabilityRequirementResponseModel } from '../models/entity-capability-requirement.model';
import { EntityCapabilityRequirementDialogComponent } from './entity-capability-requirement-dialog/entity-capability-requirement-dialog.component';

/**
 * Admin CRUD page for entity-capability requirement rows. The catalog ships
 * empty (per the Phase 4 / completeness-feature design choice) — admins
 * author rows here that the server-side completeness evaluator runs against
 * Vendor / Part / Customer rows.
 *
 * Filters: by entity type and by capability code. Free-text capability
 * filter for now; a typeahead against the capability catalog is a follow-up.
 *
 * URL: `/admin/entity-completeness` (lazy-loaded via `admin.routes.ts`).
 */
@Component({
  selector: 'app-entity-completeness-admin',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatTooltipModule,
    TranslatePipe,
    PageLayoutComponent,
    InputComponent, SelectComponent,
    DataTableComponent, ColumnCellDirective,
    ToolbarComponent, SpacerDirective,
    LoadingBlockDirective,
    EntityCapabilityRequirementDialogComponent,
  ],
  templateUrl: './entity-completeness-admin.component.html',
  styleUrl: './entity-completeness-admin.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityCompletenessAdminComponent {
  private readonly service = inject(EntityCapabilityRequirementService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  protected readonly loading = signal(false);
  protected readonly rows = signal<EntityCapabilityRequirementResponseModel[]>([]);

  // Filters
  protected readonly entityTypeFilterControl = new FormControl<string | null>(null);
  protected readonly capabilityCodeFilterControl = new FormControl<string>('');

  protected readonly entityTypeOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('common.all') },
    { value: 'Vendor', label: 'Vendor' },
    { value: 'Part', label: 'Part' },
    { value: 'Customer', label: 'Customer' },
  ];

  // Dialog
  protected readonly showDialog = signal(false);
  protected readonly editingRow = signal<EntityCapabilityRequirementResponseModel | null>(null);

  protected readonly columns: ColumnDef[] = [
    { field: 'entityType', header: this.translate.instant('admin.entityCompleteness.col.entityType'), sortable: true, width: '110px' },
    { field: 'capabilityCode', header: this.translate.instant('admin.entityCompleteness.col.capabilityCode'), sortable: true, width: '180px' },
    { field: 'requirementId', header: this.translate.instant('admin.entityCompleteness.col.requirementId'), sortable: true, width: '160px' },
    { field: 'displayNameKey', header: this.translate.instant('admin.entityCompleteness.col.displayNameKey'), sortable: true },
    { field: 'missingMessageKey', header: this.translate.instant('admin.entityCompleteness.col.missingMessageKey'), sortable: true },
    { field: 'sortOrder', header: this.translate.instant('admin.entityCompleteness.col.sortOrder'), sortable: true, width: '80px', align: 'right', type: 'number' },
    { field: 'actions', header: '', width: '90px', align: 'right' },
  ];

  constructor() {
    this.load();

    this.entityTypeFilterControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.load());

    this.capabilityCodeFilterControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.load());
  }

  protected load(): void {
    this.loading.set(true);
    const entityType = this.entityTypeFilterControl.value ?? undefined;
    const capabilityCode = (this.capabilityCodeFilterControl.value ?? '').trim() || undefined;
    this.service.list(entityType, capabilityCode).subscribe({
      next: (list) => {
        this.rows.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openCreate(): void {
    this.editingRow.set(null);
    this.showDialog.set(true);
  }

  protected openEdit(row: EntityCapabilityRequirementResponseModel): void {
    this.editingRow.set(row);
    this.showDialog.set(true);
  }

  protected closeDialog(): void {
    this.showDialog.set(false);
  }

  protected onSaved(): void {
    this.closeDialog();
    this.load();
  }

  protected deleteRow(row: EntityCapabilityRequirementResponseModel): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: this.translate.instant('admin.entityCompleteness.confirmDelete.title'),
        message: this.translate.instant('admin.entityCompleteness.confirmDelete.message', {
          requirementId: row.requirementId,
        }),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.service.delete(row.id).subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('common.deleted'));
          this.load();
        },
      });
    });
  }
}

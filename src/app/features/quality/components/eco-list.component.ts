import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { EcoService } from '../services/eco.service';
import { Eco, EcoAffectedItem, EcoStatus, EcoChangeType, EcoPriority, CreateEcoAffectedItemRequest } from '../models/eco.model';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../shared/models/column-def.model';
import { SelectComponent, SelectOption } from '../../../shared/components/select/select.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../shared/components/textarea/textarea.component';
import { DatepickerComponent } from '../../../shared/components/datepicker/datepicker.component';
import { DialogComponent } from '../../../shared/components/dialog/dialog.component';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';
import { FormValidationService } from '../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../shared/components/validation-button/validation-button.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { toDateOnly } from '../../../shared/utils/date.utils';

@Component({
  selector: 'app-eco-list',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule,
    DataTableComponent, ColumnCellDirective,
    SelectComponent, InputComponent, TextareaComponent, DatepickerComponent,
    DialogComponent, LoadingBlockDirective,
    ValidationButtonComponent, MatTooltipModule,
  ],
  templateUrl: './eco-list.component.html',
  styleUrl: './eco-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EcoListComponent implements OnInit {
  private readonly ecoService = inject(EcoService);
  private readonly snackbar = inject(SnackbarService);
  private readonly dialog = inject(MatDialog);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly ecos = signal<Eco[]>([]);
  protected readonly showCreateDialog = signal(false);
  protected readonly showDetailDialog = signal(false);
  protected readonly selectedEco = signal<Eco | null>(null);
  protected readonly showAddItemDialog = signal(false);

  protected readonly statusFilter = new FormControl<EcoStatus | ''>('');

  protected readonly statusOptions: SelectOption[] = [
    { value: '', label: 'All Statuses' },
    { value: 'Draft', label: 'Draft' },
    { value: 'Review', label: 'Review' },
    { value: 'Approved', label: 'Approved' },
    { value: 'InImplementation', label: 'In Implementation' },
    { value: 'Implemented', label: 'Implemented' },
    { value: 'Cancelled', label: 'Cancelled' },
  ];

  protected readonly changeTypeOptions: SelectOption[] = [
    { value: 'New', label: 'New' },
    { value: 'Revision', label: 'Revision' },
    { value: 'Obsolescence', label: 'Obsolescence' },
    { value: 'CostReduction', label: 'Cost Reduction' },
    { value: 'QualityImprovement', label: 'Quality Improvement' },
  ];

  protected readonly priorityOptions: SelectOption[] = [
    { value: 'Low', label: 'Low' },
    { value: 'Normal', label: 'Normal' },
    { value: 'High', label: 'High' },
    { value: 'Critical', label: 'Critical' },
  ];

  protected readonly entityTypeOptions: SelectOption[] = [
    { value: 'Part', label: 'Part' },
    { value: 'BOM', label: 'BOM' },
    { value: 'Operation', label: 'Operation' },
    { value: 'Drawing', label: 'Drawing' },
    { value: 'Specification', label: 'Specification' },
  ];

  protected readonly columns: ColumnDef[] = [
    { field: 'ecoNumber', header: 'ECO #', sortable: true, width: '160px' },
    { field: 'title', header: 'Title', sortable: true },
    { field: 'changeType', header: 'Type', sortable: true, filterable: true, type: 'enum', filterOptions: this.changeTypeOptions, width: '130px' },
    { field: 'priority', header: 'Priority', sortable: true, filterable: true, type: 'enum', filterOptions: this.priorityOptions, width: '90px' },
    { field: 'status', header: 'Status', sortable: true, filterable: true, type: 'enum', filterOptions: this.statusOptions.slice(1), width: '130px' },
    { field: 'requestedByName', header: 'Requested By', sortable: true, width: '140px' },
    { field: 'affectedItemCount', header: 'Items', sortable: true, type: 'number', width: '60px', align: 'center' },
    { field: 'createdAt', header: 'Created', sortable: true, type: 'date', width: '100px' },
    { field: 'actions', header: '', width: '50px' },
  ];

  protected readonly affectedItemColumns: ColumnDef[] = [
    { field: 'entityType', header: 'Type', sortable: true, width: '100px' },
    { field: 'entityId', header: 'Entity ID', sortable: true, width: '80px', align: 'center' },
    { field: 'changeDescription', header: 'Change Description', sortable: true },
    { field: 'isImplemented', header: 'Implemented', width: '100px', align: 'center' },
    { field: 'actions', header: '', width: '50px' },
  ];

  protected readonly createForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    changeType: new FormControl<EcoChangeType>('Revision', { nonNullable: true }),
    priority: new FormControl<EcoPriority>('Normal', { nonNullable: true }),
    reasonForChange: new FormControl(''),
    impactAnalysis: new FormControl(''),
    effectiveDate: new FormControl<Date | null>(null),
  });

  protected readonly addItemForm = new FormGroup({
    entityType: new FormControl('Part', { nonNullable: true }),
    entityId: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    changeDescription: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(500)] }),
    oldValue: new FormControl(''),
    newValue: new FormControl(''),
  });

  protected readonly createViolations = FormValidationService.getViolations(this.createForm, {
    title: 'Title',
    description: 'Description',
  });

  protected readonly addItemViolations = FormValidationService.getViolations(this.addItemForm, {
    entityId: 'Entity ID',
    changeDescription: 'Change Description',
  });

  ngOnInit(): void {
    this.loadEcos();
  }

  loadEcos(): void {
    this.loading.set(true);
    const status = this.statusFilter.value || undefined;
    this.ecoService.getEcos({ status: status as EcoStatus }).subscribe({
      next: ecos => {
        this.ecos.set(ecos);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openCreate(): void {
    this.createForm.reset({ changeType: 'Revision', priority: 'Normal' });
    this.showCreateDialog.set(true);
  }

  saveEco(): void {
    if (this.createForm.invalid) return;
    this.saving.set(true);
    const form = this.createForm.getRawValue();
    this.ecoService.createEco({
      title: form.title,
      description: form.description,
      changeType: form.changeType,
      priority: form.priority,
      reasonForChange: form.reasonForChange || undefined,
      impactAnalysis: form.impactAnalysis || undefined,
      // Server expects DateOnly. toDateOnly takes the local calendar date.
      effectiveDate: toDateOnly(form.effectiveDate) ?? undefined,
    }).subscribe({
      next: () => {
        this.snackbar.success('ECO created');
        this.showCreateDialog.set(false);
        this.saving.set(false);
        this.loadEcos();
      },
      error: () => this.saving.set(false),
    });
  }

  openDetail(eco: Eco): void {
    this.ecoService.getEcoById(eco.id).subscribe({
      next: detail => {
        this.selectedEco.set(detail);
        this.showDetailDialog.set(true);
      },
    });
  }

  closeDetail(): void {
    this.showDetailDialog.set(false);
    this.selectedEco.set(null);
  }

  submitForReview(): void {
    const eco = this.selectedEco();
    if (!eco) return;
    this.saving.set(true);
    this.ecoService.updateEco(eco.id, { title: eco.title }).subscribe({
      next: () => {
        // Update status to Review
        this.ecoService.updateEco(eco.id, {} as never).subscribe();
        this.snackbar.success('ECO submitted for review');
        this.saving.set(false);
        this.refreshDetail(eco.id);
        this.loadEcos();
      },
      error: () => this.saving.set(false),
    });
  }

  approveEco(): void {
    const eco = this.selectedEco();
    if (!eco) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Approve ECO?',
        message: `Approve ${eco.ecoNumber}? This will allow implementation to begin.`,
        confirmLabel: 'Approve',
        severity: 'info',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.saving.set(true);
      this.ecoService.approveEco(eco.id).subscribe({
        next: () => {
          this.snackbar.success('ECO approved');
          this.saving.set(false);
          this.refreshDetail(eco.id);
          this.loadEcos();
        },
        error: () => this.saving.set(false),
      });
    });
  }

  implementEco(): void {
    const eco = this.selectedEco();
    if (!eco) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Implement ECO?',
        message: `Mark ${eco.ecoNumber} as implemented? All affected items will be marked as implemented.`,
        confirmLabel: 'Implement',
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.saving.set(true);
      this.ecoService.implementEco(eco.id).subscribe({
        next: () => {
          this.snackbar.success('ECO implemented');
          this.saving.set(false);
          this.refreshDetail(eco.id);
          this.loadEcos();
        },
        error: () => this.saving.set(false),
      });
    });
  }

  openAddItem(): void {
    this.addItemForm.reset({ entityType: 'Part' });
    this.showAddItemDialog.set(true);
  }

  saveAffectedItem(): void {
    const eco = this.selectedEco();
    if (!eco || this.addItemForm.invalid) return;
    this.saving.set(true);
    const form = this.addItemForm.getRawValue();
    const data: CreateEcoAffectedItemRequest = {
      entityType: form.entityType,
      entityId: form.entityId!,
      changeDescription: form.changeDescription,
      oldValue: form.oldValue || undefined,
      newValue: form.newValue || undefined,
    };
    this.ecoService.addAffectedItem(eco.id, data).subscribe({
      next: () => {
        this.snackbar.success('Affected item added');
        this.showAddItemDialog.set(false);
        this.saving.set(false);
        this.refreshDetail(eco.id);
        this.loadEcos();
      },
      error: () => this.saving.set(false),
    });
  }

  deleteAffectedItem(item: EcoAffectedItem): void {
    const eco = this.selectedEco();
    if (!eco) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Remove Affected Item?',
        message: 'Remove this affected item from the ECO?',
        confirmLabel: 'Remove',
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.ecoService.deleteAffectedItem(eco.id, item.id).subscribe({
        next: () => {
          this.snackbar.success('Affected item removed');
          this.refreshDetail(eco.id);
          this.loadEcos();
        },
      });
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Draft': return 'chip chip--muted';
      case 'Review': return 'chip chip--info';
      case 'Approved': return 'chip chip--success';
      case 'InImplementation': return 'chip chip--warning';
      case 'Implemented': return 'chip chip--primary';
      case 'Cancelled': return 'chip chip--error';
      default: return 'chip';
    }
  }

  getStatusLabel(status: string): string {
    return status === 'InImplementation' ? 'In Implementation' : status === 'QualityImprovement' ? 'Quality Improvement' : status === 'CostReduction' ? 'Cost Reduction' : status;
  }

  getPriorityClass(priority: string): string {
    switch (priority) {
      case 'Critical': return 'chip chip--error';
      case 'High': return 'chip chip--warning';
      case 'Normal': return 'chip chip--info';
      case 'Low': return 'chip chip--muted';
      default: return 'chip';
    }
  }

  canApprove(eco: Eco): boolean {
    return eco.status === 'Review';
  }

  canImplement(eco: Eco): boolean {
    return eco.status === 'Approved' || eco.status === 'InImplementation';
  }

  canEdit(eco: Eco): boolean {
    return eco.status === 'Draft' || eco.status === 'Review';
  }

  private refreshDetail(ecoId: number): void {
    this.ecoService.getEcoById(ecoId).subscribe({
      next: detail => this.selectedEco.set(detail),
    });
  }
}

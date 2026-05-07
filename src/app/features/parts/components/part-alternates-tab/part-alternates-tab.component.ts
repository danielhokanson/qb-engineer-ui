import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PartsService } from '../../services/parts.service';
import { PartAlternate, AlternateType, CreatePartAlternateRequest } from '../../models/part-alternate.model';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { EntityPickerComponent } from '../../../../shared/components/entity-picker/entity-picker.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-part-alternates-tab',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule,
    MatTooltipModule, TranslatePipe,
    DataTableComponent, ColumnCellDirective,
    EmptyStateComponent, LoadingBlockDirective,
    DialogComponent, InputComponent, SelectComponent, TextareaComponent, ToggleComponent,
    EntityPickerComponent, ValidationButtonComponent,
  ],
  templateUrl: './part-alternates-tab.component.html',
  styleUrl: './part-alternates-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartAlternatesTabComponent {
  private readonly partsService = inject(PartsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly partId = input.required<number>();

  protected readonly loading = signal(false);
  protected readonly alternates = signal<PartAlternate[]>([]);
  protected readonly showDialog = signal(false);
  protected readonly saving = signal(false);

  protected readonly typeOptions: SelectOption[] = [
    { value: 'Substitute', label: 'Substitute' },
    { value: 'Equivalent', label: 'Equivalent' },
    { value: 'Superseded', label: 'Superseded' },
  ];

  protected readonly columns: ColumnDef[] = [
    { field: 'alternatePartNumber', header: 'Part #', sortable: true, width: '120px' },
    { field: 'alternatePartName', header: 'Name', sortable: true },
    { field: 'type', header: 'Type', sortable: true, width: '110px' },
    { field: 'priority', header: 'Priority', sortable: true, width: '80px', align: 'center' },
    { field: 'isApproved', header: 'Approved', sortable: true, width: '90px', align: 'center' },
    { field: 'isBidirectional', header: 'Bi-Dir', sortable: true, width: '70px', align: 'center' },
    { field: 'actions', header: '', width: '80px' },
  ];

  protected readonly form = new FormGroup({
    alternatePartId: new FormControl<number | null>(null, { validators: [Validators.required] }),
    priority: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    type: new FormControl<AlternateType>('Substitute', { nonNullable: true }),
    conversionFactor: new FormControl<number | null>(null),
    isApproved: new FormControl(false, { nonNullable: true }),
    notes: new FormControl(''),
    isBidirectional: new FormControl(true, { nonNullable: true }),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    alternatePartId: 'Alternate Part',
    priority: 'Priority',
  });

  constructor() {
    effect(() => {
      const id = this.partId();
      if (id) this.loadAlternates(id);
    });
  }

  private loadAlternates(partId: number): void {
    this.loading.set(true);
    this.partsService.getPartAlternates(partId).subscribe({
      next: (data) => {
        this.alternates.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openAdd(): void {
    this.form.reset({ priority: 1, type: 'Substitute', isApproved: false, isBidirectional: true });
    this.showDialog.set(true);
  }

  protected closeDialog(): void {
    this.showDialog.set(false);
  }

  protected save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    const request: CreatePartAlternateRequest = {
      alternatePartId: v.alternatePartId!,
      priority: v.priority,
      type: v.type,
      conversionFactor: v.conversionFactor,
      isApproved: v.isApproved,
      notes: v.notes,
      isBidirectional: v.isBidirectional,
    };
    this.partsService.createPartAlternate(this.partId(), request).subscribe({
      next: () => {
        this.saving.set(false);
        this.showDialog.set(false);
        this.snackbar.success('Alternate part added');
        this.loadAlternates(this.partId());
      },
      error: () => this.saving.set(false),
    });
  }

  protected approve(alt: PartAlternate): void {
    this.partsService.updatePartAlternate(this.partId(), alt.id, { isApproved: true }).subscribe({
      next: () => {
        this.snackbar.success('Alternate approved');
        this.loadAlternates(this.partId());
      },
    });
  }

  protected deleteAlternate(alt: PartAlternate): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Remove Alternate',
        message: `Remove ${alt.alternatePartNumber} as alternate?`,
        confirmLabel: 'Remove',
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.partsService.deletePartAlternate(this.partId(), alt.id).subscribe({
        next: () => {
          this.snackbar.success('Alternate removed');
          this.loadAlternates(this.partId());
        },
      });
    });
  }

  protected getTypeClass(type: AlternateType): string {
    switch (type) {
      case 'Substitute': return 'chip chip--info';
      case 'Equivalent': return 'chip chip--success';
      case 'Superseded': return 'chip chip--warning';
    }
  }
}

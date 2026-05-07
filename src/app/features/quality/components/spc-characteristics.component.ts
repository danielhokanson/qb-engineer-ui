import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { SpcService } from '../services/spc.service';
import { SpcCharacteristic } from '../models/spc.model';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../shared/models/column-def.model';
import { DialogComponent } from '../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../shared/components/toggle/toggle.component';
import { FormValidationService } from '../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../shared/components/validation-button/validation-button.component';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';

@Component({
  selector: 'app-spc-characteristics',
  standalone: true,
  imports: [
    ReactiveFormsModule, DatePipe, DecimalPipe,
    DataTableComponent, ColumnCellDirective,
    DialogComponent, InputComponent, SelectComponent,
    TextareaComponent, ToggleComponent,
    ValidationButtonComponent, LoadingBlockDirective,
  ],
  templateUrl: './spc-characteristics.component.html',
  styleUrl: './spc-characteristics.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpcCharacteristicsComponent {
  private readonly spcService = inject(SpcService);
  private readonly snackbar = inject(SnackbarService);

  readonly characteristicSelected = output<SpcCharacteristic>();

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly characteristics = signal<SpcCharacteristic[]>([]);
  protected readonly showDialog = signal(false);
  protected readonly editingId = signal<number | null>(null);

  protected readonly columns: ColumnDef[] = [
    { field: 'partNumber', header: 'Part #', sortable: true, width: '120px' },
    { field: 'name', header: 'Characteristic', sortable: true },
    { field: 'operationName', header: 'Operation', sortable: true, width: '140px' },
    { field: 'nominalValue', header: 'Nominal', sortable: true, width: '90px', align: 'right' },
    { field: 'specLimits', header: 'Spec Limits', width: '140px', align: 'center' },
    { field: 'sampleSize', header: 'n', sortable: true, width: '50px', align: 'center' },
    { field: 'measurementCount', header: 'Measurements', sortable: true, width: '110px', align: 'right' },
    { field: 'latestCpk', header: 'Cpk', sortable: true, width: '80px', align: 'right' },
    { field: 'isActive', header: 'Active', sortable: true, width: '70px', align: 'center' },
    { field: 'actions', header: '', width: '50px', align: 'center' },
  ];

  protected readonly measurementTypeOptions: SelectOption[] = [
    { value: 'Variable', label: 'Variable' },
    { value: 'Attribute', label: 'Attribute' },
  ];

  protected readonly form = new FormGroup({
    partId: new FormControl<number | null>(null, [Validators.required]),
    operationId: new FormControl<number | null>(null),
    name: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    description: new FormControl(''),
    measurementType: new FormControl('Variable'),
    nominalValue: new FormControl<number>(0, [Validators.required]),
    upperSpecLimit: new FormControl<number>(0, [Validators.required]),
    lowerSpecLimit: new FormControl<number>(0, [Validators.required]),
    unitOfMeasure: new FormControl(''),
    decimalPlaces: new FormControl<number>(4, [Validators.required, Validators.min(0), Validators.max(6)]),
    sampleSize: new FormControl<number>(5, [Validators.required, Validators.min(2), Validators.max(25)]),
    sampleFrequency: new FormControl(''),
    gageId: new FormControl<number | null>(null),
    notifyOnOoc: new FormControl(true),
    isActive: new FormControl(true),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    partId: 'Part',
    name: 'Name',
    nominalValue: 'Nominal Value',
    upperSpecLimit: 'Upper Spec Limit',
    lowerSpecLimit: 'Lower Spec Limit',
    decimalPlaces: 'Decimal Places',
    sampleSize: 'Sample Size',
  });

  constructor() {
    this.loadCharacteristics();
  }

  loadCharacteristics(): void {
    this.loading.set(true);
    this.spcService.getCharacteristics({ isActive: true }).subscribe({
      next: data => { this.characteristics.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openCreate(): void {
    this.editingId.set(null);
    this.form.reset({ measurementType: 'Variable', decimalPlaces: 4, sampleSize: 5, notifyOnOoc: true, isActive: true });
    this.showDialog.set(true);
  }

  protected openEdit(char: SpcCharacteristic): void {
    this.editingId.set(char.id);
    this.form.patchValue({
      partId: char.partId,
      operationId: char.operationId,
      name: char.name,
      description: char.description,
      measurementType: char.measurementType,
      nominalValue: char.nominalValue,
      upperSpecLimit: char.upperSpecLimit,
      lowerSpecLimit: char.lowerSpecLimit,
      unitOfMeasure: char.unitOfMeasure,
      decimalPlaces: char.decimalPlaces,
      sampleSize: char.sampleSize,
      sampleFrequency: char.sampleFrequency,
      gageId: char.gageId,
      notifyOnOoc: char.notifyOnOoc,
      isActive: char.isActive,
    });
    this.showDialog.set(true);
  }

  protected closeDialog(): void {
    this.showDialog.set(false);
  }

  protected save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const data = this.form.getRawValue();

    const request = {
      partId: data.partId!,
      operationId: data.operationId ?? undefined,
      name: data.name!,
      description: data.description || undefined,
      measurementType: data.measurementType as 'Variable' | 'Attribute',
      nominalValue: data.nominalValue!,
      upperSpecLimit: data.upperSpecLimit!,
      lowerSpecLimit: data.lowerSpecLimit!,
      unitOfMeasure: data.unitOfMeasure || undefined,
      decimalPlaces: data.decimalPlaces!,
      sampleSize: data.sampleSize!,
      sampleFrequency: data.sampleFrequency || undefined,
      gageId: data.gageId ?? undefined,
      notifyOnOoc: data.notifyOnOoc!,
      isActive: data.isActive!,
    };

    const obs = this.editingId()
      ? this.spcService.updateCharacteristic(this.editingId()!, request)
      : this.spcService.createCharacteristic(request);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeDialog();
        this.loadCharacteristics();
        this.snackbar.success(this.editingId() ? 'Characteristic updated' : 'Characteristic created');
      },
      error: () => this.saving.set(false),
    });
  }

  protected selectCharacteristic(char: SpcCharacteristic): void {
    this.characteristicSelected.emit(char);
  }

  protected getCpkClass(cpk: number | null): string {
    if (cpk == null) return '';
    if (cpk >= 1.33) return 'spc-cpk--good';
    if (cpk >= 1.0) return 'spc-cpk--warning';
    return 'spc-cpk--danger';
  }
}

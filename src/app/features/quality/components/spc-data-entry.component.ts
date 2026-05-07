import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { SpcService } from '../services/spc.service';
import { SpcCharacteristic, SpcSubgroupEntry } from '../models/spc.model';
import { InputComponent } from '../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../shared/components/textarea/textarea.component';
import { SnackbarService } from '../../../shared/services/snackbar.service';

@Component({
  selector: 'app-spc-data-entry',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent, TextareaComponent],
  templateUrl: './spc-data-entry.component.html',
  styleUrl: './spc-data-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpcDataEntryComponent {
  private readonly spcService = inject(SpcService);
  private readonly snackbar = inject(SnackbarService);

  readonly characteristic = input.required<SpcCharacteristic>();
  readonly measurementRecorded = output<void>();

  protected readonly saving = signal(false);
  protected readonly values = signal<(number | null)[]>([]);
  protected readonly notes = new FormControl('');
  protected readonly jobIdControl = new FormControl<number | null>(null);
  protected readonly lotNumberControl = new FormControl('');

  protected readonly sampleIndices = computed(() => {
    const n = this.characteristic().sampleSize;
    return Array.from({ length: n }, (_, i) => i);
  });

  protected readonly computedMean = computed(() => {
    const vals = this.values().filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  protected readonly computedRange = computed(() => {
    const vals = this.values().filter((v): v is number => v != null);
    if (vals.length < 2) return null;
    return Math.max(...vals) - Math.min(...vals);
  });

  protected readonly stepValue = computed(() => Math.pow(10, -this.characteristic().decimalPlaces));

  protected readonly allFilled = computed(() => {
    const n = this.characteristic().sampleSize;
    const vals = this.values().filter(v => v != null);
    return vals.length === n;
  });

  constructor() {
    // Initialize values array when characteristic changes (handled via initValues)
  }

  protected initValues(): void {
    const n = this.characteristic().sampleSize;
    this.values.set(Array(n).fill(null));
  }

  protected onValueChange(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = input.value ? parseFloat(input.value) : null;
    const current = [...this.values()];

    // Ensure array is correct size
    while (current.length < this.characteristic().sampleSize) current.push(null);

    current[index] = val;
    this.values.set(current);
  }

  protected submit(): void {
    const vals = this.values().filter((v): v is number => v != null);
    if (vals.length !== this.characteristic().sampleSize) return;

    this.saving.set(true);

    const subgroup: SpcSubgroupEntry = {
      values: vals,
      notes: this.notes.value?.trim() || undefined,
    };

    this.spcService.recordMeasurements({
      characteristicId: this.characteristic().id,
      jobId: this.jobIdControl.value ?? undefined,
      lotNumber: this.lotNumberControl.value?.trim() || undefined,
      subgroups: [subgroup],
    }).subscribe({
      next: measurements => {
        this.saving.set(false);
        this.clearForm();
        const m = measurements[0];
        const oocMsg = m?.isOutOfControl ? ` ⚠ OOC: ${m.oocRuleViolated}` : '';
        this.snackbar.success(`Subgroup #${m?.subgroupNumber} recorded.${oocMsg}`);
        this.measurementRecorded.emit();
      },
      error: () => this.saving.set(false),
    });
  }

  protected clearForm(): void {
    this.values.set(Array(this.characteristic().sampleSize).fill(null));
    this.notes.reset();
  }

  protected formatValue(val: number | null): string {
    if (val == null) return '';
    return val.toFixed(this.characteristic().decimalPlaces);
  }
}

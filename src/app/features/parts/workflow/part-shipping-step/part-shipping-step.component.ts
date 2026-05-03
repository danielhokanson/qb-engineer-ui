import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Pillar 6 follow-up — Shipping step. Captures the measurement profile
 * (mass, dimensions, volume) used for shipping rate quotes and inventory
 * cube calculations. Persists in canonical SI (grams / mm / mL) with a
 * per-field display unit so the user can type whichever unit they prefer.
 *
 * Conversion math mirrors `PartMaterialClusterComponent` — kept as a copy
 * for now; can be extracted to a shared util once a third caller appears.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-shipping-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    InputComponent, SelectComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-shipping-step.component.html',
  styleUrl: './part-shipping-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartShippingStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId = input<string>('shipping');
  readonly componentName = input<string>('PartShippingStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  // Canonical: weight in grams, dimensions in mm, volume in mL.
  private readonly weightToGrams: Record<string, number> = {
    g: 1, kg: 1000, lb: 453.59237, oz: 28.3495,
  };
  private readonly dimensionToMm: Record<string, number> = {
    mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8,
  };
  private readonly volumeToMl: Record<string, number> = {
    mL: 1, L: 1000, gal: 3785.41,
  };

  protected readonly weightUnitOptions: SelectOption[] = [
    { value: 'g', label: 'g' }, { value: 'kg', label: 'kg' },
    { value: 'lb', label: 'lb' }, { value: 'oz', label: 'oz' },
  ];
  protected readonly dimensionUnitOptions: SelectOption[] = [
    { value: 'mm', label: 'mm' }, { value: 'cm', label: 'cm' },
    { value: 'm', label: 'm' }, { value: 'in', label: 'in' }, { value: 'ft', label: 'ft' },
  ];
  protected readonly volumeUnitOptions: SelectOption[] = [
    { value: 'mL', label: 'mL' }, { value: 'L', label: 'L' }, { value: 'gal', label: 'gal' },
  ];

  protected readonly form = new FormGroup({
    weight: new FormControl<number | null>(null, [Validators.min(0)]),
    weightDisplayUnit: new FormControl<string>('g', { nonNullable: true }),
    length: new FormControl<number | null>(null, [Validators.min(0)]),
    width: new FormControl<number | null>(null, [Validators.min(0)]),
    height: new FormControl<number | null>(null, [Validators.min(0)]),
    dimensionDisplayUnit: new FormControl<string>('mm', { nonNullable: true }),
    volume: new FormControl<number | null>(null, [Validators.min(0)]),
    volumeDisplayUnit: new FormControl<string>('mL', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      const weight = this.gramsToDisplay(part.weightEach, part.weightDisplayUnit);
      const dim = this.mmToDisplay(
        { length: part.lengthMm, width: part.widthMm, height: part.heightMm },
        part.dimensionDisplayUnit,
      );
      const vol = this.mlToDisplay(part.volumeMl, part.volumeDisplayUnit);
      this.form.patchValue({
        weight: weight.value,
        weightDisplayUnit: weight.unit,
        length: dim.length,
        width: dim.width,
        height: dim.height,
        dimensionDisplayUnit: dim.unit,
        volume: vol.value,
        volumeDisplayUnit: vol.unit,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        weight: this.translate.instant('parts.workflow.shipping.weightLabel'),
        weightDisplayUnit: this.translate.instant('parts.workflow.shipping.weightUnitLabel'),
        length: this.translate.instant('parts.workflow.shipping.lengthLabel'),
        width: this.translate.instant('parts.workflow.shipping.widthLabel'),
        height: this.translate.instant('parts.workflow.shipping.heightLabel'),
        dimensionDisplayUnit: this.translate.instant('parts.workflow.shipping.dimensionUnitLabel'),
        volume: this.translate.instant('parts.workflow.shipping.volumeLabel'),
        volumeDisplayUnit: this.translate.instant('parts.workflow.shipping.volumeUnitLabel'),
      },
      () => this.save(),
    );
    this.destroyRef.onDestroy(() => this.workflowService.unregisterStepForm());
  }

  private gramsToDisplay(grams: number | null, unit: string | null): { value: number | null; unit: string } {
    const u = unit && this.weightToGrams[unit] ? unit : 'g';
    if (grams === null) return { value: null, unit: u };
    return { value: grams / this.weightToGrams[u], unit: u };
  }

  private mmToDisplay(
    dims: { length: number | null; width: number | null; height: number | null },
    unit: string | null,
  ): { length: number | null; width: number | null; height: number | null; unit: string } {
    const u = unit && this.dimensionToMm[unit] ? unit : 'mm';
    const factor = this.dimensionToMm[u];
    return {
      length: dims.length === null ? null : dims.length / factor,
      width: dims.width === null ? null : dims.width / factor,
      height: dims.height === null ? null : dims.height / factor,
      unit: u,
    };
  }

  private mlToDisplay(ml: number | null, unit: string | null): { value: number | null; unit: string } {
    const u = unit && this.volumeToMl[unit] ? unit : 'mL';
    if (ml === null) return { value: null, unit: u };
    return { value: ml / this.volumeToMl[u], unit: u };
  }

  private save(): Observable<unknown> {
    const runId = this.runId();
    if (runId == null) return of(null);
    if (this.form.pristine) return of(null);
    const v = this.form.getRawValue();

    const weightEach = v.weight === null
      ? null
      : v.weight * (this.weightToGrams[v.weightDisplayUnit] ?? 1);
    const dimFactor = this.dimensionToMm[v.dimensionDisplayUnit] ?? 1;
    const lengthMm = v.length === null ? null : v.length * dimFactor;
    const widthMm = v.width === null ? null : v.width * dimFactor;
    const heightMm = v.height === null ? null : v.height * dimFactor;
    const volumeMl = v.volume === null
      ? null
      : v.volume * (this.volumeToMl[v.volumeDisplayUnit] ?? 1);

    this.saving.set(true);
    return this.workflowService.patchStep(runId, this.stepId(), {
      weightEach,
      weightDisplayUnit: v.weightDisplayUnit,
      lengthMm,
      widthMm,
      heightMm,
      dimensionDisplayUnit: v.dimensionDisplayUnit,
      volumeMl,
      volumeDisplayUnit: v.volumeDisplayUnit,
    }).pipe(
      switchMap((run) => {
        if (run.entityId == null) return of(null);
        return this.partsService.getPartById(run.entityId).pipe(
          tap((detail) => this.workflowService.currentEntity.set(detail)),
        );
      }),
      tap({
        next: () => {
          this.saving.set(false);
          this.form.markAsPristine();
        },
        error: () => {
          this.saving.set(false);
          this.snackbar.error(this.translate.instant('parts.workflow.shipping.saveFailed'));
        },
      }),
    );
  }
}

import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { EntityPickerComponent } from '../../../../shared/components/entity-picker/entity-picker.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Pillar 6 follow-up — Inventory step. Captures stock thresholds (min /
 * reorder point / reorder qty / safety stock days), the stock UoM, and the
 * default bin id. Used by every non-Phantom combo.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-inventory-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    EntityPickerComponent, InputComponent, SelectComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-inventory-step.component.html',
  styleUrl: './part-inventory-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartInventoryStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId = input<string>('inventory');
  readonly componentName = input<string>('PartInventoryStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  // Stock UoM falls back to a small hard-coded list when no Tier 2 picker is
  // available. The backing values map to UnitOfMeasure rows by code; the FK
  // is resolved server-side by the parts adapter once a real UoM picker
  // exists.
  protected readonly stockUomOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('parts.workflow.inventory.stockUomNone') },
    { value: 'ea', label: 'each (ea)' },
    { value: 'kg', label: 'kg' },
    { value: 'g', label: 'g' },
    { value: 'lb', label: 'lb' },
    { value: 'm', label: 'm' },
    { value: 'mm', label: 'mm' },
    { value: 'L', label: 'L' },
    { value: 'mL', label: 'mL' },
  ];

  protected readonly form = new FormGroup({
    minStockThreshold: new FormControl<number | null>(null, [Validators.min(0)]),
    reorderPoint: new FormControl<number | null>(null, [Validators.min(0)]),
    reorderQuantity: new FormControl<number | null>(null, [Validators.min(0)]),
    safetyStockDays: new FormControl<number | null>(null, [Validators.min(0)]),
    stockUomCode: new FormControl<string | null>(null),
    defaultBinId: new FormControl<number | null>(null),
  });

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        minStockThreshold: part.minStockThreshold ?? null,
        reorderPoint: part.reorderPoint ?? null,
        reorderQuantity: part.reorderQuantity ?? null,
        safetyStockDays: part.safetyStockDays ?? null,
        stockUomCode: part.stockUomCode ?? null,
        defaultBinId: part.defaultBinId ?? null,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        minStockThreshold: this.translate.instant('parts.workflow.inventory.minStockThresholdLabel'),
        reorderPoint: this.translate.instant('parts.workflow.inventory.reorderPointLabel'),
        reorderQuantity: this.translate.instant('parts.workflow.inventory.reorderQuantityLabel'),
        safetyStockDays: this.translate.instant('parts.workflow.inventory.safetyStockDaysLabel'),
        stockUomCode: this.translate.instant('parts.workflow.inventory.stockUomLabel'),
        defaultBinId: this.translate.instant('parts.workflow.inventory.defaultBinLabel'),
      },
      () => this.save(),
    );
    this.destroyRef.onDestroy(() => this.workflowService.unregisterStepForm());
  }

  private save(): Observable<unknown> {
    const runId = this.runId();
    if (runId == null) return of(null);
    if (this.form.pristine) return of(null);
    const value = this.form.getRawValue();
    this.saving.set(true);
    return this.workflowService.patchStep(runId, this.stepId(), {
      minStockThreshold: value.minStockThreshold ?? null,
      reorderPoint: value.reorderPoint ?? null,
      reorderQuantity: value.reorderQuantity ?? null,
      safetyStockDays: value.safetyStockDays ?? null,
      stockUomCode: value.stockUomCode ?? null,
      defaultBinId: value.defaultBinId ?? null,
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
          this.snackbar.error(this.translate.instant('parts.workflow.inventory.saveFailed'));
        },
      }),
    );
  }
}

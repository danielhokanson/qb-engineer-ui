import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { AbcClass } from '../../models/abc-class.type';
import { PartDetail } from '../../models/part-detail.model';
import { ReceivingInspectionFrequency } from '../../models/receiving-inspection-frequency.type';
import { TraceabilityType } from '../../models/traceability-type.type';
import { PartsService } from '../../services/parts.service';

/**
 * Pillar 6 follow-up — Quality step. Captures receiving inspection
 * settings, traceability tier, ABC class, hazmat class, and shelf life
 * for combos where quality matters (B1-B4, M1-M3, S1, S2).
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-quality-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    InputComponent, SelectComponent, ToggleComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-quality-step.component.html',
  styleUrl: './part-quality-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartQualityStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId = input<string>('quality');
  readonly componentName = input<string>('PartQualityStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly traceabilityOptions: SelectOption[] = [
    { value: 'None', label: this.translate.instant('parts.workflow.quality.traceabilityNone') },
    { value: 'Lot', label: this.translate.instant('parts.workflow.quality.traceabilityLot') },
    { value: 'Serial', label: this.translate.instant('parts.workflow.quality.traceabilitySerial') },
  ];

  protected readonly abcClassOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('parts.workflow.quality.abcClassUnclassified') },
    { value: 'A', label: this.translate.instant('parts.workflow.quality.abcClassA') },
    { value: 'B', label: this.translate.instant('parts.workflow.quality.abcClassB') },
    { value: 'C', label: this.translate.instant('parts.workflow.quality.abcClassC') },
  ];

  protected readonly inspectionFrequencyOptions: SelectOption[] = [
    { value: 'Every', label: this.translate.instant('parts.workflow.quality.frequencyEvery') },
    { value: 'FirstArticle', label: this.translate.instant('parts.workflow.quality.frequencyFirstArticle') },
    { value: 'SkipLot', label: this.translate.instant('parts.workflow.quality.frequencySkipLot') },
    { value: 'Random', label: this.translate.instant('parts.workflow.quality.frequencyRandom') },
  ];

  protected readonly form = new FormGroup({
    traceabilityType: new FormControl<TraceabilityType>('None', { nonNullable: true, validators: [Validators.required] }),
    requiresReceivingInspection: new FormControl<boolean>(false, { nonNullable: true }),
    inspectionFrequency: new FormControl<ReceivingInspectionFrequency | null>(null),
    inspectionSkipAfterN: new FormControl<number | null>(null, [Validators.min(0)]),
    abcClass: new FormControl<AbcClass | null>(null),
    hazmatClass: new FormControl<string>('', [Validators.maxLength(50)]),
    shelfLifeDays: new FormControl<number | null>(null, [Validators.min(0)]),
  });

  /** Show inspection frequency / skip-after fields only when receiving inspection is required. */
  protected readonly inspectionEnabled = signal(false);

  protected readonly showInspectionFields = computed(() => this.inspectionEnabled());

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        traceabilityType: part.traceabilityType ?? 'None',
        requiresReceivingInspection: part.requiresReceivingInspection ?? false,
        inspectionFrequency: part.inspectionFrequency ?? null,
        inspectionSkipAfterN: part.inspectionSkipAfterN ?? null,
        abcClass: part.abcClass ?? null,
        hazmatClass: part.hazmatClass ?? '',
        shelfLifeDays: part.shelfLifeDays ?? null,
      }, { emitEvent: false });
      this.inspectionEnabled.set(part.requiresReceivingInspection ?? false);
    });

    // Track the toggle locally so the conditional rendering reacts.
    this.form.controls.requiresReceivingInspection.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(v => this.inspectionEnabled.set(!!v));

    this.workflowService.registerStepForm(
      this.form,
      {
        traceabilityType: this.translate.instant('parts.workflow.quality.traceabilityLabel'),
        requiresReceivingInspection: this.translate.instant('parts.workflow.quality.requiresReceivingInspectionLabel'),
        inspectionFrequency: this.translate.instant('parts.workflow.quality.inspectionFrequencyLabel'),
        inspectionSkipAfterN: this.translate.instant('parts.workflow.quality.inspectionSkipAfterNLabel'),
        abcClass: this.translate.instant('parts.workflow.quality.abcClassLabel'),
        hazmatClass: this.translate.instant('parts.workflow.quality.hazmatClassLabel'),
        shelfLifeDays: this.translate.instant('parts.workflow.quality.shelfLifeDaysLabel'),
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
      traceabilityType: value.traceabilityType ?? 'None',
      requiresReceivingInspection: value.requiresReceivingInspection,
      inspectionFrequency: value.requiresReceivingInspection ? value.inspectionFrequency ?? null : null,
      inspectionSkipAfterN: value.requiresReceivingInspection ? value.inspectionSkipAfterN ?? null : null,
      abcClass: value.abcClass ?? null,
      hazmatClass: value.hazmatClass || undefined,
      shelfLifeDays: value.shelfLifeDays ?? null,
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
          this.snackbar.error(this.translate.instant('parts.workflow.quality.saveFailed'));
        },
      }),
    );
  }
}

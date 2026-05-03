import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { BackflushPolicy } from '../../models/backflush-policy.type';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Pillar 6 follow-up — Flags step. Used by Phantom combos (P1 / P3) to
 * capture the kit-vs-virtual phantom toggles + the configurator opt-in
 * + per-part backflush policy override.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-flags-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    SelectComponent, ToggleComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-flags-step.component.html',
  styleUrl: './part-flags-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartFlagsStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId = input<string>('flags');
  readonly componentName = input<string>('PartFlagsStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly backflushOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('parts.workflow.flags.backflushDefault') },
    { value: 'Auto', label: this.translate.instant('parts.workflow.flags.backflushAuto') },
    { value: 'Manual', label: this.translate.instant('parts.workflow.flags.backflushManual') },
    { value: 'None', label: this.translate.instant('parts.workflow.flags.backflushNone') },
  ];

  protected readonly form = new FormGroup({
    isKit: new FormControl<boolean>(false, { nonNullable: true }),
    isConfigurable: new FormControl<boolean>(false, { nonNullable: true }),
    backflushPolicy: new FormControl<BackflushPolicy | null>(null),
  });

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        isKit: part.isKit ?? false,
        isConfigurable: part.isConfigurable ?? false,
        backflushPolicy: part.backflushPolicy ?? null,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        isKit: this.translate.instant('parts.workflow.flags.isKitLabel'),
        isConfigurable: this.translate.instant('parts.workflow.flags.isConfigurableLabel'),
        backflushPolicy: this.translate.instant('parts.workflow.flags.backflushPolicyLabel'),
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
      isKit: value.isKit,
      isConfigurable: value.isConfigurable,
      backflushPolicy: value.backflushPolicy ?? null,
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
          this.snackbar.error(this.translate.instant('parts.workflow.flags.saveFailed'));
        },
      }),
    );
  }
}

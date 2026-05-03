import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { EntityPickerComponent } from '../../../../shared/components/entity-picker/entity-picker.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Sourcing step — designates the preferred vendor for the part. Per-vendor
 * sourcing terms (lead time, MOQ, pack size, OEM identity, pricing) live
 * on the VendorPart row and are entered in the subsequent VendorParts step;
 * this step's only output is <c>preferredVendorId</c> on the Part.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-sourcing-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    EntityPickerComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-sourcing-step.component.html',
  styleUrl: './part-sourcing-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartSourcingStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId = input<string>('sourcing');
  readonly componentName = input<string>('PartSourcingStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    preferredVendorId: new FormControl<number | null>(null),
  });

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        preferredVendorId: part.preferredVendorId ?? null,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        preferredVendorId: this.translate.instant('parts.workflow.sourcing.preferredVendorLabel'),
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
      preferredVendorId: value.preferredVendorId ?? null,
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
          this.snackbar.error(this.translate.instant('parts.workflow.sourcing.saveFailed'));
        },
      }),
    );
  }
}

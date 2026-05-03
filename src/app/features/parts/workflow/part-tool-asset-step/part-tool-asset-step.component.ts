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
 * Pillar 6 follow-up — Tool Asset step. Used by Make+Tool (M4) and
 * Buy+Tool (B6) combos to link the part to its tooling Asset record.
 *
 * Pre-beta: dropped the legacy free-text `moldToolRef` fallback. Tooling is
 * now always represented as an Asset FK; if a Buy+Tool part has only a
 * vendor-side mold reference, capture it on the Asset row instead.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-tool-asset-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    EntityPickerComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-tool-asset-step.component.html',
  styleUrl: './part-tool-asset-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartToolAssetStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId = input<string>('toolAsset');
  readonly componentName = input<string>('PartToolAssetStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    toolingAssetId: new FormControl<number | null>(null),
  });

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        toolingAssetId: part.toolingAssetId ?? null,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        toolingAssetId: this.translate.instant('parts.workflow.toolAsset.toolingAssetLabel'),
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
      toolingAssetId: value.toolingAssetId ?? null,
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
          this.snackbar.error(this.translate.instant('parts.workflow.toolAsset.saveFailed'));
        },
      }),
    );
  }
}

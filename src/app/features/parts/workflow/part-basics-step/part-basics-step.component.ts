import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { InputComponent } from '../../../../shared/components/input/input.component';
import { StepRationaleComponent } from '../../../../shared/components/step-rationale/step-rationale.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Workflow Pattern Phase 5 — Part Assembly basics step.
 *
 * Edits the gate fields for `hasBasics`: name, description. Persists via the
 * workflow's PatchWorkflowStep endpoint when the shell triggers `save`
 * (Continue / Back / Jump / Mark Complete) — the endpoint owns deferred
 * materialization, so step 1's first save creates the underlying Part row
 * when the workflow was started with no entity yet. Subsequent saves apply
 * field updates to the now-real entity.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 * Pre-refactor this used a 600ms debounced valueChanges subscription which
 * round-tripped on every keystroke and flapped on server-normalized values
 * (trailing whitespace deleted, etc.). The current model only fires on
 * shell navigation.
 */
@Component({
  selector: 'app-part-basics-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    InputComponent, TextareaComponent, LoadingBlockDirective,
    StepRationaleComponent,
  ],
  templateUrl: './part-basics-step.component.html',
  styleUrl: './part-basics-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartBasicsStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  // ─── Inputs (provided by the shell via *ngComponentOutlet) ──────────
  readonly stepId = input<string>('basics');
  readonly componentName = input<string>('PartBasicsStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(256)]),
    description: new FormControl('', [Validators.maxLength(2000)]),
  });

  constructor() {
    // When the bound entity changes (initial load, or after a save round-trip
    // refreshes it), re-hydrate the form. Skip emitEvent to avoid a feedback
    // loop with any subsequent valueChanges listeners callers may attach.
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        name: part.name ?? '',
        description: part.description ?? '',
      }, { emitEvent: false });
    });

    // Register form with the shell so Continue gates on validity, the
    // app-validation-button surfaces required-field violations, and
    // saveCurrentStep() invokes our save callback before navigation.
    this.workflowService.registerStepForm(
      this.form,
      {
        name: this.translate.instant('parts.workflow.basics.nameLabel'),
        description: this.translate.instant('parts.workflow.basics.descriptionLabel'),
      },
      () => this.save(),
    );
    this.destroyRef.onDestroy(() => this.workflowService.unregisterStepForm());
  }

  /**
   * Persist the current form to the workflow's PatchWorkflowStep endpoint,
   * then refetch the entity so the rail's gate predicates evaluate against
   * fresh state. Returns Observable so the shell-parent can sequence
   * "save then advance" — errors propagate back through saveCurrentStep
   * which the parent uses to gate navigation.
   *
   * Skips the network call entirely when the form is pristine (no user
   * edits to persist) — saves a round-trip on every Back/Jump that the
   * user took without touching anything.
   */
  private save(): Observable<unknown> {
    const runId = this.runId();
    if (runId == null) return of(null);
    if (this.form.pristine) return of(null);
    const value = this.form.getRawValue();
    this.saving.set(true);
    return this.workflowService.patchStep(runId, this.stepId(), {
      name: value.name ?? undefined,
      description: value.description ?? '',
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
          this.snackbar.error(this.translate.instant('parts.workflow.basics.saveFailed'));
        },
      }),
    );
  }
}

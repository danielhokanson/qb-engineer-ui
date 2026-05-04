import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  EventEmitter,
  inject,
  input,
  Output,
  signal,
  Type,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ConfirmDialogComponent, ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { EntityValidator } from '../../models/entity-validator.model';
import { MissingValidator } from '../../models/workflow-missing-validator.model';
import { WorkflowDefinition } from '../../models/workflow-definition.model';
import { WorkflowRun } from '../../models/workflow-run.model';
import { WorkflowStepDefinition } from '../../models/workflow-step-definition.model';
import { PredicateEvaluator } from '../../services/predicate-evaluator';
import { WorkflowService } from '../../services/workflow.service';
import { WorkflowStepRegistryService } from '../../services/workflow-step-registry.service';
import { ValidationButtonComponent } from '../validation-button/validation-button.component';
import { WorkflowStepStubComponent } from './workflow-step-stub.component';

/**
 * Workflow Pattern Phase 4 — Generic shell that hosts a workflow run
 * (express or guided) over a loaded entity. The shell stays entity-agnostic;
 * per-step content comes from `WorkflowStepRegistryService`.
 *
 * Behavior contract:
 *   • D2 — step rail clickability: current OR earlier-completed step is
 *     clickable; future steps are locked. Earlier-completed = predicate
 *     gates pass for that step.
 *   • D4 — mode toggle is ALWAYS available (express ↔ guided), including
 *     mid-flow. Switching keeps the same currentStepId.
 *   • Mark Complete delegates to the entity-promote-status pipeline via
 *     the service (which round-trips to the server's authoritative gate).
 *
 * The shell is `<app-workflow>` and takes its inputs from a parent (a
 * feature module's detail page or the demo route). Actions emit outputs
 * the parent can wire to the WorkflowService — keeping the shell pure of
 * HTTP concerns and easy to test.
 */
@Component({
  selector: 'app-workflow',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MatTooltipModule, ValidationButtonComponent],
  templateUrl: './workflow.component.html',
  styleUrl: './workflow.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowComponent {
  private readonly registry = inject(WorkflowStepRegistryService);
  private readonly evaluator = new PredicateEvaluator();
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  protected readonly workflowService = inject(WorkflowService);

  // ─── Inputs ─────────────────────────────────────────────────────────

  readonly run = input<WorkflowRun | null>(null);
  readonly definition = input<WorkflowDefinition | null>(null);
  readonly entity = input<unknown>(null);
  readonly validators = input<EntityValidator[]>([]);
  /** Display title — entity-specific (e.g. "ASM-100" or "New Assembly"). */
  readonly entityTitle = input<string>('');
  /**
   * Server-reported missing validators from the most recent
   * Mark Complete / Promote attempt. The shell uses this to:
   *   • Highlight rail rows whose step owns a failed gate (red marker).
   *   • Render an inline alert at the top of the current step body when
   *     that step is the one blocking promotion.
   * Empty list = no recent failure (or it was cleared).
   */
  readonly missingValidators = input<MissingValidator[]>([]);

  /**
   * Read-only presentation. Used by the workflow-runs admin (b) and any
   * future history-view surface that wants to show the rail + current
   * step without form controls. When true:
   *   • The shell hides the entire footer (Back / Skip / Continue).
   *   • The mode toggle is hidden (no editing → no need to switch).
   *   • Step components receive readonly: true via stepInputs and are
   *     responsible for honoring it (disable form controls, hide their
   *     own Save buttons). Step components opt in to the contract; the
   *     shell trusts the input.
   */
  readonly readonly = input<boolean>(false);

  // ─── Outputs ────────────────────────────────────────────────────────

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly stepJumped = new EventEmitter<string>();
  @Output() readonly modeChanged = new EventEmitter<'express' | 'guided'>();
  @Output() readonly stepAdvanced = new EventEmitter<string>();
  @Output() readonly stepBacked = new EventEmitter<string>();
  @Output() readonly stepSkipped = new EventEmitter<string>();
  @Output() readonly completeRequested = new EventEmitter<void>();

  // ─── Derived state ──────────────────────────────────────────────────

  protected readonly mode = computed<'express' | 'guided'>(
    () => this.run()?.mode ?? this.definition()?.defaultMode ?? 'guided',
  );

  protected readonly steps = computed<WorkflowStepDefinition[]>(() => this.definition()?.steps ?? []);

  protected readonly currentStepId = computed<string | null>(() => {
    const explicit = this.run()?.currentStepId ?? null;
    if (explicit) return explicit;
    // Fall back to first step (initial mount before patchStep advances).
    return this.steps()[0]?.id ?? null;
  });

  protected readonly currentStepIndex = computed<number>(() => {
    const id = this.currentStepId();
    if (!id) return 0;
    return Math.max(0, this.steps().findIndex(s => s.id === id));
  });

  protected readonly currentStep = computed<WorkflowStepDefinition | null>(() => {
    const idx = this.currentStepIndex();
    return this.steps()[idx] ?? null;
  });

  /**
   * Highest step index the user has reached during this run instance.
   * Pointer-based fallback for completion: a step with NO declared
   * completionGates counts as complete once the user has visited
   * past it (i.e., its index is < maxReachedIndex).
   *
   * Initialized + updated via the effect below from the run's
   * currentStepId. Resets on remount (component lifecycle, page refresh)
   * — the server doesn't track "highest reached" today, so fresh-mount
   * behavior is "everything before the server's currentStepId is past".
   * Good enough for the UX bug this fixes: when the user navigates
   * backward inside a session, gateless steps stay marked complete
   * instead of flipping back to unvisited.
   *
   * Proper fix is option A (predicate-based gates declared on every
   * step in the workflow definition); this fallback handles steps
   * that don't yet have meaningful predicates.
   */
  private readonly maxReachedIndex = signal(0);

  constructor() {
    // Bump maxReachedIndex whenever currentStepIndex advances.
    effect(() => {
      const current = this.currentStepIndex();
      if (current > this.maxReachedIndex()) {
        this.maxReachedIndex.set(current);
      }
    });
  }

  /**
   * Per-step completion. Two layers, evaluated per step:
   *   1. PREDICATE-based — if `completionGates` are declared and the
   *      entity is loaded, evaluate them. All must pass → complete.
   *      All-pass takes precedence over the pointer-based fallback.
   *   2. POINTER-based fallback — for steps with empty
   *      `completionGates` (which is most of the part workflow today),
   *      complete iff the user has navigated past it (idx < maxReached).
   *      Handles back-navigation correctly because `maxReachedIndex` is
   *      monotonic.
   *
   * Evaluated inline (no service writes from a computed — that's NG0600).
   */
  protected readonly completionMap = computed<Map<string, boolean>>(() => {
    const def = this.definition();
    const entity = this.entity();
    const maxReached = this.maxReachedIndex();
    const out = new Map<string, boolean>();
    if (!def) return out;
    const validatorsById = new Map<string, EntityValidator>();
    for (const v of this.validators()) validatorsById.set(v.validatorId, v);
    def.steps.forEach((step, idx) => {
      // Layer 1: predicate-based.
      if (step.completionGates.length > 0 && entity) {
        let allPass = true;
        for (const gateId of step.completionGates) {
          const v = validatorsById.get(gateId);
          if (!v) { allPass = false; break; }
          // Per-record applicability: when present, evaluate first.
          // Non-applicable validators are treated as satisfied — there's
          // nothing for them to gate on for this record. Mirrors the
          // server's EntityReadinessService behavior so the rail
          // matches the server's missing-validators answer.
          if (v.applicabilityPredicate
              && !this.evaluator.evaluateJson(v.applicabilityPredicate, entity)) {
            continue;
          }
          if (!this.evaluator.evaluateJson(v.predicate, entity)) {
            allPass = false;
            break;
          }
        }
        if (allPass) {
          out.set(step.id, true);
          return;
        }
      }
      // Layer 2: pointer-based fallback.
      out.set(step.id, idx < maxReached);
    });
    return out;
  });

  /**
   * Map of stepId → list of MissingValidator entries reported against that
   * step's completionGates. Drives both the rail's --has-error highlight
   * and the inline error alert at the top of the step body.
   */
  protected readonly errorsByStepId = computed<Map<string, MissingValidator[]>>(() => {
    const out = new Map<string, MissingValidator[]>();
    const missing = this.missingValidators();
    if (missing.length === 0) return out;
    for (const step of this.steps()) {
      if (step.completionGates.length === 0) continue;
      const gateIds = new Set(step.completionGates.map(g => g.toLowerCase()));
      const stepErrors = missing.filter(m => gateIds.has(m.validatorId.toLowerCase()));
      if (stepErrors.length > 0) out.set(step.id, stepErrors);
    }
    return out;
  });

  protected readonly currentStepErrors = computed<MissingValidator[]>(() => {
    const id = this.currentStepId();
    if (!id) return [];
    return this.errorsByStepId().get(id) ?? [];
  });

  protected hasError(step: WorkflowStepDefinition): boolean {
    return this.errorsByStepId().has(step.id);
  }

  /**
   * "Resume" surface: true when the run has been touched outside the
   * current page mount (lastActivityAt > 5 min ago). Below that threshold
   * the user is in an active session and a "welcome back" banner reads
   * as noise. Above it, we want a soft acknowledgement so the user
   * understands they're picking up an in-flight session.
   */
  protected readonly isResumed = computed<boolean>(() => {
    const r = this.run();
    if (!r) return false;
    const last = Date.parse(r.lastActivityAt);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last > 5 * 60 * 1000;
  });

  protected readonly isFirstStep = computed(() => this.currentStepIndex() === 0);
  protected readonly isLastStep = computed(() => {
    const steps = this.steps();
    return steps.length > 0 && this.currentStepIndex() === steps.length - 1;
  });

  /** Per-step component class to instantiate via `*ngComponentOutlet`. */
  protected readonly currentStepComponent = computed<Type<unknown>>(() => {
    const step = this.currentStep();
    if (!step) return WorkflowStepStubComponent;
    return this.registry.get(step.componentName) ?? WorkflowStepStubComponent;
  });

  /** Inputs piped to the current step component. */
  protected readonly stepInputs = computed<Record<string, unknown>>(() => {
    const step = this.currentStep();
    const r = this.run();
    return {
      stepId: step?.id ?? '',
      componentName: step?.componentName ?? '',
      runId: r?.id ?? null,
      entityId: r?.entityId ?? null,
      entity: this.entity(),
      readonly: this.readonly(),
    };
  });

  /** Express-mode template component (one per entity type). */
  protected readonly expressComponent = computed<Type<unknown>>(() => {
    const def = this.definition();
    if (!def?.expressTemplateComponent) return WorkflowStepStubComponent;
    return this.registry.getExpress(def.expressTemplateComponent) ?? WorkflowStepStubComponent;
  });

  /**
   * Inputs piped to the express component. Express mode collapses the
   * workflow into a single step, but the stepId we send back through
   * patchStep must match the definition — for raw-material-express-v1
   * that's "all", not the literal "express" the express component used to
   * default to. Use the first (and only) step in the definition; fall back
   * to "express" if the definition somehow has no steps.
   */
  protected readonly expressInputs = computed<Record<string, unknown>>(() => {
    const r = this.run();
    const stepId = this.steps()[0]?.id ?? 'express';
    return {
      stepId,
      componentName: this.definition()?.expressTemplateComponent ?? '',
      runId: r?.id ?? null,
      entityId: r?.entityId ?? null,
      entity: this.entity(),
      readonly: this.readonly(),
    };
  });

  // ─── D2 step rail clickability ──────────────────────────────────────

  /**
   * A step is "clickable" if it is the current step OR an earlier-completed
   * step. A step is "locked" (future) when its index > currentStepIndex
   * AND not all required gates between current and target pass.
   */
  protected isClickable(step: WorkflowStepDefinition): boolean {
    const idx = this.steps().findIndex(s => s.id === step.id);
    const currentIdx = this.currentStepIndex();
    if (idx <= currentIdx) return true;
    // Future steps: locked unless all preceding required steps' gates pass
    // (rare — typically only true after a jump-back from a later step).
    const map = this.completionMap();
    for (let i = 0; i < idx; i++) {
      const s = this.steps()[i];
      if (!s.required) continue;
      if (!map.get(s.id)) return false;
    }
    return true;
  }

  protected isFutureStep(step: WorkflowStepDefinition): boolean {
    return !this.isClickable(step);
  }

  protected isComplete(step: WorkflowStepDefinition): boolean {
    return this.completionMap().get(step.id) === true;
  }

  protected isCurrent(step: WorkflowStepDefinition): boolean {
    return this.currentStepId() === step.id;
  }

  // ─── Action handlers ────────────────────────────────────────────────

  protected jumpTo(step: WorkflowStepDefinition): void {
    if (!this.isClickable(step)) return;
    this.stepJumped.emit(step.id);
  }

  protected setMode(mode: 'express' | 'guided'): void {
    if (mode === this.mode()) return;
    // Mid-flow switch with unsaved data on the current step → confirm
    // before discarding, matching the dirty-form guard pattern used by
    // the dialog component. Persist no data here; the parent's mode-
    // change handler is what would round-trip to the server, and we
    // only want to fire that event after the user confirms.
    if (this.workflowService.currentStepDirty()) {
      this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: {
          title: this.translate.instant('workflow.shell.modeSwitch.confirmTitle'),
          message: this.translate.instant('workflow.shell.modeSwitch.confirmMessage'),
          confirmLabel: this.translate.instant('workflow.shell.modeSwitch.confirmAction'),
          severity: 'warn',
        } satisfies ConfirmDialogData,
      }).afterClosed().subscribe(confirmed => {
        if (confirmed) this.modeChanged.emit(mode);
      });
      return;
    }
    this.modeChanged.emit(mode);
  }

  protected back(): void {
    if (this.isFirstStep()) return;
    const prev = this.steps()[this.currentStepIndex() - 1];
    if (prev) this.stepBacked.emit(prev.id);
  }

  protected next(): void {
    if (this.isLastStep()) {
      this.completeRequested.emit();
      return;
    }
    const current = this.currentStep();
    if (current) this.stepAdvanced.emit(current.id);
  }

  protected skip(): void {
    const current = this.currentStep();
    if (!current || current.required) return;
    this.stepSkipped.emit(current.id);
  }

  protected close(): void {
    this.closed.emit();
  }
}

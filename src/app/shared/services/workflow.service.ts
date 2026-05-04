import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { FormGroup } from '@angular/forms';

import { Observable, Subscription, catchError, defer, map, of, shareReplay, tap, throwError } from 'rxjs';
import { startWith } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { EntityValidator } from '../models/entity-validator.model';
import { MissingValidator } from '../models/workflow-missing-validator.model';
import { WorkflowDefinition } from '../models/workflow-definition.model';
import { WorkflowRun } from '../models/workflow-run.model';
import { WorkflowStepDefinition } from '../models/workflow-step-definition.model';
import { FormValidationService } from './form-validation.service';
import { PredicateEvaluator } from './predicate-evaluator';

/**
 * Workflow Pattern Phase 4 — Angular WorkflowService.
 *
 * Orchestrates the workflow run lifecycle (start, get, patch, jump, complete,
 * abandon, mode-toggle, listActive) and evaluates step completion locally
 * against the loaded entity using the {@link PredicateEvaluator}. List
 * pages don't need this service — `status='Draft'` is enough for filtering;
 * the workflow surface only mounts when the shell is opened on a record.
 *
 * Per the spec: the server is the authoritative tier for promotion (the
 * workflow's "Mark Complete" delegates to entity-promote-status). This
 * service's local predicate eval drives the step rail's completion
 * indicators and the "can we complete?" check; final word goes to the
 * server's `complete` endpoint which re-runs the C# evaluator.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private readonly http = inject(HttpClient);
  private readonly evaluator = new PredicateEvaluator();

  // ─── State signals ───────────────────────────────────────────────────

  /** The currently mounted run (set when the shell loads a run). */
  readonly currentRun = signal<WorkflowRun | null>(null);

  /** Definition pinned to the current run. */
  readonly currentDefinition = signal<WorkflowDefinition | null>(null);

  /** Loaded entity (whatever shape the entity adapter returns). */
  readonly currentEntity = signal<unknown | null>(null);

  /** Validator catalog for the current entity type. */
  readonly currentValidators = signal<EntityValidator[]>([]);

  /**
   * Live validity of the currently mounted step's reactive form. The shell's
   * Continue button reads this to gate progression on required fields. Defaults
   * to `true` so steps without a form (e.g. acknowledge-only) don't block.
   */
  /**
   * Tracks whether the currently-mounted step's reactive form has been
   * touched / modified since its last save. Updated by registerStepForm()
   * via the form's statusChanges (which fire on dirty marks too).
   * Consumers: shell mode-toggle uses it to gate a 'discard unsaved
   * changes?' confirmation when the user switches express ↔ guided
   * mid-flow.
   */
  readonly currentStepDirty = signal<boolean>(false);

  readonly currentStepValid = signal<boolean>(true);

  /**
   * Live violation messages for the currently mounted step's form, formatted
   * for the shared `<app-validation-button>` popover. Cleared on step swap.
   */
  readonly currentStepViolations = signal<string[]>([]);

  private currentStepFormSub: Subscription | null = null;

  /**
   * Save callback registered by the currently-mounted step component. The
   * shell's parent invokes this via {@link saveCurrentStep} before navigating
   * (Continue / Back / Jump) so the user's in-progress edits are persisted
   * before the cursor moves. `null` when no step is mounted, when the mounted
   * step has no form, or when an acknowledge-only step intentionally opted out.
   *
   * Replaces the per-step debounced auto-save model that flapped on trailing
   * whitespace and other server-normalized values. See
   * `docs/coding-standards.md` (Workflow Save-on-Continue section) for the
   * design rationale.
   */
  private currentStepSaveCallback: (() => Observable<unknown>) | null = null;

  /** Mode (express / guided). Falls back to 'guided' until a run loads. */
  readonly mode = computed<'express' | 'guided'>(() => this.currentRun()?.mode ?? 'guided');

  /** Run pointer — id of the step the user was last on. */
  readonly currentStepId = computed(() => this.currentRun()?.currentStepId ?? null);

  /**
   * Per-step completion derived from the loaded entity + validator catalog.
   * For each step, every gate-id maps to a validator; ALL must pass to mark
   * the step complete. Steps with no gates (optional / acknowledge-only)
   * default to `false` until the user moves past them — the shell treats
   * "current step or earlier" as the meaningful navigation rule, not gate
   * passing per se.
   */
  readonly stepCompletionMap = computed<Map<string, boolean>>(() => {
    const def = this.currentDefinition();
    const entity = this.currentEntity();
    if (!def || !entity) return new Map();

    const validatorsById = new Map<string, EntityValidator>();
    for (const v of this.currentValidators()) {
      validatorsById.set(v.validatorId, v);
    }

    const out = new Map<string, boolean>();
    for (const step of def.steps) {
      if (step.completionGates.length === 0) {
        // No gates → step is "complete" iff it's been visited (i.e. the
        // current pointer has moved past it). The shell layers this
        // pointer-based nuance on top of the predicate-derived map.
        out.set(step.id, false);
        continue;
      }
      let allPass = true;
      for (const gateId of step.completionGates) {
        const v = validatorsById.get(gateId);
        if (!v) { allPass = false; break; }
        if (!this.evaluator.evaluateJson(v.predicate, entity)) { allPass = false; break; }
      }
      out.set(step.id, allPass);
    }
    return out;
  });

  /**
   * Whether the run is eligible for "Mark Complete" — every REQUIRED step's
   * gates pass. Optional steps don't block completion. The server tier
   * makes the final call when `completeRun()` POSTs.
   */
  readonly canCompleteRun = computed<boolean>(() => {
    const def = this.currentDefinition();
    if (!def) return false;
    const map = this.stepCompletionMap();
    for (const step of def.steps) {
      if (!step.required) continue;
      if (!map.get(step.id)) return false;
    }
    return true;
  });

  // ─── Caches keyed by entity type ─────────────────────────────────────

  private readonly definitionsCache = new Map<string, Observable<WorkflowDefinition[]>>();
  private readonly validatorsCache = new Map<string, Observable<EntityValidator[]>>();

  /**
   * Load all definitions for an entity type. Uses an in-memory shareReplay
   * cache so repeat callers (multiple workflow shells, dashboard widget,
   * resume prompt) hit the API once. `clearCaches()` empties the cache.
   */
  loadDefinitionsForEntity(entityType: string): Observable<WorkflowDefinition[]> {
    let cached = this.definitionsCache.get(entityType);
    if (!cached) {
      const params = new HttpParams().set('entityType', entityType);
      cached = this.http
        .get<RawWorkflowDefinitionResponse[]>(`${environment.apiUrl}/workflow-definitions`, { params })
        .pipe(
          map(rows => rows.map(parseDefinition)),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
      this.definitionsCache.set(entityType, cached);
    }
    return cached;
  }

  /** Same shape, for entity readiness validators. */
  loadValidatorsForEntity(entityType: string): Observable<EntityValidator[]> {
    let cached = this.validatorsCache.get(entityType);
    if (!cached) {
      const params = new HttpParams().set('entityType', entityType);
      cached = this.http
        .get<EntityValidator[]>(`${environment.apiUrl}/entity-validators`, { params })
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.validatorsCache.set(entityType, cached);
    }
    return cached;
  }

  /**
   * Resolve a single workflow definition by stable id. Tries the cache
   * keyed by entityType first when the caller already loaded the list,
   * falls back to the per-id endpoint.
   */
  getDefinitionById(definitionId: string): Observable<WorkflowDefinition> {
    return this.http
      .get<RawWorkflowDefinitionResponse>(
        `${environment.apiUrl}/workflow-definitions/${encodeURIComponent(definitionId)}`,
      )
      .pipe(map(parseDefinition));
  }

  // ─── Run lifecycle ───────────────────────────────────────────────────

  startRun(body: {
    entityType: string;
    definitionId: string;
    mode?: 'express' | 'guided';
    initialEntityData?: unknown;
  }): Observable<WorkflowRun> {
    return this.http.post<WorkflowRun>(`${environment.apiUrl}/workflows`, body)
      .pipe(tap(run => this.currentRun.set(run)));
  }

  getRun(runId: number): Observable<WorkflowRun> {
    return this.http.get<WorkflowRun>(`${environment.apiUrl}/workflows/${runId}`)
      .pipe(tap(run => this.currentRun.set(run)));
  }

  patchStep(runId: number, stepId: string, fields: unknown): Observable<WorkflowRun> {
    return this.http
      .patch<WorkflowRun>(`${environment.apiUrl}/workflows/${runId}/step`, { stepId, fields })
      .pipe(tap(run => this.currentRun.set(run)));
  }

  jumpToStep(runId: number, targetStepId: string): Observable<WorkflowRun> {
    return this.http
      .patch<WorkflowRun>(`${environment.apiUrl}/workflows/${runId}/jump`, { targetStepId })
      .pipe(tap(run => this.currentRun.set(run)));
  }

  /**
   * Mark Complete — server runs entity readiness validators, promotes if
   * they pass, otherwise returns 409 with `{ missing: MissingValidator[] }`.
   * The Observable resolves to a tagged result so the caller can branch
   * without try/catch.
   */
  completeRun(runId: number): Observable<{ success: true; run: WorkflowRun } | { success: false; missing: MissingValidator[] }> {
    return this.http
      .post<WorkflowRun>(`${environment.apiUrl}/workflows/${runId}/complete`, {})
      .pipe(
        tap(run => this.currentRun.set(run)),
        map(run => ({ success: true as const, run })),
        catchError((err: HttpErrorResponse) => {
          if (err.status === 409 && Array.isArray(err.error?.missing)) {
            return of({ success: false as const, missing: err.error.missing as MissingValidator[] });
          }
          return throwError(() => err);
        }),
      );
  }

  abandonRun(runId: number, reason?: string): Observable<WorkflowRun> {
    return this.http
      .post<WorkflowRun>(`${environment.apiUrl}/workflows/${runId}/abandon`, { reason: reason ?? null })
      .pipe(tap(run => this.currentRun.set(run)));
  }

  setMode(runId: number, mode: 'express' | 'guided'): Observable<WorkflowRun> {
    return this.http
      .patch<WorkflowRun>(`${environment.apiUrl}/workflows/${runId}/mode`, { mode })
      .pipe(tap(run => this.currentRun.set(run)));
  }

  listActive(): Observable<WorkflowRun[]> {
    return this.http.get<WorkflowRun[]>(`${environment.apiUrl}/workflows/active`);
  }

  /**
   * Promote an entity status directly (no workflow involved). Same gate as
   * a workflow's Mark Complete — useful from entity detail pages where the
   * user wants to skip the guided UX entirely. Server returns 200 + new
   * status on pass, 409 + missing list on fail.
   */
  promoteEntityStatus(
    entityType: string,
    entityId: number,
    targetStatus: string,
  ): Observable<{ success: true } | { success: false; missing: MissingValidator[] }> {
    const url = `${environment.apiUrl}/${entityTypeToRoute(entityType)}/${entityId}/promote-status`;
    return this.http.post(url, { targetStatus }).pipe(
      map(() => ({ success: true as const })),
      catchError((err: HttpErrorResponse) => {
        if (err.status === 409 && Array.isArray(err.error?.missing)) {
          return of({ success: false as const, missing: err.error.missing as MissingValidator[] });
        }
        return throwError(() => err);
      }),
    );
  }

  // ─── Shell mounting helpers ─────────────────────────────────────────

  /** Set the current run + definition + entity all at once (called by the shell on mount). */
  setContext(opts: {
    run: WorkflowRun | null;
    definition: WorkflowDefinition | null;
    entity: unknown | null;
    validators: EntityValidator[];
  }): void {
    this.currentRun.set(opts.run);
    this.currentDefinition.set(opts.definition);
    this.currentEntity.set(opts.entity);
    this.currentValidators.set(opts.validators);
  }

  /** Clears the loaded run / definition / entity (called when the shell unmounts). */
  clearContext(): void {
    this.currentRun.set(null);
    this.currentDefinition.set(null);
    this.currentEntity.set(null);
    this.currentValidators.set([]);
    this.unregisterStepForm();
  }

  /**
   * Step components register their reactive form here on mount so the shell's
   * Continue button can gate on form validity and surface violations through
   * the standard `<app-validation-button>` popover. `labels` maps form-control
   * names to human-readable labels for the popover ("Lead Time Days is
   * required" vs "leadTimeDays is required").
   *
   * Optional `save` callback: invoked by the shell's parent via
   * {@link saveCurrentStep} before navigating away (Continue / Back / Jump).
   * Replaces the per-step debounced auto-save that previously flapped on
   * server-normalized values (trailing whitespace, case-folding, etc.). The
   * callback should return an Observable that completes when the persistence
   * round-trip resolves; the shell-parent waits for it before advancing the
   * cursor. Steps with no persistent state (acknowledge-only) omit the
   * callback and `saveCurrentStep` becomes a no-op.
   *
   * Each call replaces the prior subscription — *ngComponentOutlet destroys
   * the old step before mounting the new one, so when this fires the prior
   * registration's destroy hook has already cleared. Defensive
   * unregisterStepForm() handles the rare overlap.
   */
  registerStepForm(
    form: FormGroup,
    labels: Record<string, string>,
    save?: () => Observable<unknown>,
  ): void {
    this.unregisterStepForm();
    const refresh = (): void => {
      this.currentStepValid.set(form.valid);
      this.currentStepDirty.set(form.dirty);
      this.currentStepViolations.set(FormValidationService.collectViolations(form, labels));
    };
    this.currentStepFormSub = form.statusChanges.pipe(startWith(form.status)).subscribe(refresh);
    this.currentStepSaveCallback = save ?? null;
    refresh();
  }

  /** Step components call this from `destroyRef.onDestroy()` to clean up. */
  unregisterStepForm(): void {
    this.currentStepFormSub?.unsubscribe();
    this.currentStepFormSub = null;
    this.currentStepSaveCallback = null;
    this.currentStepValid.set(true);
    this.currentStepDirty.set(false);
    this.currentStepViolations.set([]);
  }

  /**
   * Persist the currently-mounted step's edits via its registered save
   * callback, then resolve to a tagged result the shell-parent can branch on.
   * If no callback was registered (acknowledge-only step, or no form) this
   * resolves immediately as `{ ok: true }` so callers can `.subscribe(r => if
   * (r.ok) advance())` without special-casing.
   *
   * Errors from the save callback are caught and reported as
   * `{ ok: false, error }` — the shell-parent should NOT advance on `ok:
   * false`. The step component is responsible for surfacing user-facing error
   * messaging (snackbar / toast); this method's job is purely the
   * proceed/abort signal.
   *
   * Wrapped in `defer` so callers re-trigger fresh saves on every subscribe
   * — without it the same Observable would short-circuit on a second
   * Continue click.
   */
  saveCurrentStep(): Observable<{ ok: true } | { ok: false; error: unknown }> {
    return defer(() => {
      const cb = this.currentStepSaveCallback;
      if (!cb) return of({ ok: true as const });
      return cb().pipe(
        map(() => ({ ok: true as const })),
        catchError((error: unknown) => of({ ok: false as const, error })),
      );
    });
  }

  /** Drop cached definition / validator fetches — useful after admin edits. */
  clearCaches(): void {
    this.definitionsCache.clear();
    this.validatorsCache.clear();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Server returns `WorkflowDefinitionResponseModel` with `stepsJson` as a
 * raw string. Parse it into an array; preserve the original JSON for any
 * caller that wants to round-trip back without re-serializing.
 */
interface RawWorkflowDefinitionResponse {
  id: number;
  definitionId: string;
  entityType: string;
  defaultMode: 'express' | 'guided';
  stepsJson: string;
  expressTemplateComponent: string | null;
  isSeedData: boolean;
}

function parseDefinition(raw: RawWorkflowDefinitionResponse): WorkflowDefinition {
  let steps: WorkflowStepDefinition[] = [];
  try {
    const parsed: unknown = JSON.parse(raw.stepsJson ?? '[]');
    if (Array.isArray(parsed)) {
      steps = parsed
        .filter((s): s is WorkflowStepDefinition => isStepDefinition(s));
    }
  } catch {
    // Malformed steps JSON — leave steps empty so the shell shows a
    // "definition is unusable" empty state rather than crashing.
    steps = [];
  }
  return {
    id: raw.id,
    definitionId: raw.definitionId,
    entityType: raw.entityType,
    defaultMode: raw.defaultMode,
    steps,
    stepsJson: raw.stepsJson,
    expressTemplateComponent: raw.expressTemplateComponent,
    isSeedData: raw.isSeedData,
  };
}

function isStepDefinition(value: unknown): value is WorkflowStepDefinition {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['labelKey'] === 'string' &&
    typeof v['componentName'] === 'string' &&
    typeof v['required'] === 'boolean' &&
    Array.isArray(v['completionGates'])
  );
}

/**
 * Map a logical entity type ("Part", "Customer") to its REST route segment
 * for promote-status. The substrate's promoter convention is plural-noun
 * routes — here we lowercase + pluralize, mirroring the existing project
 * convention.
 */
function entityTypeToRoute(entityType: string): string {
  const lower = entityType.toLowerCase();
  if (lower.endsWith('s')) return lower;
  return `${lower}s`;
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { forkJoin, map } from 'rxjs';

import { EntityValidator } from '../../../../shared/models/entity-validator.model';
import { LoadingService } from '../../../../shared/services/loading.service';
import { MissingValidator } from '../../../../shared/models/workflow-missing-validator.model';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowDefinition } from '../../../../shared/models/workflow-definition.model';
import { WorkflowComponent } from '../../../../shared/components/workflow/workflow.component';
import { WorkflowRun } from '../../../../shared/models/workflow-run.model';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Workflow Pattern Phase 5 — Parent page that mounts the generic
 * {@link WorkflowComponent} shell over a Part. URL-as-source-of-truth: the
 * `?workflow={definitionId}` query param toggles this view; `?step=` and
 * `?mode=` track the user's progress and presentation choice.
 *
 * Owns the wiring between the shell's typed events and the
 * {@link WorkflowService}'s API calls — keeps the shell pure of HTTP concerns.
 */
@Component({
  selector: 'app-part-workflow-page',
  standalone: true,
  imports: [TranslatePipe, WorkflowComponent],
  templateUrl: './part-workflow-page.component.html',
  styleUrl: './part-workflow-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartWorkflowPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly loading = inject(LoadingService);

  protected readonly part = signal<PartDetail | null>(null);
  protected readonly run = signal<WorkflowRun | null>(null);
  protected readonly definition = signal<WorkflowDefinition | null>(null);
  protected readonly validators = signal<EntityValidator[]>([]);
  protected readonly missingValidators = signal<MissingValidator[]>([]);

  // ── URL-bound state ──
  private readonly partIdFromUrl = toSignal(
    this.route.paramMap.pipe(map((p) => {
      const raw = p.get('id');
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    })),
    { initialValue: 0 },
  );

  /**
   * Run id from query string. Used by the entity-less /parts/new path before
   * deferred materialization stamps an entityId; once materialized the page
   * upgrades the URL to /parts/{id}?... but keeps `runId=` so deep links and
   * back-nav can resume the same in-flight run.
   */
  private readonly runIdFromUrl = toSignal(
    this.route.queryParamMap.pipe(map((p) => {
      const raw = p.get('runId');
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    })),
    { initialValue: 0 },
  );

  private readonly definitionIdFromUrl = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('workflow') ?? '')),
    { initialValue: '' },
  );

  private readonly stepFromUrl = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('step') ?? '')),
    { initialValue: '' },
  );

  private readonly modeFromUrl = toSignal(
    this.route.queryParamMap.pipe(map((p) => (p.get('mode') === 'express' ? 'express' : 'guided') as 'express' | 'guided')),
    { initialValue: 'guided' as 'express' | 'guided' },
  );

  protected readonly entityTitle = computed(() => {
    const p = this.part();
    if (p) return `${p.partNumber} — ${p.description ?? ''}`.trim().replace(/—\s*$/, '').trim();
    // Entity-less workflow path (/parts/new before first patch materializes
    // the row). The shell still mounts and the user is filling the basics
    // step — calling that "Loading…" is wrong because nothing is loading,
    // the entity literally hasn't been created yet. Surface "New part"
    // until the basics patch stamps an entity id and the title can switch
    // to the real part number + description.
    if (this.run()) return this.translate.instant('parts.workflow.page.newTitle');
    return this.translate.instant('parts.workflow.page.loadingTitle');
  });

  constructor() {
    effect(() => {
      const partId = this.partIdFromUrl();
      const runId = this.runIdFromUrl();
      const definitionId = this.definitionIdFromUrl();
      if (!definitionId) return;
      // Two entry paths converge on the same loader:
      //  • /parts/{id}?workflow=...      → load by partId (existing entity)
      //  • /parts/new?runId=N&workflow=… → load by runId (entity not yet materialized)
      if (partId) {
        this.loadWorkflowContext(partId, definitionId);
        return;
      }
      if (runId) {
        this.loadEntitylessWorkflow(runId, definitionId);
      }
    });

    // Deferred-materialization URL upgrade — when the workflow service emits
    // a run with a freshly-stamped entityId (after the basics step's first
    // patch), swap /parts/new for /parts/{id} via replaceUrl so the URL
    // matches reality and downstream nav (refresh, share, back-nav) lands
    // on the right page. Only runs when we're on /parts/new (partId === 0).
    effect(() => {
      const run = this.workflowService.currentRun();
      if (!run || run.entityId == null) return;
      if (this.partIdFromUrl() !== 0) return; // already on /parts/{id}
      this.router.navigate(['/parts', run.entityId], {
        queryParams: { runId: run.id },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    // When the URL step changes (back/forward, jump), patch the run pointer.
    effect(() => {
      const target = this.stepFromUrl();
      const run = this.run();
      if (!target || !run) return;
      if (run.currentStepId === target) return;
      this.run.set({ ...run, currentStepId: target });
    });

    // When the URL mode changes, patch the run mode.
    effect(() => {
      const mode = this.modeFromUrl();
      const run = this.run();
      if (!run || run.mode === mode) return;
      this.run.set({ ...run, mode });
    });

    // After any step's patchStep round-trip, the step component refetches the
    // entity and writes it to workflowService.currentEntity. Mirror that into
    // this page's `part` signal so the shell's `[entity]` input — and every
    // downstream step's hydration effect + the rail's completionMap — see
    // the latest persisted state. Without this, navigating to a later step
    // shows blank fields and the rail's gate predicates evaluate against
    // the stale snapshot from the initial load (steps never tick complete).
    effect(() => {
      const fresh = this.workflowService.currentEntity() as PartDetail | null;
      if (!fresh) return;
      const current = this.part();
      if (current === fresh) return;
      this.part.set(fresh);
    });
  }

  /**
   * Entity-less variant: the route is /parts/new with `runId=` in the query
   * string, meaning the workflow run exists but its primary entity hasn't
   * been materialized yet (deferred materialization). Load just the run +
   * definition + validators — entity stays null until the basics step's
   * first patch returns a stamped entityId, at which point the URL-upgrade
   * effect swings the page over to /parts/{id} for the rest of the flow.
   */
  private loadEntitylessWorkflow(runId: number, definitionId: string): void {
    this.loading.start('part-workflow', this.translate.instant('parts.workflow.page.loading'));
    forkJoin({
      run: this.workflowService.getRun(runId),
      definitions: this.workflowService.loadDefinitionsForEntity('Part'),
      validators: this.workflowService.loadValidatorsForEntity('Part'),
    }).subscribe({
      next: ({ run, definitions, validators }) => {
        this.loading.stop('part-workflow');
        const definition = definitions.find((d) => d.definitionId === definitionId) ?? null;
        if (!definition) {
          this.snackbar.error(this.translate.instant('parts.workflow.page.definitionMissing'));
          this.router.navigate(['/parts']);
          return;
        }
        // If the run was already materialized (e.g. user navigated back to
        // /parts/new after the URL upgrade fired), the URL-upgrade effect
        // will swing us to /parts/{id} on the next tick. Until then, render
        // the shell with whatever entity we can quickly fetch.
        if (run.entityId != null) {
          this.partsService.getPartById(run.entityId).subscribe({
            next: (part) => {
              this.part.set(part);
              this.run.set(run);
              this.definition.set(definition);
              this.validators.set(validators);
              this.workflowService.setContext({ run, definition, entity: part, validators });
            },
          });
          return;
        }
        this.part.set(null);
        this.run.set(run);
        this.definition.set(definition);
        this.validators.set(validators);
        this.workflowService.setContext({ run, definition, entity: null, validators });
      },
      error: () => {
        this.loading.stop('part-workflow');
        this.snackbar.error(this.translate.instant('parts.workflow.page.loadFailed'));
        this.router.navigate(['/parts']);
      },
    });
  }

  private loadWorkflowContext(partId: number, definitionId: string): void {
    this.loading.start('part-workflow', this.translate.instant('parts.workflow.page.loading'));

    forkJoin({
      part: this.partsService.getPartById(partId),
      activeRuns: this.workflowService.listActive(),
      definitions: this.workflowService.loadDefinitionsForEntity('Part'),
      validators: this.workflowService.loadValidatorsForEntity('Part'),
    }).subscribe({
      next: ({ part, activeRuns, definitions, validators }) => {
        this.loading.stop('part-workflow');
        const definition = definitions.find((d) => d.definitionId === definitionId) ?? null;
        if (!definition) {
          this.snackbar.error(this.translate.instant('parts.workflow.page.definitionMissing'));
          this.router.navigate(['/parts']);
          return;
        }

        const run = activeRuns.find((r) => r.entityType === 'Part' && r.entityId === partId
          && r.completedAt == null && r.abandonedAt == null
          && r.definitionId === definitionId) ?? null;

        // No active run for this part + definition? Start one.
        if (!run) {
          this.workflowService.startRun({
            entityType: 'Part',
            definitionId,
            mode: this.modeFromUrl(),
          }).subscribe({
            next: (created) => {
              this.run.set(created);
              this.part.set(part);
              this.definition.set(definition);
              this.validators.set(validators);
              this.workflowService.setContext({ run: created, definition, entity: part, validators });
            },
            error: () => {
              this.snackbar.error(this.translate.instant('parts.workflow.page.startFailed'));
              this.router.navigate(['/parts']);
            },
          });
        } else {
          this.part.set(part);
          this.run.set(run);
          this.definition.set(definition);
          this.validators.set(validators);
          this.workflowService.setContext({ run, definition, entity: part, validators });

          // Sync URL ?step= to the run's pointer if missing. Only meaningful
          // in guided mode — express mode has no step rail so the ?step=
          // param would be cosmetic noise.
          if (run.mode === 'guided' && !this.stepFromUrl() && run.currentStepId) {
            this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { step: run.currentStepId, mode: run.mode },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          }
        }
      },
      error: () => {
        this.loading.stop('part-workflow');
        this.snackbar.error(this.translate.instant('parts.workflow.page.loadFailed'));
        this.router.navigate(['/parts']);
      },
    });
  }

  protected onModeChanged(mode: 'express' | 'guided'): void {
    const run = this.run();
    if (!run || run.mode === mode) return;
    // Flush the active step's in-flight form edits BEFORE switching modes.
    // Without this, typing into the basics-step's Name field then clicking
    // Express loses the typed value: the express form mounts and seeds
    // from the server entity which never received the patch. Bug repro:
    // type "Bob Plastic" in guided basics → click Express → form shows
    // "Bob Plastic" but validation says "Name is required" because the
    // express form's FormControl was seeded from a stale (no-Name)
    // entity snapshot. saveCurrentStep is a no-op when nothing is
    // registered or the form is pristine.
    this.workflowService.saveCurrentStep().subscribe({
      next: () => {
        this.workflowService.setMode(run.id, mode).subscribe({
          next: (updated) => {
            this.run.set(updated);
            this.workflowService.currentRun.set(updated);
            this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { mode },
              queryParamsHandling: 'merge',
            });
          },
        });
      },
    });
  }

  /**
   * Issue the server-side cursor jump + URL update. Does NOT save the active
   * step's edits — callers that need a save-then-navigate flow should go
   * through {@link saveThenNavigate} instead. This stays separate so Skip
   * (which intentionally bypasses save) doesn't accidentally trigger one.
   */
  private navigateToStep(stepId: string): void {
    const run = this.run();
    if (!run) return;
    this.workflowService.jumpToStep(run.id, stepId).subscribe({
      next: (updated) => {
        this.run.set(updated);
        this.workflowService.currentRun.set(updated);
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { step: stepId },
          queryParamsHandling: 'merge',
        });
      },
    });
  }

  /**
   * Save the active step (via the registered save callback), then jump.
   * Used by Continue / Back / explicit Jump-to-step from the rail. If the
   * save fails, the jump does not happen — the step stays mounted so the
   * user can fix the issue and try again. The step component is responsible
   * for surfacing the error message; this just gates the navigation.
   */
  private saveThenNavigate(stepId: string): void {
    this.workflowService.saveCurrentStep().subscribe({
      next: (result) => {
        if (result.ok) this.navigateToStep(stepId);
        // ok: false → step component already surfaced its error. Stay put.
      },
    });
  }

  protected onStepJumped(stepId: string): void {
    this.saveThenNavigate(stepId);
  }

  protected onStepAdvanced(currentStepId: string): void {
    const def = this.definition();
    if (!def) return;
    const idx = def.steps.findIndex((s) => s.id === currentStepId);
    const next = def.steps[idx + 1]?.id;
    if (!next) return;
    this.saveThenNavigate(next);
  }

  protected onStepBacked(targetStepId: string): void {
    this.saveThenNavigate(targetStepId);
  }

  /**
   * Skip is for OPTIONAL steps where the user is explicitly bypassing without
   * commit. Do NOT call saveCurrentStep — by definition the user is choosing
   * to discard whatever they may have typed. Just navigate.
   */
  protected onStepSkipped(currentStepId: string): void {
    const def = this.definition();
    if (!def) return;
    const idx = def.steps.findIndex((s) => s.id === currentStepId);
    const next = def.steps[idx + 1]?.id;
    if (!next) return;
    this.navigateToStep(next);
  }

  protected onCompleteRequested(): void {
    const run = this.run();
    if (!run) return;
    // Save the active step first — otherwise the user's in-progress edits on
    // the LAST step never persist before the server runs its readiness gates.
    // Pre-refactor that worked because of debounced auto-save; post-refactor
    // the only persistence trigger is an explicit save call.
    this.workflowService.saveCurrentStep().subscribe({
      next: (saveResult) => {
        if (!saveResult.ok) return;
        this.workflowService.completeRun(run.id).subscribe({
          next: (result) => {
            if (result.success) {
              this.snackbar.success(this.translate.instant('parts.workflow.page.completeSuccess'));
              this.router.navigate(['/parts']);
            } else {
              this.missingValidators.set(result.missing);
              // Prefer the missingMessageKey (human "needs name + material + …")
              // over the gate name ("Basics") so the user knows which fields.
              const missingDescription = result.missing
                .map((m) => this.translate.instant(m.missingMessageKey ?? m.displayNameKey))
                .join('; ');
              this.snackbar.error(this.translate.instant('parts.workflow.page.missingValidators', {
                missing: missingDescription,
              }));
            }
          },
        });
      },
    });
  }

  protected onClosed(): void {
    // Both /parts/new and /parts/:id map to this same workflow page, so
    // just dropping the workflow query params would re-render the same
    // route with nothing to show ("Loading workflow…" forever). Navigate
    // fully back to the parts list instead — the user's intent on close
    // is "I'm done with this", not "I want to stay on the same URL".
    this.workflowService.clearContext();
    this.router.navigate(['/parts']);
  }
}

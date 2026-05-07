import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import { EntityValidator } from '../../shared/models/entity-validator.model';
import { WorkflowDefinition } from '../../shared/models/workflow-definition.model';
import { WorkflowRun } from '../../shared/models/workflow-run.model';
import { WorkflowComponent } from '../../shared/components/workflow/workflow.component';

/**
 * Workflow Pattern Phase 4 — Standalone demo route to verify the shell
 * renders end-to-end without per-entity wiring.
 *
 * This route mounts {@link WorkflowComponent} with a hand-built run +
 * definition + validators payload, mirroring `part-assembly-guided-v1`
 * from the design doc's worked example. The user can edit fields in
 * an inline form below and watch the shell's step-rail completion
 * indicators update in real time.
 *
 * Entity state is stored in a `signal()` so changes propagate to the
 * shell's predicate evaluator. URL query params drive `?step=` and
 * `?mode=` for the URL-as-source-of-truth contract — Browser back/forward
 * walks the workflow.
 */
@Component({
  selector: 'app-workflow-shell-demo',
  standalone: true,
  imports: [CommonModule, WorkflowComponent],
  templateUrl: './workflow-shell-demo.component.html',
  styleUrl: './workflow-shell-demo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowShellDemoComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Inline demo data — mirrors part-assembly-guided-v1.
  protected readonly definition = signal<WorkflowDefinition>({
    id: 1,
    definitionId: 'part-assembly-guided-v1',
    entityType: 'Part',
    defaultMode: 'guided',
    steps: [
      { id: 'basics', labelKey: 'workflow.demo.steps.basics', componentName: 'PartBasicsStepComponent', required: true, completionGates: ['hasBasics'] },
      { id: 'bom', labelKey: 'workflow.demo.steps.bom', componentName: 'PartBomStepComponent', required: true, completionGates: ['hasBom'] },
      { id: 'routing', labelKey: 'workflow.demo.steps.routing', componentName: 'PartRoutingStepComponent', required: true, completionGates: ['hasRouting'] },
      { id: 'costing', labelKey: 'workflow.demo.steps.costing', componentName: 'PartCostingStepComponent', required: true, completionGates: ['hasCost'] },
      { id: 'alternates', labelKey: 'workflow.demo.steps.alternates', componentName: 'PartAlternatesStepComponent', required: false, completionGates: [] },
    ],
    stepsJson: '[]',
    expressTemplateComponent: 'PartExpressFormComponent',
    isSeedData: true,
  });

  protected readonly validators = signal<EntityValidator[]>([
    { id: 1, entityType: 'Part', validatorId: 'hasBasics',
      predicate: JSON.stringify({
        type: 'all',
        of: [
          { type: 'fieldPresent', field: 'name' },
          { type: 'fieldPresent', field: 'type' },
          { type: 'fieldPresent', field: 'material' },
        ],
      }),
      displayNameKey: 'workflow.demo.readiness.basics',
      missingMessageKey: 'workflow.demo.readiness.basicsMissing',
      isSeedData: true,
    },
    { id: 2, entityType: 'Part', validatorId: 'hasBom',
      predicate: JSON.stringify({ type: 'relationExists', relation: 'bomEntries', minCount: 1 }),
      displayNameKey: 'workflow.demo.readiness.bom',
      missingMessageKey: 'workflow.demo.readiness.bomMissing',
      isSeedData: true,
    },
    { id: 3, entityType: 'Part', validatorId: 'hasRouting',
      predicate: JSON.stringify({ type: 'relationExists', relation: 'operations', minCount: 1 }),
      displayNameKey: 'workflow.demo.readiness.routing',
      missingMessageKey: 'workflow.demo.readiness.routingMissing',
      isSeedData: true,
    },
    { id: 4, entityType: 'Part', validatorId: 'hasCost',
      predicate: JSON.stringify({
        type: 'any',
        of: [
          { type: 'fieldPresent', field: 'manualCostOverride' },
          { type: 'fieldPresent', field: 'currentCostCalculationId' },
        ],
      }),
      displayNameKey: 'workflow.demo.readiness.cost',
      missingMessageKey: 'workflow.demo.readiness.costMissing',
      isSeedData: true,
    },
  ]);

  /** Demo entity. Editable via the inline form below the shell. */
  protected readonly entity = signal<Record<string, unknown>>({
    name: '',
    type: '',
    material: '',
    bomEntries: [] as unknown[],
    operations: [] as unknown[],
    manualCostOverride: null,
    currentCostCalculationId: null,
  });

  // URL-bound state — `?mode=` and `?step=`.
  private readonly modeFromUrl = toSignal(
    this.route.queryParamMap.pipe(map(p => (p.get('mode') === 'express' ? 'express' : 'guided'))),
    { initialValue: 'guided' as 'express' | 'guided' },
  );

  private readonly stepFromUrl = toSignal(
    this.route.queryParamMap.pipe(map(p => p.get('step') ?? 'basics')),
    { initialValue: 'basics' },
  );

  protected readonly run = computed<WorkflowRun>(() => ({
    id: 999,
    entityType: 'Part',
    entityId: 999,
    definitionId: 'part-assembly-guided-v1',
    currentStepId: this.stepFromUrl() ?? 'basics',
    mode: this.modeFromUrl() ?? 'guided',
    startedAt: '2026-04-29T00:00:00Z',
    startedByUserId: 0,
    completedAt: null,
    abandonedAt: null,
    abandonedReason: null,
    lastActivityAt: '2026-04-29T00:00:00Z',
    version: 1,
  }));

  protected onModeChanged(mode: 'express' | 'guided'): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode },
      queryParamsHandling: 'merge',
    });
  }

  protected onStepJumped(stepId: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: stepId },
      queryParamsHandling: 'merge',
    });
  }

  protected onStepAdvanced(currentStepId: string): void {
    const steps = this.definition().steps;
    const idx = steps.findIndex(s => s.id === currentStepId);
    const next = steps[idx + 1]?.id ?? currentStepId;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: next },
      queryParamsHandling: 'merge',
    });
  }

  protected onStepBacked(targetStepId: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step: targetStepId },
      queryParamsHandling: 'merge',
    });
  }

  protected onStepSkipped(currentStepId: string): void {
    // Skip = same as advance for the demo (skipping an optional last step
    // means complete; demo just routes forward).
    this.onStepAdvanced(currentStepId);
  }

  protected onCompleteRequested(): void {
    // Demo: just announce. The real shell would call WorkflowService.completeRun().
     
    alert('Demo: Mark Complete — would call WorkflowService.completeRun() against a real run.');
  }

  protected onClosed(): void {
    this.router.navigate(['/dashboard']);
  }

  // ─── Inline editor handlers — drive the entity signal ──────────────

  protected setField(field: string, value: unknown): void {
    this.entity.update(e => ({ ...e, [field]: value }));
  }

  protected addBomEntry(): void {
    this.entity.update(e => ({
      ...e,
      bomEntries: [...((e['bomEntries'] as unknown[]) ?? []), { id: Date.now() }],
    }));
  }

  protected addOperation(): void {
    this.entity.update(e => ({
      ...e,
      operations: [...((e['operations'] as unknown[]) ?? []), { id: Date.now() }],
    }));
  }

  protected getName = (): string => (this.entity()['name'] as string) ?? '';
  protected getType = (): string => (this.entity()['type'] as string) ?? '';
  protected getMaterial = (): string => (this.entity()['material'] as string) ?? '';
  protected getBomCount = (): number => ((this.entity()['bomEntries'] as unknown[]) ?? []).length;
  protected getOperationCount = (): number => ((this.entity()['operations'] as unknown[]) ?? []).length;
}

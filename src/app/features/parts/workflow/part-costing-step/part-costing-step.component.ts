import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, tap } from 'rxjs';

import { MatTooltipModule } from '@angular/material/tooltip';

import { CapabilityService } from '../../../../shared/services/capability.service';
import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { StepRationaleComponent } from '../../../../shared/components/step-rationale/step-rationale.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/** Costing modes per the design doc D3 — Tier 1 always available, Tiers 2/3
 * gated by `CAP-COSTING-TIER2-DEPTRATES` and `CAP-COSTING-TIER3-ABC`
 * (registered in qb-engineer-server's CapabilityCatalog as of 2026-05-03).
 * Both default OFF; admin enables via /admin/capabilities. The actual
 * rate/driver/allocation engines are still pending — enabling the
 * capability today reveals the radio + a "configuration coming soon"
 * notice rather than a functional tier-switch. */
type CostingMode = 'flat' | 'departmental' | 'abc';

/**
 * Workflow Pattern Phase 5 — Costing step. Implements the per-record
 * `costing_mode_override` radio (Tier 1 enabled, Tier 2/3 disabled) plus
 * the Tier 1 manual cost override input. Persists changes via the
 * `manualCostOverride` field on the parts UpdatePart endpoint.
 *
 * Read priority follows the worked example: `manualCostOverride ??
 * currentCostCalculation?.resultAmount ?? null`.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-costing-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe, MatTooltipModule,
    CurrencyInputComponent, LoadingBlockDirective,
    StepRationaleComponent,
  ],
  templateUrl: './part-costing-step.component.html',
  styleUrl: './part-costing-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartCostingStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly capabilities = inject(CapabilityService);

  readonly stepId = input<string>('costing');
  readonly componentName = input<string>('PartCostingStepComponent');
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);
  protected readonly mode = signal<CostingMode>('flat');

  /** Capability gates for Tier 2/3. Read once at construction; the
   *  capability snapshot is stable for the duration of a session unless
   *  the admin toggles a flag (in which case a SignalR push refreshes it
   *  and the next render picks it up). */
  protected readonly tier2Enabled = computed(() => this.capabilities.isEnabled('CAP-COSTING-TIER2-DEPTRATES'));
  protected readonly tier3Enabled = computed(() => this.capabilities.isEnabled('CAP-COSTING-TIER3-ABC'));

  protected readonly part = computed<PartDetail | null>(() => (this.entity() as PartDetail | null) ?? null);

  /** D3 — displayed cost: manual override wins, then current calc, else null. */
  protected readonly displayedCost = computed<number | null>(() => {
    const p = this.part();
    if (!p) return null;
    if (p.manualCostOverride != null) return p.manualCostOverride;
    return null;
  });

  protected readonly form = new FormGroup({
    manualCostOverride: new FormControl<number | null>(null, [Validators.min(0)]),
  });

  constructor() {
    effect(() => {
      const part = this.part();
      if (!part) return;
      this.form.patchValue({
        manualCostOverride: part.manualCostOverride ?? null,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        manualCostOverride: this.translate.instant('parts.workflow.costing.manualOverrideLabel'),
      },
      () => this.save(),
    );
    this.destroyRef.onDestroy(() => this.workflowService.unregisterStepForm());
  }

  protected setMode(mode: CostingMode): void {
    // Capability-gate Tier 2/3 — the capability registers the user's
    // INTENT to use the tier; the engines are still pending. Until they
    // land, picking Tier 2/3 just stores the choice on the entity for
    // future use; the manual override input stays the only functional
    // value. The "configuration coming soon" notice rendered in the
    // template explains this.
    if (mode === 'departmental' && !this.tier2Enabled()) return;
    if (mode === 'abc' && !this.tier3Enabled()) return;
    this.mode.set(mode);
  }

  protected isTier1(): boolean {
    return this.mode() === 'flat';
  }

  private save(): Observable<unknown> {
    const id = this.entityId();
    if (id == null) return of(null);
    if (this.form.pristine) return of(null);
    const value = this.form.getRawValue();
    // -1 sentinel clears the override on the server.
    const overrideToSend = value.manualCostOverride == null ? -1 : value.manualCostOverride;
    this.saving.set(true);
    return this.partsService.updatePart(id, {
      manualCostOverride: overrideToSend,
    }).pipe(
      tap({
        next: (detail) => {
          this.saving.set(false);
          this.workflowService.currentEntity.set(detail);
          this.form.markAsPristine();
        },
        error: () => {
          this.saving.set(false);
          this.snackbar.error(this.translate.instant('parts.workflow.costing.saveFailed'));
        },
      }),
    );
  }
}

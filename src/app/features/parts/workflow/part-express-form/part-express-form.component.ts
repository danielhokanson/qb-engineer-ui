import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { AbcClass } from '../../models/abc-class.type';
import { PartDetail } from '../../models/part-detail.model';
import { TraceabilityType } from '../../models/traceability-type.type';

/**
 * Workflow Pattern Phase 5 — Express form for parts.
 *
 * Single-step variant: every gated field visible at once. Same fields as the
 * guided basics + costing steps combined. The user clicks Save once they're
 * happy and the workflow promotes the part on success.
 *
 * Pre-beta: dropped the legacy single-axis `partType` + free-text `material`
 * controls; the three orthogonal axes are set by the fork dialog before this
 * form opens, and the material spec FK lives on the dedicated material
 * cluster (post-promotion).
 */
@Component({
  selector: 'app-part-express-form',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    InputComponent, SelectComponent, TextareaComponent, LoadingBlockDirective,
    ValidationButtonComponent, CurrencyInputComponent,
  ],
  templateUrl: './part-express-form.component.html',
  styleUrl: './part-express-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartExpressFormComponent {
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  readonly stepId = input<string>('express');
  readonly componentName = input<string>('PartExpressFormComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly part = computed<PartDetail | null>(() => (this.entity() as PartDetail | null) ?? null);

  /**
   * Render a small read-only chip showing the procurement+inventory axes the
   * fork dialog locked in. The axes can't be changed from this form — go
   * through the part detail page if you need to switch them.
   */
  protected readonly axisLabel = computed<string>(() => {
    const p = this.part();
    if (!p) return '';
    return `${p.procurementSource} · ${p.inventoryClass}`;
  });

  protected readonly form = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(256)]),
    description: new FormControl('', [Validators.maxLength(2000)]),
    // Tier 0 — replaces legacy isSerialTracked boolean. Defaults None.
    traceabilityType: new FormControl<TraceabilityType>('None', [Validators.required]),
    // Tier 0 — cycle-counting frequency tier. Optional (null = unclassified).
    abcClass: new FormControl<AbcClass | null>(null),
    // Optional. Manual override is one of two ways the server-side
    // hasCost gate is satisfied (the other is a saved cost calc). If
    // the user has neither, the express Save call gets a 409 from the
    // promote step with a "missing cost" message — friendlier than
    // blocking the form on a field the user may not be ready to fill.
    manualCostOverride: new FormControl<number | null>(null, [Validators.min(0)]),
  });

  protected readonly traceabilityOptions: SelectOption[] = [
    { value: 'None', label: this.translate.instant('parts.workflow.basics.traceabilityNone') },
    { value: 'Lot', label: this.translate.instant('parts.workflow.basics.traceabilityLot') },
    { value: 'Serial', label: this.translate.instant('parts.workflow.basics.traceabilitySerial') },
  ];

  protected readonly abcClassOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('parts.workflow.basics.abcClassUnclassified') },
    { value: 'A', label: this.translate.instant('parts.workflow.basics.abcClassA') },
    { value: 'B', label: this.translate.instant('parts.workflow.basics.abcClassB') },
    { value: 'C', label: this.translate.instant('parts.workflow.basics.abcClassC') },
  ];

  private readonly violationLabels = {
    name: this.translate.instant('parts.workflow.basics.nameLabel'),
    description: this.translate.instant('parts.workflow.basics.descriptionLabel'),
    traceabilityType: this.translate.instant('parts.workflow.quality.traceabilityLabel'),
    abcClass: this.translate.instant('parts.workflow.quality.abcClassLabel'),
    manualCostOverride: this.translate.instant('parts.workflow.costing.manualOverrideLabel'),
  };
  protected readonly violations = FormValidationService.getViolations(this.form, this.violationLabels);
  protected readonly violationItems = FormValidationService.getViolationItems(this.form, this.violationLabels);

  /** Form host element — used to scope click-to-jump field lookups. */
  private readonly formEl = viewChild<ElementRef<HTMLFormElement>>('formEl');

  /**
   * Validation popover click-to-jump handler. Resolves the offending
   * field by data-testid (express-{controlName}) — every wrapper
   * component already stamps a testid we can target — then scrolls
   * it into view and focuses the inner control.
   */
  protected jumpToField(controlName: string): void {
    const root = this.formEl()?.nativeElement;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-testid="express-${this.testidFor(controlName)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = target.querySelector<HTMLElement>('input, textarea, select, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
  }

  private testidFor(controlName: string): string {
    // Map FormControl name → the data-testid suffix used in the template.
    // Most match 1:1; cost is the one renamed legacy.
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      traceabilityType: 'traceability',
      abcClass: 'abc-class',
      manualCostOverride: 'manual-override',
    };
    return map[controlName] ?? controlName;
  }

  constructor() {
    // Re-hydrate from the bound entity when the workflow page resolves it
    // (e.g. resuming an in-flight run). No autosave: express mode is the
    // "one form, one click" path — every save creates / promotes a part,
    // so we only fire on the user's explicit Save click.
    effect(() => {
      const part = this.part();
      if (!part) return;
      this.form.patchValue({
        name: part.name ?? '',
        description: part.description ?? '',
        traceabilityType: part.traceabilityType ?? 'None',
        abcClass: part.abcClass ?? null,
        manualCostOverride: part.manualCostOverride ?? null,
      }, { emitEvent: false });
    });
  }

  /**
   * Manual Save — express mode is one-form-one-click, so this submits AND
   * promotes. Patches the workflow step (which materializes the entity if
   * it doesn't exist yet, then applies fields), then completes the run
   * (Draft → Active), then navigates to the parts list.
   */
  protected save(): void {
    if (this.form.invalid) return;
    const runId = this.runId();
    if (runId == null) return;
    const fields = this.fieldsFromForm();
    this.saving.set(true);
    this.workflowService.patchStep(runId, this.stepId(), fields).subscribe({
      next: (run) => {
        if (run.entityId == null) {
          this.saving.set(false);
          return;
        }
        this.workflowService.completeRun(runId).subscribe({
          next: (result) => {
            this.saving.set(false);
            if (result.success) {
              this.snackbar.success(this.translate.instant('parts.workflow.express.saveSuccess'));
              this.router.navigate(['/parts']);
            } else {
              // Use the missingMessageKey when available (it's the
              // human-readable "what specifically is needed" string per
              // gate); fall back to the gate name otherwise.
              const missingDescription = result.missing
                .map(m => this.translate.instant(m.missingMessageKey ?? m.displayNameKey))
                .join('; ');
              this.snackbar.error(this.translate.instant('parts.workflow.page.missingValidators', {
                missing: missingDescription,
              }));
            }
          },
          error: () => {
            this.saving.set(false);
            this.snackbar.error(this.translate.instant('parts.workflow.express.saveFailed'));
          },
        });
      },
      error: () => {
        this.saving.set(false);
        this.snackbar.error(this.translate.instant('parts.workflow.express.saveFailed'));
      },
    });
  }

  private fieldsFromForm(): Record<string, unknown> {
    const v = this.form.getRawValue();
    return {
      name: v.name ?? undefined,
      description: v.description ?? '',
      // Tier 0 — traceability + ABC class. (OEM identity captured per-vendor
      // in the new Vendor Parts cluster step, not here.)
      traceabilityType: v.traceabilityType ?? 'None',
      abcClass: v.abcClass ?? null,
      // PartWorkflowAdapter.ApplyAsync interprets null as "clear" via
      // TryReadDecimal — different contract than PartsService.updatePart
      // which uses a -1 sentinel. Pass null explicitly here.
      manualCostOverride: v.manualCostOverride ?? null,
    };
  }
}

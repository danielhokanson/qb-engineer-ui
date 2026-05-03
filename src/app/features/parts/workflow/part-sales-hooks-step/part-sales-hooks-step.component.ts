import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Pillar 6 follow-up — Sales Hooks step. Used by Buy + FinishedGood (B4)
 * to surface the sales-side bits the workflow shouldn't ignore on a
 * resold finished good. Sales UoM persists; the "Default Sales Price"
 * input is gone — pricing now flows through IPartPricingResolver and
 * we show the inferred effective price + its source as a read-only
 * preview row.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-sales-hooks-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    CurrencyDisplayComponent,
    SelectComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-sales-hooks-step.component.html',
  styleUrl: './part-sales-hooks-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartSalesHooksStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stepId = input<string>('salesHooks');
  readonly componentName = input<string>('PartSalesHooksStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly salesUomOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('parts.workflow.salesHooks.salesUomNone') },
    { value: 'ea', label: 'each (ea)' },
    { value: 'kg', label: 'kg' },
    { value: 'lb', label: 'lb' },
    { value: 'm', label: 'm' },
    { value: 'L', label: 'L' },
    { value: 'box', label: 'box' },
    { value: 'case', label: 'case' },
  ];

  protected readonly form = new FormGroup({
    salesUomCode: new FormControl<string | null>(null),
  });

  /** Resolver-supplied effective price (server-computed, read-only here). */
  protected readonly effectivePrice = computed(() => {
    const part = this.entity() as PartDetail | null;
    return part?.effectivePrice ?? 0;
  });

  protected readonly effectivePriceCurrency = computed(() => {
    const part = this.entity() as PartDetail | null;
    return part?.effectivePriceCurrency ?? 'USD';
  });

  protected readonly effectivePriceSourceLabelKey = computed(() => {
    const part = this.entity() as PartDetail | null;
    const source = part?.effectivePriceSource ?? 'Default';
    switch (source) {
      case 'PriceListEntry': return 'parts.workflow.salesHooks.inferredPriceSourcePriceListEntry';
      case 'PartPrice':      return 'parts.workflow.salesHooks.inferredPriceSourcePartPrice';
      case 'VendorPartTier': return 'parts.workflow.salesHooks.inferredPriceSourceVendorPartTier';
      default:               return 'parts.workflow.salesHooks.inferredPriceSourceDefault';
    }
  });

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        salesUomCode: part.salesUomCode ?? null,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        salesUomCode: this.translate.instant('parts.workflow.salesHooks.salesUomLabel'),
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
      salesUomCode: value.salesUomCode ?? null,
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
          this.snackbar.error(this.translate.instant('parts.workflow.salesHooks.saveFailed'));
        },
      }),
    );
  }
}

import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { CurrencyInputComponent } from '../../../../shared/components/currency-input/currency-input.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartLandedCostComponent } from './part-landed-cost.component';

/**
 * Pillar 4 — Cost cluster.
 *
 * Renders the part's manual cost override and a read-only badge for the
 * current cost-calculation snapshot id and the (Pillar 2) valuation class
 * label. Hidden by the layout resolver for Phantom combos (P1, P3) which
 * derive cost from their exploded children.
 */
@Component({
  selector: 'app-part-cost-cluster',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    CurrencyInputComponent, ValidationButtonComponent,
    PartLandedCostComponent,
  ],
  templateUrl: './part-cost-cluster.component.html',
  styleUrl: './part-clusters.shared.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartCostClusterComponent {
  readonly part = input.required<PartDetail>();
  readonly editing = input(false);
  readonly saving = input(false);

  readonly save = output<Partial<PartDetail>>();
  readonly cancelled = output<void>();

  protected readonly form = new FormGroup({
    manualCostOverride: new FormControl<number | null>(null),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {});

  constructor() {
    effect(() => {
      const p = this.part();
      this.form.reset({
        manualCostOverride: p.manualCostOverride,
      });
      if (this.editing()) {
        this.form.enable();
      } else {
        this.form.disable();
      }
    });
  }

  protected onSave(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    this.save.emit({
      manualCostOverride: v.manualCostOverride ?? null,
    });
  }

  protected onCancel(): void {
    this.cancelled.emit();
  }
}

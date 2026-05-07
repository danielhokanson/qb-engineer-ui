import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { CheckTierVarianceResult } from '../../models/tier-variance-check.model';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';

/**
 * Bought-parts effort PR4 — Off-tier price prompt at PO save time.
 *
 * Fires once per PO when one or more lines are flagged off-tier by the
 * server's `check-tier-variance` endpoint. Listed lines show the part,
 * the current tier price (or "no tier" when none exists), the entered
 * price, and the variance pct. Per row, the buyer chooses:
 *
 *   - Default: record the line at the entered price as a one-off
 *     exception. Doesn't touch master pricing.
 *   - Update tier: insert a new VendorPartPriceTier with the entered
 *     price + line qty (effective today). Subsequent POs see the new
 *     baseline.
 *
 * Footer buttons: Cancel (returns to the PO dialog) / Continue (commits
 * the chosen action per row, then proceeds with PO submission).
 *
 * Per-row choice keeps the prompt explicit — defaulting to "exception"
 * means the buyer has to opt-in to tier changes, which avoids accidental
 * master-pricing pollution.
 */
@Component({
  selector: 'app-off-tier-prompt-dialog',
  standalone: true,
  imports: [
    DecimalPipe, TranslatePipe,
    DialogComponent, CurrencyDisplayComponent,
  ],
  templateUrl: './off-tier-prompt-dialog.component.html',
  styleUrl: './off-tier-prompt-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffTierPromptDialogComponent {
  readonly lines = input.required<CheckTierVarianceResult[]>();
  readonly thresholdPct = input.required<number>();
  /** Map of partNumber + description for display (key: partId). */
  readonly partLookup = input<Map<number, { partNumber: string; description: string }>>(new Map());

  /** User clicked Cancel — returns to the PO dialog without submitting. */
  readonly cancelled = output<void>();
  /** User clicked Continue — emits the per-row "update tier" choice set. */
  readonly confirmed = output<OffTierPromptResult>();

  /** Per-row "update tier" choice. Default false (one-off exception). */
  protected readonly updateTierByPart = signal<Record<number, boolean>>({});

  protected readonly tierUpdateCount = computed(() =>
    Object.values(this.updateTierByPart()).filter(Boolean).length);

  protected toggleUpdateTier(partId: number): void {
    this.updateTierByPart.update(current => ({
      ...current,
      [partId]: !current[partId],
    }));
  }

  protected partInfo(partId: number): { partNumber: string; description: string } {
    return this.partLookup().get(partId) ?? { partNumber: `#${partId}`, description: '' };
  }

  protected onCancel(): void {
    this.cancelled.emit();
  }

  protected onConfirm(): void {
    const map = this.updateTierByPart();
    const updateTierLines = this.lines().filter(l => map[l.partId]);
    this.confirmed.emit({ updateTierLines });
  }
}

/** Emitted by Continue. Lines whose tier should be updated server-side. */
export interface OffTierPromptResult {
  updateTierLines: CheckTierVarianceResult[];
}

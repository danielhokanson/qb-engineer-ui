import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { PartsService } from '../../services/parts.service';
import { PartLandedCost } from '../../models/part-landed-cost.model';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { EntityLinkComponent } from '../../../../shared/components/entity-link/entity-link.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';

/**
 * Bought-parts effort PR3 — Part Cost tab landed-cost surface.
 *
 * Renders the "door to door" averaged unit cost over the most recent N
 * receipts (default 3), an itemized component breakdown (base / freight
 * / duty / FX), the contributing receipts as a sparse table, and a
 * vendor comparison so the buyer can spot a cheaper source. When no
 * receipt has captured freight yet, shows an empty state instead.
 *
 * Rendered as a child of `<app-part-cost-cluster>` rather than inlined
 * because the data fetch needs an injected service — keeps the parent
 * cluster a pure dumb component.
 */
@Component({
  selector: 'app-part-landed-cost',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, TranslatePipe,
    CurrencyDisplayComponent, EntityLinkComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-landed-cost.component.html',
  styleUrl: './part-landed-cost.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartLandedCostComponent {
  private readonly partsService = inject(PartsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly partId = input.required<number>();

  protected readonly loading = signal(true);
  protected readonly data = signal<PartLandedCost | null>(null);

  constructor() {
    effect(() => {
      const id = this.partId();
      if (!id) return;
      this.loading.set(true);
      this.partsService.getLandedCost(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (result) => {
          this.data.set(result);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    });
  }
}

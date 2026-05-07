import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import { LotService } from '../../services/lot.service';
import { LotTrace } from '../../models/lot-trace.model';
import { EntityActivitySectionComponent } from '../../../../shared/components/entity-activity-section/entity-activity-section.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';

@Component({
  selector: 'app-lot-detail-panel',
  standalone: true,
  imports: [DatePipe, DecimalPipe, MatTooltipModule, TranslatePipe, EntityActivitySectionComponent, LoadingBlockDirective],
  templateUrl: './lot-detail-panel.component.html',
  styleUrl: './lot-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LotDetailPanelComponent {
  private readonly service = inject(LotService);
  private readonly destroyRef = inject(DestroyRef);

  readonly lotId = input.required<number>();
  readonly lotNumber = input.required<string>();
  readonly closed = output<void>();

  protected readonly trace = signal<LotTrace | null>(null);
  protected readonly loading = signal(true);

  constructor() {
    effect(() => {
      const num = this.lotNumber();
      if (!num) return;
      this.loading.set(true);
      this.service.trace(num).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (t) => { this.trace.set(t); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    });
  }

  protected getTraceEventIcon(type: string): string {
    const map: Record<string, string> = {
      Job: 'work',
      ProductionRun: 'precision_manufacturing',
      PurchaseOrder: 'description',
      BinLocation: 'inventory_2',
      QcInspection: 'fact_check',
    };
    return map[type] ?? 'circle';
  }
}

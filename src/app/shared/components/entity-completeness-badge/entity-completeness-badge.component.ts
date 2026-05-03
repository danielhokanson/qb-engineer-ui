import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';

import { EntityCompletenessService } from '../../services/entity-completeness.service';
import { EntityCompleteness } from '../../models/entity-completeness.model';

/**
 * Inline mini-version of the completeness chip — a small amber dot with
 * an optional count, intended to sit next to entity names in list cells
 * (and other dense surfaces) so the incomplete signal is always visible
 * without claiming column real estate. Renders nothing when the entity
 * is fully ready (the chip column / detail header still surfaces "Ready"
 * explicitly when meaningful, but inline rows shouldn't be cluttered
 * with green dots on every row).
 *
 * Hover tooltip shows "Incomplete for N capabilities" with the
 * capability names. Click is a no-op — power users opening the column
 * via table settings get the full chip with click-to-popover. The
 * badge is signal-only.
 *
 * Shares cache with `<app-entity-completeness-chip>` via
 * `EntityCompletenessService` so same-row chip+badge fires one network
 * call.
 */
@Component({
  selector: 'app-entity-completeness-badge',
  standalone: true,
  imports: [MatTooltipModule],
  templateUrl: './entity-completeness-badge.component.html',
  styleUrl: './entity-completeness-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityCompletenessBadgeComponent {
  private readonly service = inject(EntityCompletenessService);
  private readonly translate = inject(TranslateService);

  readonly entityType = input.required<string>();
  readonly entityId = input.required<number>();

  protected readonly state = signal<EntityCompleteness | null>(null);

  protected readonly failingCount = computed(() =>
    this.state()?.capabilities.filter(c => !c.ok).length ?? 0,
  );

  protected readonly tooltipText = computed(() => {
    const caps = this.state()?.capabilities.filter(c => !c.ok) ?? [];
    if (caps.length === 0) return '';
    const names = caps.map(c => c.capabilityName).join(', ');
    return this.translate.instant('entityCompleteness.badgeTooltip', {
      count: caps.length,
      names,
    });
  });

  constructor() {
    effect(() => {
      const t = this.entityType();
      const id = this.entityId();
      if (!t || id == null) return;
      this.service.getCompleteness(t, id).subscribe({
        next: (s) => this.state.set(s),
        error: () => this.state.set(null),
      });
    });
  }
}

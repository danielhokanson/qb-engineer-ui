import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { EntityCompletenessService } from '../../services/entity-completeness.service';
import { EntityCompleteness } from '../../models/entity-completeness.model';

/**
 * Per-entity capability completeness summary, intended for detail-page
 * headers and (when enabled in column settings) data-table cells.
 *
 *   • Green dot + "Ready" — every currently-enabled capability with
 *     declared requirements passes against this entity.
 *   • Amber chip + "Incomplete for N" — at least one capability fails.
 *     Click opens a CDK overlay popover with the per-capability
 *     missing-fields breakdown (capability name → list of "Tax ID",
 *     "Payment Terms", etc., each with a fuller explanation tooltip).
 *
 * Companion to `<app-entity-completeness-badge>` which is the inline
 * mini-version surfaced next to entity names. Both consume the same
 * `EntityCompletenessService` cache so a list page rendering both for
 * one row only fires one network call.
 *
 * Empty case: when the install has no requirements declared (PR #3
 * ships an empty catalog — Dan authors rules later) the chip renders
 * "Ready" with no popover. Same when all requirements pass.
 */
@Component({
  selector: 'app-entity-completeness-chip',
  standalone: true,
  imports: [OverlayModule, MatTooltipModule, TranslatePipe],
  templateUrl: './entity-completeness-chip.component.html',
  styleUrl: './entity-completeness-chip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityCompletenessChipComponent {
  private readonly service = inject(EntityCompletenessService);
  private readonly translate = inject(TranslateService);

  readonly entityType = input.required<string>();
  readonly entityId = input.required<number>();

  protected readonly state = signal<EntityCompleteness | null>(null);
  protected readonly loading = signal(false);
  protected readonly popoverOpen = signal(false);
  // No `viewChild('trigger')` here — the template's `#trigger` reference
  // shadowed a same-named signal in the binding context (causing
  // `trigger()` in `[cdkConnectedOverlayOrigin]` to evaluate as a call on
  // the HTMLButtonElement). The CDK overlay accepts the template ref
  // directly, so we just bind to `trigger` without parens.

  protected readonly failingCapabilities = computed(() =>
    this.state()?.capabilities.filter(c => !c.ok) ?? [],
  );

  protected readonly ready = computed(() =>
    this.state() !== null && this.failingCapabilities().length === 0,
  );

  protected readonly failingCount = computed(() => this.failingCapabilities().length);

  constructor() {
    effect(() => {
      const t = this.entityType();
      const id = this.entityId();
      if (!t || id == null) return;
      this.loading.set(true);
      this.service.getCompleteness(t, id).subscribe({
        next: (s) => {
          this.state.set(s);
          this.loading.set(false);
        },
        error: () => {
          // Service errors leave state null — chip renders nothing rather
          // than a misleading "Ready". Caller tooltip will say "Status
          // unavailable" via the loading-state branch.
          this.state.set(null);
          this.loading.set(false);
        },
      });
    });
  }

  protected readonly tooltipText = computed(() => {
    if (this.loading()) return this.translate.instant('entityCompleteness.loading');
    if (this.ready()) return this.translate.instant('entityCompleteness.ready');
    return this.translate.instant('entityCompleteness.incompleteFor', {
      count: this.failingCount(),
    });
  });

  protected togglePopover(): void {
    if (this.failingCount() === 0) return;
    this.popoverOpen.update(v => !v);
  }

  protected closePopover(): void {
    this.popoverOpen.set(false);
  }
}

import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Shared "what does this enable" collapsible pane for workflow step
 * components. Renders a small dismissible card explaining what filling
 * in this step unlocks downstream — particularly valuable in guided
 * mode where each step is a logical break point on a functional
 * dependency of later parts of the part lifecycle.
 *
 * Usage in a step template:
 *   <app-step-rationale i18nKey="parts.workflow.basics.rationale" />
 *
 * The i18nKey resolves to a multi-paragraph translation. Defaults to
 * collapsed; user expansion is local to the component (not persisted).
 * If we eventually store "remembered preferences" we'll pipe a service
 * in here, but for now per-mount default keeps it simple.
 */
@Component({
  selector: 'app-step-rationale',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './step-rationale.component.html',
  styleUrl: './step-rationale.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepRationaleComponent {
  /** i18n key for the body content. Resolves to the rationale text. */
  readonly i18nKey = input.required<string>();
  /** Whether to start expanded. Default false. */
  readonly initiallyExpanded = input<boolean>(false);

  protected readonly expanded = signal<boolean>(false);

  constructor() {
    // Apply initiallyExpanded once at construction; toggling later
    // doesn't re-flip user state.
    queueMicrotask(() => {
      if (this.initiallyExpanded()) this.expanded.set(true);
    });
  }

  protected toggle(): void {
    this.expanded.update(v => !v);
  }
}

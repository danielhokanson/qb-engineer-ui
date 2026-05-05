import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Reusable transient slide-out panel that anchors absolutely to its
 * parent container. Slides in from any of the four edges; the parent
 * MUST have `position: relative` (or any non-static positioning) so the
 * slideout's absolute positioning resolves to the intended surface.
 *
 * Designed for help panels, filter drawers, info sidecars, and similar
 * progressive-disclosure surfaces that overlay one specific region of
 * the page rather than the whole viewport. For viewport-fixed drawers
 * (mobile nav, app shell), use a dialog or a future viewport-fixed
 * variant — this component intentionally stays scoped to a parent.
 *
 * Defaults are conservative: no backdrop, no outside-click close. The
 * close button in the header is always present so users always have an
 * obvious dismiss affordance regardless of the open/close trigger.
 */
@Component({
  selector: 'app-slideout',
  standalone: true,
  imports: [MatTooltipModule, TranslatePipe],
  templateUrl: './slideout.component.html',
  styleUrl: './slideout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlideoutComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly open = input.required<boolean>();
  readonly position = input<'left' | 'right' | 'top' | 'bottom'>('right');
  /** CSS size — width for left/right, height for top/bottom. */
  readonly size = input<string>('320px');
  readonly title = input<string>('');
  /** Optional Material icon name shown to the left of the title. */
  readonly icon = input<string>('');
  /** When true, render a tinted backdrop covering the parent. */
  readonly backdrop = input<boolean>(false);
  /** When true, clicks outside the panel emit `closed`. */
  readonly closeOnOutsideClick = input<boolean>(false);

  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.closed.emit();
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.open() || !this.closeOnOutsideClick()) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (!this.host.nativeElement.contains(target)) {
      this.closed.emit();
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onBackdropClick(): void {
    this.closed.emit();
  }
}

import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  EventEmitter,
  inject,
  input,
  Output,
  Signal,
  signal,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ViolationItem } from '../../services/form-validation.service';

const OUTSIDE_CLICK_DEBOUNCE_MS = 150;
const AUTO_CLOSE_AFTER_CLEAR_MS = 1200;

@Component({
  selector: 'app-validation-button',
  standalone: true,
  imports: [OverlayModule, MatTooltipModule],
  templateUrl: './validation-button.component.html',
  styleUrl: './validation-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValidationButtonComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly violations = input.required<Signal<string[]>>();
  /**
   * Optional richer signal carrying ViolationItem entries (controlName +
   * message). When supplied, the popover renders each violation as a
   * clickable button that emits (violationClicked) with the controlName
   * — consumers wire that to focus / scroll to the offending field.
   * Falls back to read-only string list when not supplied so the 50+
   * existing consumers keep working unchanged.
   */
  readonly violationItems = input<Signal<ViolationItem[]> | null>(null);
  readonly loading = input<boolean, unknown>(false, { transform: (v: unknown) => !!v });

  /** Emitted when the user clicks a violation entry in the popover. */
  @Output() readonly violationClicked = new EventEmitter<string>();

  protected readonly open = signal(false);

  /**
   * The displayed list. Prefer the richer items signal when supplied;
   * otherwise wrap each plain message in a synthetic ViolationItem so
   * the template renders the same shape (controlName empty for the
   * legacy path, which simply means click-to-jump is a no-op).
   */
  protected readonly violationList = computed<ViolationItem[]>(() => {
    const items = this.violationItems();
    if (items) return items();
    return this.violations()().map(message => ({ controlName: '', message }));
  });
  protected readonly count = computed(() => this.violationList().length);
  protected readonly showTrigger = computed(() => this.count() > 0 && !this.loading());

  protected onViolationClick(item: ViolationItem): void {
    if (!item.controlName) return; // legacy plain-string path — no-op
    this.violationClicked.emit(item.controlName);
    this.close();
  }

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start',  originY: 'center', overlayX: 'end',    overlayY: 'center', offsetX: -8 },
    { originX: 'end',    originY: 'center', overlayX: 'start',  overlayY: 'center', offsetX: 8 },
    { originX: 'end',    originY: 'bottom', overlayX: 'end',    overlayY: 'top', offsetY: 8 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
    { originX: 'start',  originY: 'bottom', overlayX: 'start',  overlayY: 'top', offsetY: 8 },
    { originX: 'end',    originY: 'top', overlayX: 'end',    overlayY: 'bottom', offsetY: -8 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    { originX: 'start',  originY: 'top', overlayX: 'start',  overlayY: 'bottom', offsetY: -8 },
  ];

  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Auto-close after violations clear, so the user sees the "all-clear" for a moment.
    effect(() => {
      const count = this.count();
      if (!this.open()) return;
      if (count === 0) {
        this.scheduleClose(AUTO_CLOSE_AFTER_CLEAR_MS);
      } else {
        this.cancelScheduledClose();
      }
    });

    this.destroyRef.onDestroy(() => this.cancelScheduledClose());
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
    } else if (this.count() > 0) {
      this.open.set(true);
    }
  }

  protected close(): void {
    this.cancelScheduledClose();
    this.open.set(false);
  }

  protected onOutsideClick(): void {
    this.scheduleClose(OUTSIDE_CLICK_DEBOUNCE_MS);
  }

  private scheduleClose(delayMs: number): void {
    this.cancelScheduledClose();
    this.closeTimer = setTimeout(() => {
      this.open.set(false);
      this.closeTimer = null;
    }, delayMs);
  }

  private cancelScheduledClose(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }
}

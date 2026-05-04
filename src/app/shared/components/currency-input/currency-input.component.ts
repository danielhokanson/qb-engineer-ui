import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

/**
 * Shared currency input wrapper.
 *
 * Built specifically to fix the recurring `<mat-icon matPrefix>$` overlap with
 * Material's floating outline label (the bug that produced `$lanual cost
 * override` and `$ew Price` in screenshots — see
 * `phase-4-output/ux-research/parts-system-ux-analysis.md` §3.D and the
 * upstream Angular components issues #15027 / #26558).
 *
 * Visual approach: use Material's `matTextPrefix` slot. Unlike `matPrefix`
 * (which positions an icon inside the label-collision zone), `matTextPrefix`
 * is laid out before the input text in the same baseline as the value, so
 * the floating label slides up cleanly above it without overlap. No absolute
 * positioning, no manual offsets — Material handles it.
 *
 * `ControlValueAccessor` so it drops in as `formControlName="..."` like
 * `<app-input>`. Internally the input is `type="number"` with
 * `inputmode="decimal"` so mobile keyboards offer a numeric keypad.
 */
@Component({
  selector: 'app-currency-input',
  standalone: true,
  imports: [MatFormFieldModule, MatInputModule],
  templateUrl: './currency-input.component.html',
  styleUrl: './currency-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyInputComponent),
      multi: true,
    },
  ],
})
export class CurrencyInputComponent implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly placeholder = input<string>('0.00');
  readonly currencySymbol = input<string>('$');
  readonly min = input<number | string | null>(0);
  readonly max = input<number | string | null>(null);
  readonly step = input<number | string>('0.01');
  readonly required = input<boolean>(false);
  /** Read-only mode — see styles.scss .app-readonly-field treatment. */
  readonly isReadonly = input<boolean>(false);

  protected readonly value = signal<number | string>('');
  protected readonly disabled = signal(false);

  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: number | string | null): void {
    if (value === null || value === undefined || value === '') {
      this.value.set('');
      return;
    }
    const num = typeof value === 'number' ? value : Number(value);
    this.value.set(Number.isFinite(num) ? num : '');
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const raw = el.value;
    if (raw === '') {
      this.value.set('');
      this.onChange(null);
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      this.onChange(null);
      return;
    }
    this.value.set(num);
    this.onChange(num);
  }

  protected markTouched(): void {
    this.onTouched();
  }
}

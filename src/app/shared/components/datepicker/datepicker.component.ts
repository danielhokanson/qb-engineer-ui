import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  forwardRef,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DATE_FORMATS, provideNativeDateAdapter } from '@angular/material/core';

/** Custom date formats enforcing MM/dd/yyyy display (project standard) */
const QBE_DATE_FORMATS = {
  parse: { dateInput: 'MM/dd/yyyy' },
  display: {
    dateInput: { year: 'numeric', month: '2-digit', day: '2-digit' } as Intl.DateTimeFormatOptions,
    monthYearLabel: { year: 'numeric', month: 'short' } as Intl.DateTimeFormatOptions,
    dateA11yLabel: { year: 'numeric', month: 'long', day: 'numeric' } as Intl.DateTimeFormatOptions,
    monthYearA11yLabel: { year: 'numeric', month: 'long' } as Intl.DateTimeFormatOptions,
  },
};

@Component({
  selector: 'app-datepicker',
  standalone: true,
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule],
  templateUrl: './datepicker.component.html',
  styleUrl: './datepicker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatepickerComponent),
      multi: true,
    },
    { provide: MAT_DATE_FORMATS, useValue: QBE_DATE_FORMATS },
    // Standalone components don't inherit NgModule providers, so
    // MatNativeDateModule's DateAdapter binding never reached
    // matDatepicker — clicks threw NG0201 NullInjectorError. The
    // `provideNativeDateAdapter()` helper is the standalone-friendly
    // form and registers DateAdapter + MAT_DATE_LOCALE locally.
    provideNativeDateAdapter(),
  ],
})
export class DatepickerComponent implements ControlValueAccessor {
  private readonly destroyRef = inject(DestroyRef);

  readonly label = input.required<string>();
  readonly min = input<Date | null>(null);
  readonly max = input<Date | null>(null);
  /** Read-only mode — see styles.scss .app-readonly-field treatment.
   *  The calendar toggle button is hidden via the global rule. */
  readonly isReadonly = input<boolean>(false);

  /**
   * Internal FormControl that the matInput binds to via [formControl].
   * Material's matDatepicker requires Angular Forms integration on the
   * input it's attached to — a plain [value] binding is NOT sufficient
   * (the picker's overlay opens but mat-calendar can't bind to a value
   * source, so it never renders). The CVA hooks below sync this
   * internal control with whatever the parent's FormControl/NgModel is
   * driving.
   */
  protected readonly internalControl = new FormControl<Date | null>(null);

  private onChange: (value: Date | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    // Forward internal-control changes out to the parent CVA. Skipping
    // emitEvent in writeValue prevents a feedback loop.
    this.internalControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.onChange(value));
  }

  writeValue(value: Date | string | null): void {
    this.internalControl.setValue(value ? new Date(value) : null, { emitEvent: false });
  }

  registerOnChange(fn: (value: Date | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    if (disabled) this.internalControl.disable({ emitEvent: false });
    else this.internalControl.enable({ emitEvent: false });
  }

  protected markTouched(): void {
    this.onTouched();
  }
}

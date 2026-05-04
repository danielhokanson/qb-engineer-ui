import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  forwardRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, ReactiveFormsModule, FormControl } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpParams } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { TranslatePipe } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, filter, switchMap, catchError, of } from 'rxjs';

@Component({
  selector: 'app-entity-picker',
  standalone: true,
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule, TranslatePipe],
  templateUrl: './entity-picker.component.html',
  styleUrl: './entity-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => EntityPickerComponent),
      multi: true,
    },
  ],
})
export class EntityPickerComponent implements ControlValueAccessor, OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly label = input.required<string>();
  readonly entityType = input.required<string>();
  readonly displayField = input<string>('name');
  readonly filters = input<Record<string, string>>({});
  readonly placeholder = input<string>('');
  readonly isReadonly = input<boolean>(false);
  /**
   * Singular noun for the inline-create affordance — when set, the dropdown
   * surfaces a "Create new {createNewLabel} '{typed query}'" option below
   * the search results, prefixed by an `add` icon (the icon supplies the
   * visual `+`; the label text does not repeat it). Click emits
   * {@link createNew} with the typed query so the consumer can pre-fill
   * the quick-create dialog. Omit to disable the affordance entirely.
   */
  readonly createNewLabel = input<string | null>(null);
  readonly createNew = output<string>();

  protected readonly searchControl = new FormControl('');
  protected readonly results = signal<Record<string, unknown>[]>([]);
  protected readonly disabled = signal(false);
  /** True when {@link createNewLabel} is set AND the user has typed >= 2 chars — controls the dropdown's "Create new" row visibility. */
  protected readonly canShowCreateNew = signal(false);
  private selectedValue: unknown = null;

  private onChange: (value: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.searchControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(term => {
      // Drives the "Create new" row visibility — needs to react before the
      // 300ms search debounce so the affordance appears as soon as the user
      // is past the 2-char threshold, not 300ms later.
      this.canShowCreateNew.set(
        !!this.createNewLabel() && typeof term === 'string' && term.length >= 2,
      );
    });

    this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(term => typeof term === 'string' && term.length >= 2),
      switchMap(term => this.search(term as string)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => this.results.set(results));
  }

  writeValue(value: unknown): void {
    this.selectedValue = value;
    // If we have a value, we'd need to resolve display text from the API
    // For now, clear the search when value is set programmatically to null
    if (value == null) {
      this.searchControl.setValue('', { emitEvent: false });
    }
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    if (disabled) {
      this.searchControl.disable({ emitEvent: false });
    } else {
      this.searchControl.enable({ emitEvent: false });
    }
  }

  /** Sentinel option value for the "Create new" row. Kept as a const so
   *  the template, displayFn, and option-selected handler all agree. */
  protected static readonly CREATE_NEW_SENTINEL = '__create_new__';
  /** Template-accessible alias of {@link CREATE_NEW_SENTINEL} (statics
   *  aren't reachable from Angular templates). */
  protected readonly CREATE_NEW_SENTINEL = EntityPickerComponent.CREATE_NEW_SENTINEL;

  /**
   * Captured at mousedown on the create-new option, BEFORE Material's
   * option-selection cycle runs displayFn and overwrites searchControl
   * with the option's value. Reading searchControl in onOptionSelected
   * is unsafe — Material may have already written the sentinel back.
   * The captured term is what we hand to the consumer's quick-create
   * dialog as the pre-fill value.
   */
  private capturedCreateNewTerm: string | null = null;

  protected captureCreateNewTerm(): void {
    this.capturedCreateNewTerm = (this.searchControl.value ?? '').toString().trim();
  }

  protected onOptionSelected(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value;
    if (value === EntityPickerComponent.CREATE_NEW_SENTINEL) {
      const term = this.capturedCreateNewTerm ?? '';
      this.capturedCreateNewTerm = null;
      // Defensive clear — even though displayFn returns '' for the sentinel,
      // some Material versions still call setValue via writeValue. Setting
      // explicitly here guarantees the user never sees __create_new__ in
      // the input, which previously leaked into the quick-create dialog
      // as the company name pre-fill (and ended up persisted in the DB).
      this.searchControl.setValue('', { emitEvent: false });
      this.createNew.emit(term);
      return;
    }
    const entity = value as Record<string, unknown>;
    this.selectedValue = entity['id'];
    this.searchControl.setValue(String(entity[this.displayField()] ?? ''), { emitEvent: false });
    this.onChange(this.selectedValue);
  }

  /**
   * Programmatic write of the selected value + display text. Used by
   * consumers after a successful inline-create — they call this with
   * the new entity so the picker shows the freshly-created row as
   * selected without a round-trip back through the search endpoint.
   */
  setSelected(id: number, displayText: string): void {
    this.selectedValue = id;
    this.searchControl.setValue(displayText, { emitEvent: false });
    this.onChange(id);
  }

  protected onInput(): void {
    if (this.selectedValue !== null) {
      this.selectedValue = null;
      this.onChange(null);
    }
  }

  protected markTouched(): void {
    this.onTouched();
  }

  /**
   * Material Autocomplete calls displayFn(option.value) to compute what
   * to show in the input after a selection. For the create-new sentinel,
   * return empty string explicitly so the literal `__create_new__` never
   * leaks into the input (and by extension into any consumer dialog
   * pre-fill or downstream save). For real entity selections, fall back
   * to whatever the user typed (we set the proper display in
   * onOptionSelected after this).
   */
  protected displayFn = (val?: unknown): string => {
    if (val === EntityPickerComponent.CREATE_NEW_SENTINEL) return '';
    return this.searchControl.value ?? '';
  };

  protected getDisplayText(entity: Record<string, unknown>): string {
    return String(entity[this.displayField()] ?? '');
  }

  private search(term: string) {
    // Phase 3 / WU-17 standardised paged-list endpoints on `?q=` + `{ items, totalCount, page, pageSize }`.
    // Older endpoints still accept `?search=` and either return a flat array or a `{ data: [] }` envelope.
    // Send both query params (server picks the one it knows) and accept all three response shapes
    // (flat array, { items }, { data }) so the picker works against every list endpoint we have.
    let params = new HttpParams()
      .set('q', term)
      .set('search', term)
      .set('pageSize', '10');
    const extraFilters = this.filters();
    for (const [key, val] of Object.entries(extraFilters)) {
      params = params.set(key, val);
    }

    type Envelope = { items?: Record<string, unknown>[]; data?: Record<string, unknown>[] };
    return this.http
      .get<Record<string, unknown>[] | Envelope>(`/api/v1/${this.entityType()}`, { params })
      .pipe(
        catchError(() => of([] as Record<string, unknown>[])),
        switchMap(res => {
          if (Array.isArray(res)) return of(res);
          const env = res as Envelope;
          return of(env.items ?? env.data ?? []);
        }),
      );
  }
}

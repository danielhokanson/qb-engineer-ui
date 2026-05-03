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
  /**
   * Singular noun for the inline-create affordance — when set, the dropdown
   * surfaces a "+ Create new {createNewLabel} '{typed query}'" option below
   * the search results. Click emits {@link createNew} with the typed query
   * so the consumer can pre-fill the quick-create dialog. Omit to disable
   * the affordance entirely (most pickers stay typeahead-only).
   */
  readonly createNewLabel = input<string | null>(null);
  readonly createNew = output<string>();

  protected readonly searchControl = new FormControl('');
  protected readonly results = signal<Record<string, unknown>[]>([]);
  protected readonly disabled = signal(false);
  /** True when {@link createNewLabel} is set AND the user has typed >= 2 chars — controls the dropdown's "+ Create new" row visibility. */
  protected readonly canShowCreateNew = signal(false);
  private selectedValue: unknown = null;

  private onChange: (value: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.searchControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(term => {
      // Drives the "+ Create new" row visibility — needs to react before the
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

  protected onOptionSelected(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value;
    // Sentinel value emitted by the "+ Create new" row — see template.
    // Distinguishes the create-new affordance from a real entity option
    // without overloading the entity shape with magic flags.
    if (value === '__create_new__') {
      const term = (this.searchControl.value ?? '').trim();
      this.createNew.emit(term);
      // Keep the typed term in the input — the consumer's quick-create
      // dialog will use it as the initial value, and on cancel/dismiss
      // the user shouldn't have to retype.
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

  protected displayFn = (): string => {
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

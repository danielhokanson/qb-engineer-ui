import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal, OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ColumnDef, TextFilterValue, TextMatchMode } from '../../../models/column-def.model';
import { InputComponent } from '../../input/input.component';
import { DatepickerComponent } from '../../datepicker/datepicker.component';
import { SelectComponent, SelectOption } from '../../select/select.component';

export interface ColumnFilterState {
  field: string;
  value: unknown;
}

@Component({
  selector: 'app-column-filter-popover',
  standalone: true,
  imports: [FormsModule, MatCheckboxModule, InputComponent, SelectComponent, DatepickerComponent, TranslatePipe],
  templateUrl: './column-filter-popover.component.html',
  styleUrl: './column-filter-popover.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnFilterPopoverComponent implements OnInit {
  private readonly translate = inject(TranslateService);

  readonly column = input.required<ColumnDef>();
  readonly currentValue = input<unknown>(null);

  readonly filterApplied = output<ColumnFilterState>();
  readonly filterCleared = output<string>();
  readonly closed = output<void>();

  protected readonly textValue = signal('');
  protected readonly textMode = signal<TextMatchMode>('contains');
  protected readonly numberMin = signal<number | null>(null);
  protected readonly numberMax = signal<number | null>(null);
  protected readonly dateFrom = signal<Date | null>(null);
  protected readonly dateTo = signal<Date | null>(null);
  protected readonly selectedEnums = signal<Set<unknown>>(new Set());

  protected readonly textModeOptions = computed<SelectOption[]>(() => [
    { value: 'contains', label: this.translate.instant('shared.matchMode.contains') },
    { value: 'equals', label: this.translate.instant('shared.matchMode.equals') },
    { value: 'startsWith', label: this.translate.instant('shared.matchMode.startsWith') },
    { value: 'endsWith', label: this.translate.instant('shared.matchMode.endsWith') },
    { value: 'notContains', label: this.translate.instant('shared.matchMode.notContains') },
    { value: 'notEquals', label: this.translate.instant('shared.matchMode.notEquals') },
  ]);

  protected readonly textInputLabelKey = computed(() => {
    switch (this.textMode()) {
      case 'equals': return 'shared.matchMode.equals';
      case 'startsWith': return 'shared.matchMode.startsWith';
      case 'endsWith': return 'shared.matchMode.endsWith';
      case 'notContains': return 'shared.matchMode.notContains';
      case 'notEquals': return 'shared.matchMode.notEquals';
      case 'contains':
      default: return 'shared.matchMode.contains';
    }
  });

  ngOnInit(): void {
    this.loadCurrentValue();
  }

  onApply(): void {
    const col = this.column();
    let value: unknown;

    switch (col.type ?? 'text') {
      case 'text': {
        const txt = this.textValue();
        value = txt ? { mode: this.textMode(), value: txt } satisfies TextFilterValue : null;
        break;
      }
      case 'number':
        value = (this.numberMin() != null || this.numberMax() != null)
          ? { min: this.numberMin(), max: this.numberMax() }
          : null;
        break;
      case 'date':
        value = (this.dateFrom() || this.dateTo())
          ? { from: this.dateFrom(), to: this.dateTo() }
          : null;
        break;
      case 'enum':
        value = this.selectedEnums().size > 0
          ? [...this.selectedEnums()]
          : null;
        break;
    }

    if (value != null) {
      this.filterApplied.emit({ field: col.field, value });
    } else {
      this.filterCleared.emit(col.field);
    }
    this.closed.emit();
  }

  onClear(): void {
    this.filterCleared.emit(this.column().field);
    this.closed.emit();
  }

  toggleEnum(val: unknown): void {
    const selected = new Set(this.selectedEnums());
    if (selected.has(val)) {
      selected.delete(val);
    } else {
      selected.add(val);
    }
    this.selectedEnums.set(selected);
  }

  isEnumSelected(val: unknown): boolean {
    return this.selectedEnums().has(val);
  }

  private loadCurrentValue(): void {
    const val = this.currentValue();
    if (val == null) return;

    switch (this.column().type ?? 'text') {
      case 'text': {
        // Back-compat: legacy filters were stored as a plain string (treated
        // as "contains"). New shape is { mode, value }.
        if (typeof val === 'string') {
          this.textValue.set(val);
          this.textMode.set('contains');
        } else {
          const tv = val as TextFilterValue;
          this.textValue.set(tv.value ?? '');
          this.textMode.set(tv.mode ?? 'contains');
        }
        break;
      }
      case 'number': {
        const range = val as { min?: number; max?: number };
        this.numberMin.set(range.min ?? null);
        this.numberMax.set(range.max ?? null);
        break;
      }
      case 'date': {
        const range = val as { from?: Date; to?: Date };
        this.dateFrom.set(range.from ?? null);
        this.dateTo.set(range.to ?? null);
        break;
      }
      case 'enum':
        this.selectedEnums.set(new Set(val as unknown[]));
        break;
    }
  }
}

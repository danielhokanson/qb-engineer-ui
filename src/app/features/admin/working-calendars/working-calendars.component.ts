import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import { PageLayoutComponent } from '../../../shared/components/page-layout/page-layout.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../shared/components/toggle/toggle.component';
import { DatepickerComponent } from '../../../shared/components/datepicker/datepicker.component';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { ValidationButtonComponent } from '../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../shared/services/form-validation.service';
import { toDateOnly } from '../../../shared/utils/date.utils';

import { WorkingCalendarsService } from '../services/working-calendars.service';
import {
  DAY_NAMES,
  Holiday,
  WORKING_DAYS_MASK_DEFAULT,
  WorkingCalendar,
} from '../models/working-calendar.model';

/**
 * Admin screen for working calendars + holidays. Master-detail layout:
 * calendar list on the left, selected calendar's details + holidays on
 * the right. Bought-parts effort PR1 — the foundation that every other
 * business-day calculation in the system reads from.
 */
@Component({
  selector: 'app-working-calendars',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe, MatTooltipModule,
    PageLayoutComponent, InputComponent, SelectComponent, ToggleComponent,
    DatepickerComponent, LoadingBlockDirective, EmptyStateComponent,
    ValidationButtonComponent,
  ],
  templateUrl: './working-calendars.component.html',
  styleUrl: './working-calendars.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkingCalendarsComponent {
  private readonly service = inject(WorkingCalendarsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly router = inject(Router);

  protected readonly calendars = signal<WorkingCalendar[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly selectedId = signal<number | null>(null);

  protected readonly selected = computed(() =>
    this.calendars().find(c => c.id === this.selectedId()) ?? null);

  // Calendar form (used for both create and edit; mode driven by selectedId).
  protected readonly calendarForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    timeZone: new FormControl('UTC', { nonNullable: true, validators: [Validators.required, Validators.maxLength(64)] }),
    workingDaysMask: new FormControl(WORKING_DAYS_MASK_DEFAULT, { nonNullable: true, validators: [Validators.min(1), Validators.max(127)] }),
    isActive: new FormControl(true, { nonNullable: true }),
  });

  protected readonly calendarViolations = FormValidationService.getViolations(this.calendarForm, {
    name: 'Name', timeZone: 'Time Zone', workingDaysMask: 'Working Days',
  });

  // Day-of-week toggles — stored as 7 bits, edited as 7 booleans.
  protected readonly dayBits = signal<boolean[]>([false, true, true, true, true, true, false]); // Mon-Fri

  protected readonly dayNames = DAY_NAMES;

  // Holiday form
  protected readonly holidayForm = new FormGroup({
    date: new FormControl<Date | null>(null, [Validators.required]),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    observedDate: new FormControl<Date | null>(null),
    isRecurring: new FormControl(false, { nonNullable: true }),
  });

  protected readonly holidayViolations = FormValidationService.getViolations(this.holidayForm, {
    date: 'Date', name: 'Name',
  });

  // Common timezones; admins typing a custom IANA tz are still accepted by
  // the server (free text). Just a UX shortcut.
  protected readonly timeZoneOptions: SelectOption[] = [
    { value: 'UTC', label: 'UTC' },
    { value: 'America/Denver', label: 'America/Denver (MT)' },
    { value: 'America/Chicago', label: 'America/Chicago (CT)' },
    { value: 'America/New_York', label: 'America/New_York (ET)' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
    { value: 'America/Phoenix', label: 'America/Phoenix (AZ no DST)' },
    { value: 'America/Mexico_City', label: 'America/Mexico_City' },
    { value: 'Europe/London', label: 'Europe/London' },
    { value: 'Europe/Berlin', label: 'Europe/Berlin' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  ];

  constructor() {
    this.load();
  }

  protected back(): void {
    this.router.navigate(['/admin/settings']);
  }

  private load(): void {
    this.loading.set(true);
    this.service.list().subscribe({
      next: (list) => {
        this.calendars.set(list);
        if (list.length > 0 && this.selectedId() == null) {
          // Default-select the default (or first) calendar so the right pane
          // isn't an awkward blank on landing.
          const defaultCal = list.find(c => c.isDefault) ?? list[0];
          this.select(defaultCal.id);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected select(id: number): void {
    this.selectedId.set(id);
    const cal = this.calendars().find(c => c.id === id);
    if (cal) this.seedFromCalendar(cal);
  }

  /** New-calendar mode — clears selection + resets form to defaults. */
  protected newCalendar(): void {
    this.selectedId.set(null);
    this.calendarForm.reset({
      name: '',
      timeZone: 'UTC',
      workingDaysMask: WORKING_DAYS_MASK_DEFAULT,
      isActive: true,
    });
    this.dayBits.set([false, true, true, true, true, true, false]);
  }

  private seedFromCalendar(cal: WorkingCalendar): void {
    this.calendarForm.reset({
      name: cal.name,
      timeZone: cal.timeZone,
      workingDaysMask: cal.workingDaysMask,
      isActive: cal.isActive,
    });
    const bits: boolean[] = [];
    for (let i = 0; i < 7; i++) bits.push((cal.workingDaysMask & (1 << i)) !== 0);
    this.dayBits.set(bits);
  }

  protected toggleDay(idx: number): void {
    const bits = [...this.dayBits()];
    bits[idx] = !bits[idx];
    this.dayBits.set(bits);
    let mask = 0;
    bits.forEach((on, i) => { if (on) mask |= (1 << i); });
    this.calendarForm.controls.workingDaysMask.setValue(mask);
    this.calendarForm.controls.workingDaysMask.markAsDirty();
  }

  protected save(): void {
    if (this.calendarForm.invalid || this.saving()) return;
    const v = this.calendarForm.getRawValue();
    const id = this.selectedId();
    this.saving.set(true);
    const op = id == null
      ? this.service.create(v)
      : this.service.update(id, v);
    op.subscribe({
      next: (saved) => {
        this.snackbar.success(id == null ? 'Calendar created' : 'Calendar saved');
        this.saving.set(false);
        this.load();
        this.selectedId.set(saved.id);
      },
      error: () => this.saving.set(false),
    });
  }

  protected setDefault(): void {
    const id = this.selectedId();
    if (id == null) return;
    this.service.setDefault(id).subscribe({
      next: () => {
        this.snackbar.success('Default calendar updated');
        this.load();
      },
    });
  }

  protected delete(): void {
    const sel = this.selected();
    if (!sel) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: 'Delete Calendar?',
        message: `Delete "${sel.name}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.service.delete(sel.id).subscribe({
        next: () => {
          this.snackbar.success('Calendar deleted');
          this.selectedId.set(null);
          this.load();
        },
      });
    });
  }

  protected addHoliday(): void {
    const sel = this.selected();
    if (!sel || this.holidayForm.invalid) return;
    const v = this.holidayForm.getRawValue();
    const dateStr = toDateOnly(v.date);
    if (!dateStr) return;
    this.service.addHoliday(sel.id, {
      date: dateStr,
      name: v.name,
      observedDate: toDateOnly(v.observedDate),
      isRecurring: v.isRecurring,
    }).subscribe({
      next: () => {
        this.snackbar.success('Holiday added');
        this.holidayForm.reset({ date: null, name: '', observedDate: null, isRecurring: false });
        this.load();
      },
    });
  }

  protected deleteHoliday(holiday: Holiday): void {
    const sel = this.selected();
    if (!sel) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Remove Holiday?',
        message: `Remove "${holiday.name}" (${holiday.date})?`,
        confirmLabel: 'Remove',
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.service.deleteHoliday(sel.id, holiday.id).subscribe({
        next: () => { this.snackbar.success('Holiday removed'); this.load(); },
      });
    });
  }
}

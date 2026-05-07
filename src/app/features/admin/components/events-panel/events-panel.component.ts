import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { EventsService } from '../../../events/services/events.service';
import { AppEvent, EventRequest } from '../../../events/models/event.model';
import { AdminService } from '../../services/admin.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';

@Component({
  selector: 'app-events-panel',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    DataTableComponent,
    ColumnCellDirective,
    InputComponent,
    SelectComponent,
    TextareaComponent,
    DatepickerComponent,
    ToggleComponent,
    DialogComponent,
    ValidationButtonComponent,
    LoadingBlockDirective,
    TranslatePipe,
  ],
  templateUrl: './events-panel.component.html',
  styleUrl: './events-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsPanelComponent implements OnInit {
  private readonly eventsService = inject(EventsService);
  private readonly adminService = inject(AdminService);
  private readonly snackbar = inject(SnackbarService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  protected readonly isLoading = signal(false);
  protected readonly saving = signal(false);
  protected readonly events = signal<AppEvent[]>([]);
  protected readonly showDialog = signal(false);
  protected readonly editingEvent = signal<AppEvent | null>(null);
  protected readonly userOptions = signal<SelectOption[]>([]);

  protected readonly typeFilterControl = new FormControl<string>('');

  protected readonly typeOptions: SelectOption[] = [
    { value: '', label: this.translate.instant('adminPanels.events.types.all') },
    { value: 'Meeting', label: this.translate.instant('adminPanels.events.types.meeting') },
    { value: 'Training', label: this.translate.instant('adminPanels.events.types.training') },
    { value: 'Safety', label: this.translate.instant('adminPanels.events.types.safety') },
    { value: 'Other', label: this.translate.instant('adminPanels.events.types.other') },
  ];

  protected readonly formTypeOptions: SelectOption[] = [
    { value: 'Meeting', label: this.translate.instant('adminPanels.events.types.meeting') },
    { value: 'Training', label: this.translate.instant('adminPanels.events.types.training') },
    { value: 'Safety', label: this.translate.instant('adminPanels.events.types.safety') },
    { value: 'Other', label: this.translate.instant('adminPanels.events.types.other') },
  ];

  protected readonly form = new FormGroup({
    title: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    description: new FormControl<string | null>(null),
    startDate: new FormControl<Date | null>(null, [Validators.required]),
    startTime: new FormControl('09:00', [Validators.required]),
    endDate: new FormControl<Date | null>(null, [Validators.required]),
    endTime: new FormControl('10:00', [Validators.required]),
    location: new FormControl<string | null>(null),
    eventType: new FormControl('Meeting', [Validators.required]),
    isRequired: new FormControl(false),
    attendeeUserIds: new FormControl<number[]>([], { nonNullable: true }),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    title: 'Title',
    startDate: 'Start Date',
    startTime: 'Start Time',
    endDate: 'End Date',
    endTime: 'End Time',
    eventType: 'Event Type',
  });

  protected readonly columns: ColumnDef[] = [
    { field: 'title', header: this.translate.instant('adminPanels.events.cols.title'), sortable: true },
    { field: 'eventType', header: this.translate.instant('adminPanels.events.cols.type'), sortable: true, filterable: true, type: 'enum', width: '100px',
      filterOptions: this.formTypeOptions },
    { field: 'startTime', header: this.translate.instant('adminPanels.events.cols.start'), sortable: true, type: 'date', width: '160px' },
    { field: 'endTime', header: this.translate.instant('adminPanels.events.cols.end'), sortable: true, type: 'date', width: '160px' },
    { field: 'location', header: this.translate.instant('adminPanels.events.cols.location'), sortable: true, width: '150px' },
    { field: 'attendeeCount', header: this.translate.instant('adminPanels.events.cols.attendees'), sortable: true, type: 'number', width: '100px' },
    { field: 'isRequired', header: this.translate.instant('adminPanels.events.cols.required'), sortable: true, width: '90px' },
    { field: 'actions', header: '', width: '80px' },
  ];

  ngOnInit(): void {
    this.loadEvents();
    this.loadUsers();
    this.typeFilterControl.valueChanges.subscribe(() => this.loadEvents());
  }

  protected loadEvents(): void {
    this.isLoading.set(true);
    const eventType = this.typeFilterControl.value || undefined;
    this.eventsService.getEvents(undefined, undefined, eventType).subscribe({
      next: (events) => {
        this.events.set(events.map(e => ({ ...e, attendeeCount: e.attendees.length } as AppEvent & { attendeeCount: number })));
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  private loadUsers(): void {
    this.adminService.getUsers().subscribe({
      next: (users) => {
        this.userOptions.set(
          users
            .filter(u => u.isActive)
            .map(u => ({ value: u.id, label: `${u.lastName}, ${u.firstName}` })),
        );
      },
    });
  }

  protected openCreate(): void {
    this.editingEvent.set(null);
    this.form.reset({
      eventType: 'Meeting',
      startTime: '09:00',
      endTime: '10:00',
      isRequired: false,
      attendeeUserIds: [],
    });
    this.showDialog.set(true);
  }

  protected openEdit(event: AppEvent): void {
    this.editingEvent.set(event);
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    this.form.patchValue({
      title: event.title,
      description: event.description,
      startDate: start,
      startTime: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
      endDate: end,
      endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
      location: event.location,
      eventType: event.eventType,
      isRequired: event.isRequired,
      attendeeUserIds: event.attendees.map(a => a.userId),
    });
    this.showDialog.set(true);
  }

  protected closeDialog(): void {
    this.showDialog.set(false);
    this.editingEvent.set(null);
  }

  protected save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);

    const val = this.form.getRawValue();
    const startIso = this.combineDateAndTime(val.startDate!, val.startTime!);
    const endIso = this.combineDateAndTime(val.endDate!, val.endTime!);

    const request: EventRequest = {
      title: val.title!,
      description: val.description,
      startTime: startIso,
      endTime: endIso,
      location: val.location,
      eventType: val.eventType!,
      isRequired: val.isRequired!,
      attendeeUserIds: val.attendeeUserIds,
    };

    const editing = this.editingEvent();
    const op = editing
      ? this.eventsService.updateEvent(editing.id, request)
      : this.eventsService.createEvent(request);

    op.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeDialog();
        this.loadEvents();
        this.snackbar.success(editing ? this.translate.instant('adminPanels.events.snackbar.eventUpdated') : this.translate.instant('adminPanels.events.snackbar.eventCreated'));
      },
      error: () => this.saving.set(false),
    });
  }

  protected cancelEvent(event: AppEvent): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Cancel Event?',
        message: `Cancel "${event.title}"? Attendees will be notified.`,
        confirmLabel: 'Cancel Event',
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.eventsService.deleteEvent(event.id).subscribe({
        next: () => {
          this.loadEvents();
          this.snackbar.success(this.translate.instant('adminPanels.events.snackbar.eventDeleted'));
        },
      });
    });
  }

  protected eventTypeIcon(type: string): string {
    switch (type) {
      case 'Meeting': return 'groups';
      case 'Training': return 'school';
      case 'Safety': return 'health_and_safety';
      default: return 'event';
    }
  }

  private combineDateAndTime(date: Date, time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  }
}

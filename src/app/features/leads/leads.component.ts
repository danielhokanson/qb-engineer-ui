import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CdkDragDrop, CdkDropList, CdkDrag, CdkDragPlaceholder, CdkDragPreview } from '@angular/cdk/drag-drop';

import { LeadsService } from './services/leads.service';
import { LeadItem } from './models/lead-item.model';
import { LeadStatus } from './models/lead-status.type';
import { LeadDetailDialogComponent, LeadDetailDialogData, LeadDetailDialogResult } from './components/lead-detail-dialog/lead-detail-dialog.component';
import { ReferenceDataService } from '../../shared/services/reference-data.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { DialogComponent } from '../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../shared/components/select/select.component';
import { TextareaComponent } from '../../shared/components/textarea/textarea.component';
import { DatepickerComponent } from '../../shared/components/datepicker/datepicker.component';
import { DataTableComponent } from '../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../shared/models/column-def.model';
import { FormValidationService } from '../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../shared/components/validation-button/validation-button.component';
import { DraftConfig } from '../../shared/models/draft-config.model';
import { toIsoDate } from '../../shared/utils/date.utils';
import { DetailDialogService } from '../../shared/services/detail-dialog.service';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';

type ViewMode = 'table' | 'pipeline';

const VIEW_MODE_KEY = 'leads-view-mode';

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [
    ReactiveFormsModule, DatePipe, TranslatePipe,
    PageHeaderComponent, DialogComponent,
    InputComponent, SelectComponent, TextareaComponent, DatepickerComponent,
    DataTableComponent, ColumnCellDirective, ValidationButtonComponent, MatTooltipModule,
    CdkDropList, CdkDrag, CdkDragPlaceholder, CdkDragPreview,
    AvatarComponent,
  ],
  templateUrl: './leads.component.html',
  styleUrl: './leads.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeadsComponent {
  @ViewChild(DialogComponent) private dialogRef!: DialogComponent;

  private readonly leadsService = inject(LeadsService);
  private readonly refDataService = inject(ReferenceDataService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly detailDialog = inject(DetailDialogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly leads = signal<LeadItem[]>([]);
  protected draftConfig: DraftConfig = { entityType: 'lead', entityId: 'new', route: '/leads' };

  // View mode — persisted to localStorage
  protected readonly viewMode = signal<ViewMode>(
    (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) ?? 'table'
  );

  // Filters
  protected readonly searchControl = new FormControl('');
  protected readonly statusFilterControl = new FormControl<LeadStatus | null>(null);

  private readonly searchTerm = toSignal(this.searchControl.valueChanges.pipe(startWith('')), { initialValue: '' });
  private readonly statusFilter = toSignal(this.statusFilterControl.valueChanges.pipe(startWith(null as LeadStatus | null)), { initialValue: null as LeadStatus | null });

  // Dialog
  protected readonly showDialog = signal(false);
  protected readonly editingLead = signal<LeadItem | null>(null);
  protected readonly leadForm = new FormGroup({
    companyName: new FormControl('', [Validators.required]),
    contactName: new FormControl(''),
    email: new FormControl('', [Validators.email]),
    phone: new FormControl(''),
    source: new FormControl<string | null>(null),
    notes: new FormControl(''),
    followUpDate: new FormControl<Date | null>(null),
  });

  protected readonly leadViolations = FormValidationService.getViolations(this.leadForm, {
    companyName: 'Company Name',
    contactName: 'Contact Name',
    email: 'Email',
    phone: 'Phone',
    source: 'Source',
    notes: 'Notes',
    followUpDate: 'Follow-Up Date',
  });

  // Lost reason dialog (used by pipeline drag-to-Lost)
  protected readonly showLostDialog = signal(false);
  protected readonly lostLeadId = signal<number | null>(null);
  protected readonly lostReasonControl = new FormControl('');

  protected readonly leadColumns: ColumnDef[] = [
    { field: 'companyName', header: this.translate.instant('leads.colCompany'), sortable: true },
    { field: 'contactName', header: this.translate.instant('leads.colContact'), sortable: true },
    { field: 'source', header: this.translate.instant('leads.colSource'), sortable: true },
    { field: 'status', header: this.translate.instant('common.status'), sortable: true, filterable: true, type: 'enum', filterOptions: [
      { value: 'New', label: this.translate.instant('leads.statusNew') },
      { value: 'Contacted', label: this.translate.instant('leads.statusContacted') },
      { value: 'Quoting', label: this.translate.instant('leads.statusQuoting') },
      { value: 'Converted', label: this.translate.instant('leads.statusConverted') },
      { value: 'Lost', label: this.translate.instant('leads.statusLost') },
    ]},
    { field: 'followUpDate', header: this.translate.instant('leads.colFollowUp'), sortable: true, type: 'date' },
    { field: 'createdAt', header: this.translate.instant('leads.colCreated'), sortable: true, type: 'date' },
  ];

  protected readonly statuses: LeadStatus[] = ['New', 'Contacted', 'Quoting', 'Converted', 'Lost'];

  protected readonly statusOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('leads.allStatuses') },
    ...this.statuses.map(s => ({ value: s, label: s })),
  ];

  protected readonly sourceOptions = signal<SelectOption[]>([{ value: null, label: this.translate.instant('common.none') }]);

  // Filtered leads for pipeline grouping (client-side filter over loaded leads)
  private readonly filteredLeads = computed(() => {
    const term = (this.searchTerm() ?? '').toLowerCase().trim();
    const statusF = this.statusFilter();
    return this.leads().filter(lead => {
      const matchesSearch = !term ||
        lead.companyName.toLowerCase().includes(term) ||
        (lead.contactName ?? '').toLowerCase().includes(term);
      const matchesStatus = !statusF || lead.status === statusF;
      return matchesSearch && matchesStatus;
    });
  });

  // Grouped leads for pipeline view — Map from status → LeadItem[]
  // Using a mutable array per column so CDK drag-drop can splice in-place.
  // We keep it as a computed signal returning a plain object so the template can access each bucket.
  protected readonly groupedLeads = computed<Record<LeadStatus, LeadItem[]>>(() => {
    const map: Record<LeadStatus, LeadItem[]> = {
      New: [], Contacted: [], Quoting: [], Converted: [], Lost: [],
    };
    for (const lead of this.filteredLeads()) {
      map[lead.status].push(lead);
    }
    return map;
  });

  constructor() {
    this.refDataService.getAsOptions('lead_source', { allLabel: this.translate.instant('common.none'), valueField: 'label' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(opts => this.sourceOptions.set(opts));
    this.loadLeads();
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  protected loadLeads(): void {
    this.loading.set(true);
    const status = (this.statusFilter() ?? undefined) || undefined;
    const search = (this.searchTerm() ?? '').trim() || undefined;
    this.leadsService.getLeads(status, search).subscribe({
      next: (leads) => {
        this.leads.set(leads);
        this.loading.set(false);
        this.autoOpenFromUrl();
      },
      error: () => this.loading.set(false),
    });
  }

  /** Auto-open detail dialog when URL contains ?detail=lead:{id} */
  private autoOpenHandled = false;
  private autoOpenFromUrl(): void {
    if (this.autoOpenHandled) return;
    this.autoOpenHandled = true;
    const detail = this.detailDialog.getDetailFromUrl();
    if (detail?.entityType === 'lead') {
      this.openLeadDetail(detail.entityId);
    }
  }

  protected applyFilters(): void { this.loadLeads(); }
  protected clearSearch(): void { this.searchControl.setValue(''); this.loadLeads(); }

  protected openLeadDetail(leadId: number): void {
    this.detailDialog.open<LeadDetailDialogComponent, LeadDetailDialogData, LeadDetailDialogResult | undefined>(
      'lead', leadId, LeadDetailDialogComponent, { leadId },
    ).afterClosed().subscribe(result => {
      if (result?.action === 'edit') {
        this.openEditLeadFromDetail(result.lead);
      }
      this.loadLeads();
    });
  }

  protected openCreateLead(): void {
    this.editingLead.set(null);
    this.draftConfig = { entityType: 'lead', entityId: 'new', route: '/leads' };
    this.leadForm.reset({
      companyName: '',
      contactName: '',
      email: '',
      phone: '',
      source: '',
      notes: '',
      followUpDate: null,
    });
    this.showDialog.set(true);
  }

  private openEditLeadFromDetail(lead: LeadItem): void {
    this.editingLead.set(lead);
    this.draftConfig = { entityType: 'lead', entityId: lead.id.toString(), route: '/leads' };
    this.leadForm.patchValue({
      companyName: lead.companyName,
      contactName: lead.contactName ?? '',
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      source: lead.source ?? '',
      notes: lead.notes ?? '',
      followUpDate: lead.followUpDate ?? null,
    });
    this.showDialog.set(true);
  }

  protected closeDialog(): void {
    this.showDialog.set(false);
  }

  protected saveLead(): void {
    if (this.leadForm.invalid) return;

    this.saving.set(true);
    const form = this.leadForm.getRawValue();
    const editing = this.editingLead();

    const payload = {
      companyName: form.companyName!,
      contactName: form.contactName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      source: form.source || undefined,
      notes: form.notes || undefined,
      followUpDate: toIsoDate(form.followUpDate) ?? undefined,
    };

    if (editing) {
      this.leadsService.updateLead(editing.id, payload).subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogRef.clearDraft();
          this.closeDialog();
          this.loadLeads();
        },
        error: () => this.saving.set(false),
      });
    } else {
      this.leadsService.createLead(payload).subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogRef.clearDraft();
          this.closeDialog();
          this.loadLeads();
        },
        error: () => this.saving.set(false),
      });
    }
  }

  protected confirmLost(): void {
    const leadId = this.lostLeadId();
    if (!leadId) return;
    this.leadsService.updateLead(leadId, {
      status: 'Lost',
      lostReason: this.lostReasonControl.value || undefined,
    }).subscribe({
      next: () => {
        this.showLostDialog.set(false);
        this.lostLeadId.set(null);
        this.lostReasonControl.setValue('');
        this.loadLeads();
      },
    });
  }

  protected getStatusClass(status: string): string {
    const map: Record<string, string> = {
      New: 'chip--primary', Contacted: 'chip--info', Quoting: 'chip--warning',
      Converted: 'chip--success', Lost: 'chip--muted',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  protected isFollowUpOverdue(lead: LeadItem): boolean {
    if (!lead.followUpDate) return false;
    const d = lead.followUpDate instanceof Date ? lead.followUpDate : new Date(lead.followUpDate as unknown as string);
    return d.getTime() < new Date().getTime();
  }

  // ─── Pipeline drag-and-drop ───────────────────────────────────────────────

  /** Returns initials from a contact name (e.g. "Jane Smith" → "JS") */
  protected getInitials(name: string | null): string {
    if (!name) return '?';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  }

  /** Formats estimated value — placeholder since LeadItem has no estimatedValue field yet */
  protected formatValue(_lead: LeadItem): string | null {
    // LeadItem does not currently carry estimatedValue — extend when API adds it
    return null;
  }

  /** All column ids as a string array — needed for CdkDropList [connectedTo] */
  protected readonly pipelineColumnIds = this.statuses.map(s => `pipeline-col-${s}`);

  protected onCardDrop(
    event: CdkDragDrop<LeadItem[]>,
    targetStatus: LeadStatus,
  ): void {
    if (event.previousContainer === event.container) {
      // Reorder within same column — no API call needed
      return;
    }

    const lead: LeadItem = event.item.data;
    if (lead.status === targetStatus) return;

    // Optimistically move the card in the local leads array
    this.leads.update(all =>
      all.map(l => l.id === lead.id ? { ...l, status: targetStatus } : l)
    );

    // If dropping into Lost, show the lost reason dialog (same UX as button)
    if (targetStatus === 'Lost') {
      this.lostLeadId.set(lead.id);
      this.showLostDialog.set(true);
      return;
    }

    this.leadsService.updateLead(lead.id, { status: targetStatus }).subscribe({
      next: (updated) => {
        // Sync the authoritative response back into the leads array
        this.leads.update(all => all.map(l => l.id === updated.id ? updated : l));
      },
      error: () => {
        // Roll back optimistic update on failure
        this.leads.update(all =>
          all.map(l => l.id === lead.id ? { ...l, status: lead.status } : l)
        );
      },
    });
  }
}

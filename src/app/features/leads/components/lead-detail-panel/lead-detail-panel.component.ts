import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { LeadsService } from '../../services/leads.service';
import { LeadItem } from '../../models/lead-item.model';
import { LeadStatus } from '../../models/lead-status.type';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { EntityActivitySectionComponent } from '../../../../shared/components/entity-activity-section/entity-activity-section.component';

@Component({
  selector: 'app-lead-detail-panel',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule, TranslatePipe, MatTooltipModule,
    DialogComponent, TextareaComponent, EntityActivitySectionComponent,
  ],
  templateUrl: './lead-detail-panel.component.html',
  styleUrl: './lead-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeadDetailPanelComponent {
  private readonly leadsService = inject(LeadsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly leadId = input.required<number>();
  readonly closed = output<void>();
  readonly editRequested = output<LeadItem>();

  protected readonly lead = signal<LeadItem | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  // Lost reason dialog
  protected readonly showLostDialog = signal(false);
  protected readonly lostReasonControl = new FormControl('');

  protected readonly statuses: LeadStatus[] = ['New', 'Contacted', 'Quoting', 'Converted', 'Lost'];

  constructor() {
    effect(() => {
      const id = this.leadId();
      if (id) {
        this.loadLead(id);
      }
    });
  }

  private loadLead(id: number): void {
    this.loading.set(true);
    this.leadsService.getLeadById(id).subscribe({
      next: (lead) => { this.lead.set(lead); this.loading.set(false); },
      error: () => this.loading.set(false),
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

  protected updateStatus(status: LeadStatus): void {
    const lead = this.lead();
    if (!lead) return;

    if (status === 'Lost') {
      this.showLostDialog.set(true);
      return;
    }

    this.leadsService.updateLead(lead.id, { status }).subscribe({
      next: (updated) => { this.lead.set(updated); },
    });
  }

  protected confirmLost(): void {
    const lead = this.lead();
    if (!lead) return;
    this.leadsService.updateLead(lead.id, {
      status: 'Lost',
      lostReason: this.lostReasonControl.value || undefined,
    }).subscribe({
      next: (updated) => {
        this.lead.set(updated);
        this.showLostDialog.set(false);
        this.lostReasonControl.setValue('');
      },
    });
  }

  protected openEditLead(): void {
    const lead = this.lead();
    if (!lead) return;
    this.editRequested.emit(lead);
  }

  protected convertLead(): void {
    const lead = this.lead();
    if (!lead) return;

    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('leads.convertTitle'),
        message: this.translate.instant('leads.convertMessage', { name: lead.companyName }),
        confirmLabel: this.translate.instant('leads.convertOnly'),
        severity: 'info',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (confirmed === undefined) return;
      this.executeConversion(lead.id, false);
    });
  }

  protected convertLeadWithJob(): void {
    const lead = this.lead();
    if (!lead) return;
    this.executeConversion(lead.id, true);
  }

  private executeConversion(leadId: number, createJob: boolean): void {
    this.saving.set(true);
    this.leadsService.convertLead(leadId, createJob).subscribe({
      next: () => {
        this.saving.set(false);
        const msg = createJob
          ? this.translate.instant('leads.convertedWithJob')
          : this.translate.instant('leads.convertedOnly');
        this.snackbar.success(msg);
        this.loadLead(leadId);
      },
      error: () => {
        this.saving.set(false);
        this.snackbar.error(this.translate.instant('leads.convertFailed'));
      },
    });
  }
}

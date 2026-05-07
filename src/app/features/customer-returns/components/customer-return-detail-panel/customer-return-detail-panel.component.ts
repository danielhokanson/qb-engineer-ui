import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { CustomerReturnService } from '../../services/customer-return.service';
import { CustomerReturnDetail } from '../../models/customer-return-detail.model';
import { EntityActivitySectionComponent } from '../../../../shared/components/entity-activity-section/entity-activity-section.component';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';

@Component({
  selector: 'app-customer-return-detail-panel',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    TranslatePipe,
    MatTooltipModule,
    EntityActivitySectionComponent,
    DialogComponent,
    TextareaComponent,
    LoadingBlockDirective,
  ],
  templateUrl: './customer-return-detail-panel.component.html',
  styleUrl: './customer-return-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReturnDetailPanelComponent {
  private readonly service = inject(CustomerReturnService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly customerReturnId = input.required<number>();
  readonly closed = output<void>();
  readonly updated = output<void>();

  protected readonly detail = signal<CustomerReturnDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly showResolveDialog = signal(false);
  protected readonly resolveSaving = signal(false);

  protected readonly resolveForm = new FormGroup({
    inspectionNotes: new FormControl('', [Validators.maxLength(1000)]),
  });

  constructor() {
    effect(() => {
      const id = this.customerReturnId();
      if (id) {
        this.loadDetail(id);
      }
    });
  }

  private loadDetail(id: number): void {
    this.loading.set(true);
    this.service.getById(id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openResolve(): void {
    this.resolveForm.reset();
    this.showResolveDialog.set(true);
  }

  protected closeResolveDialog(): void {
    this.showResolveDialog.set(false);
  }

  protected resolve(): void {
    const r = this.detail();
    if (!r) return;
    this.resolveSaving.set(true);
    const notes = this.resolveForm.value.inspectionNotes || undefined;
    this.service.resolve(r.id, notes).subscribe({
      next: (updated) => {
        this.detail.set(updated);
        this.resolveSaving.set(false);
        this.closeResolveDialog();
        this.snackbar.success(this.translate.instant('customerReturns.resolved'));
        this.updated.emit();
      },
      error: () => this.resolveSaving.set(false),
    });
  }

  protected closeReturn(r: CustomerReturnDetail): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('customerReturns.closeTitle'),
        message: this.translate.instant('customerReturns.closeMessage', { number: r.returnNumber }),
        confirmLabel: this.translate.instant('customerReturns.closeConfirm'),
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.service.close(r.id).subscribe({
        next: (updated) => {
          this.detail.set(updated);
          this.snackbar.success(this.translate.instant('customerReturns.closed'));
          this.updated.emit();
        },
      });
    });
  }

  protected getStatusClass(status: string): string {
    const map: Record<string, string> = {
      Received: 'chip--info',
      ReworkOrdered: 'chip--warning',
      InInspection: 'chip--primary',
      Resolved: 'chip--success',
      Closed: 'chip--muted',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  protected getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      ReworkOrdered: 'Rework Ordered',
      InInspection: 'In Inspection',
    };
    return labels[status] ?? status;
  }
}

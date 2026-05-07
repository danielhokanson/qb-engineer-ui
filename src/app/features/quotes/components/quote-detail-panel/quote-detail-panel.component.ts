import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { QuoteService } from '../../services/quote.service';
import { QuoteDetail } from '../../models/quote-detail.model';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EntityActivitySectionComponent } from '../../../../shared/components/entity-activity-section/entity-activity-section.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { EntityLinkComponent } from '../../../../shared/components/entity-link/entity-link.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';

@Component({
  selector: 'app-quote-detail-panel',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, TranslatePipe,
    MatTooltipModule, LoadingBlockDirective,
    EntityActivitySectionComponent,
    EntityLinkComponent, CurrencyDisplayComponent,
  ],
  templateUrl: './quote-detail-panel.component.html',
  styleUrl: './quote-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuoteDetailPanelComponent {
  private readonly quoteService = inject(QuoteService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly quoteId = input.required<number>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  protected readonly loading = signal(false);
  protected readonly quote = signal<QuoteDetail | null>(null);

  protected readonly quoteIdValue = computed(() => this.quoteId());

  constructor() {
    effect(() => {
      const id = this.quoteId();
      if (id) this.loadQuote(id);
    });
  }

  private loadQuote(id: number): void {
    this.loading.set(true);
    this.quoteService.getQuoteById(id).subscribe({
      next: (detail) => { this.quote.set(detail); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  // --- Status Actions ---
  protected sendQuote(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.sendQuote(q.id).subscribe({
      next: () => {
        this.loadQuote(q.id);
        this.changed.emit();
        this.snackbar.success(this.translate.instant('quotes.quoteSent'));
      },
    });
  }

  protected acceptQuote(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.acceptQuote(q.id).subscribe({
      next: () => {
        this.loadQuote(q.id);
        this.changed.emit();
        this.snackbar.success(this.translate.instant('quotes.quoteAccepted'));
      },
    });
  }

  protected rejectQuote(): void {
    const q = this.quote();
    if (!q) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('quotes.rejectQuoteTitle'),
        message: this.translate.instant('quotes.rejectQuoteMessage', { number: q.quoteNumber }),
        confirmLabel: this.translate.instant('quotes.reject'),
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.quoteService.rejectQuote(q.id).subscribe({
        next: () => {
          this.loadQuote(q.id);
          this.changed.emit();
          this.snackbar.success(this.translate.instant('quotes.quoteRejected'));
        },
      });
    });
  }

  protected convertToOrder(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.convertToOrder(q.id).subscribe({
      next: (order) => {
        this.loadQuote(q.id);
        this.changed.emit();
        this.snackbar.success(this.translate.instant('quotes.quoteConverted', { number: order.orderNumber ?? '' }));
      },
    });
  }

  protected deleteQuote(): void {
    const q = this.quote();
    if (!q) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('quotes.deleteQuoteTitle'),
        message: this.translate.instant('quotes.deleteQuoteMessage', { number: q.quoteNumber }),
        confirmLabel: this.translate.instant('common.delete'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.quoteService.deleteQuote(q.id).subscribe({
        next: () => {
          this.changed.emit();
          this.closed.emit();
          this.snackbar.success(this.translate.instant('quotes.quoteDeleted'));
        },
      });
    });
  }

  // --- Helpers ---
  protected getStatusClass(status: string): string {
    const map: Record<string, string> = {
      Draft: 'chip--muted',
      Sent: 'chip--info',
      Accepted: 'chip--success',
      Declined: 'chip--error',
      Expired: 'chip--warning',
      ConvertedToOrder: 'chip--primary',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  protected getStatusLabel(status: string): string {
    const key = 'quotes.status' + status;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : status;
  }

  protected canSend(status: string): boolean { return status === 'Draft'; }
  protected canAccept(status: string): boolean { return status === 'Sent'; }
  protected canReject(status: string): boolean { return status === 'Sent'; }
  protected canConvert(status: string): boolean { return status === 'Accepted'; }
  protected canDelete(status: string): boolean { return status === 'Draft'; }
}

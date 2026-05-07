import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { MatTooltipModule } from '@angular/material/tooltip';

import { ExpensesService } from '../services/expenses.service';
import { ExpenseItem } from '../models/expense-item.model';
import { ExpenseStatus } from '../models/expense-status.type';
import { PageLayoutComponent } from '../../../shared/components/page-layout/page-layout.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../shared/models/column-def.model';
import { InputComponent } from '../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../shared/components/textarea/textarea.component';
import { DialogComponent } from '../../../shared/components/dialog/dialog.component';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { SpacerDirective } from '../../../shared/directives/spacer.directive';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-expense-approval-queue',
  standalone: true,
  imports: [
    ReactiveFormsModule, DatePipe, CurrencyPipe,
    PageLayoutComponent, DataTableComponent, ColumnCellDirective,
    InputComponent, TextareaComponent, DialogComponent,
    LoadingBlockDirective, SpacerDirective, TranslatePipe, MatTooltipModule,
  ],
  templateUrl: './expense-approval-queue.component.html',
  styleUrl: './expense-approval-queue.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpenseApprovalQueueComponent {
  private readonly expensesService = inject(ExpensesService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly pendingExpenses = signal<ExpenseItem[]>([]);
  protected readonly searchControl = new FormControl('');

  // Review dialog
  protected readonly reviewExpense = signal<ExpenseItem | null>(null);
  protected readonly notesControl = new FormControl('');
  protected readonly processing = signal(false);

  protected readonly DECLINE_NOTE_MIN = 10;
  protected readonly noteLength = signal(0);
  protected readonly declineNoteValid = signal(false);

  protected readonly columns: ColumnDef[] = [
    { field: 'expenseDate', header: this.translate.instant('expenses.colDate'), sortable: true, type: 'date', width: '110px' },
    { field: 'userName', header: this.translate.instant('expenses.colSubmittedBy'), sortable: true, width: '160px' },
    { field: 'category', header: this.translate.instant('expenses.colCategory'), sortable: true, width: '120px' },
    { field: 'description', header: this.translate.instant('expenses.colDescription') },
    { field: 'jobNumber', header: this.translate.instant('expenses.colJob'), width: '100px' },
    { field: 'amount', header: this.translate.instant('expenses.colAmount'), sortable: true, align: 'right', width: '100px' },
    { field: 'actions', header: '', width: '100px', align: 'right' },
  ];

  constructor() {
    this.loadPending();
    this.notesControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      const len = (value ?? '').trim().length;
      this.noteLength.set(len);
      this.declineNoteValid.set(len >= this.DECLINE_NOTE_MIN);
    });
  }

  protected loadPending(): void {
    this.loading.set(true);
    const search = this.searchControl.value?.trim() || undefined;
    this.expensesService.getExpenses(undefined, 'Pending', search).subscribe({
      next: (items) => { this.pendingExpenses.set(items); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  protected openReview(expense: ExpenseItem): void {
    this.reviewExpense.set(expense);
    this.notesControl.setValue('');
    this.noteLength.set(0);
    this.declineNoteValid.set(false);
  }

  protected closeReview(): void {
    this.reviewExpense.set(null);
  }

  protected approve(): void {
    const expense = this.reviewExpense();
    if (!expense) return;

    this.processing.set(true);
    this.expensesService.updateExpenseStatus(expense.id, {
      status: 'Approved',
      approvalNotes: this.notesControl.value?.trim() || undefined,
    }).subscribe({
      next: () => {
        this.processing.set(false);
        this.closeReview();
        this.loadPending();
        this.snackbar.success(this.translate.instant('expenses.expenseApproved'));
      },
      error: () => this.processing.set(false),
    });
  }

  protected reject(): void {
    this.updateStatus('Rejected', 'expenses.expenseRejected');
  }

  protected requestRevision(): void {
    this.updateStatus('NeedsRevision', 'expenses.expenseRevisionRequested');
  }

  private updateStatus(status: ExpenseStatus, successKey: string): void {
    const expense = this.reviewExpense();
    if (!expense) return;
    if (!this.declineNoteValid()) return;

    this.processing.set(true);
    this.expensesService.updateExpenseStatus(expense.id, {
      status,
      approvalNotes: this.notesControl.value?.trim() || undefined,
    }).subscribe({
      next: () => {
        this.processing.set(false);
        this.closeReview();
        this.loadPending();
        this.snackbar.success(this.translate.instant(successKey));
      },
      error: () => this.processing.set(false),
    });
  }

  protected getPendingTotal(): number {
    return this.pendingExpenses().reduce((sum, e) => sum + e.amount, 0);
  }
}

import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { RfqListItem } from '../../models/rfq.model';

@Component({
  selector: 'app-rfq-list',
  standalone: true,
  imports: [DatePipe, TranslatePipe, DataTableComponent, ColumnCellDirective, LoadingBlockDirective],
  templateUrl: './rfq-list.component.html',
  styleUrl: './rfq-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RfqListComponent {
  private readonly translate = inject(TranslateService);

  readonly data = input.required<RfqListItem[]>();
  readonly loading = input(false);
  readonly rowClicked = output<RfqListItem>();

  protected readonly rfqColumns: ColumnDef[] = [
    { field: 'rfqNumber', header: this.translate.instant('purchasing.cols.rfqNumber'), sortable: true, width: '140px' },
    { field: 'partNumber', header: this.translate.instant('purchasing.cols.part'), sortable: true, width: '120px' },
    { field: 'partDescription', header: this.translate.instant('purchasing.cols.description'), sortable: true },
    { field: 'quantity', header: this.translate.instant('purchasing.cols.qty'), sortable: true, width: '80px', align: 'center' },
    { field: 'status', header: this.translate.instant('purchasing.cols.status'), sortable: true, filterable: true, type: 'enum', width: '150px',
      filterOptions: [
        { value: 'Draft', label: this.translate.instant('purchasing.statuses.draft') },
        { value: 'Sent', label: this.translate.instant('purchasing.statuses.sent') },
        { value: 'Receiving', label: this.translate.instant('purchasing.statuses.receiving') },
        { value: 'EvaluatingResponses', label: this.translate.instant('purchasing.statuses.evaluating') },
        { value: 'Awarded', label: this.translate.instant('purchasing.statuses.awarded') },
        { value: 'Cancelled', label: this.translate.instant('purchasing.statuses.cancelled') },
        { value: 'Expired', label: this.translate.instant('purchasing.statuses.expired') },
      ] },
    { field: 'vendorResponseCount', header: this.translate.instant('purchasing.cols.vendors'), sortable: true, width: '90px', align: 'center' },
    { field: 'receivedResponseCount', header: this.translate.instant('purchasing.cols.received'), sortable: true, width: '90px', align: 'center' },
    { field: 'requiredDate', header: this.translate.instant('purchasing.cols.required'), sortable: true, type: 'date', width: '110px' },
    { field: 'responseDeadline', header: this.translate.instant('purchasing.cols.deadline'), sortable: true, type: 'date', width: '110px' },
    { field: 'createdAt', header: this.translate.instant('purchasing.cols.created'), sortable: true, type: 'date', width: '110px' },
  ];

  protected getStatusClass(status: string): string {
    const map: Record<string, string> = {
      Draft: 'chip--muted',
      Sent: 'chip--info',
      Receiving: 'chip--primary',
      EvaluatingResponses: 'chip--warning',
      Awarded: 'chip--success',
      Cancelled: 'chip--error',
      Expired: 'chip--muted',
    };
    return `chip ${map[status] ?? ''}`.trim();
  }

  protected getStatusLabel(status: string): string {
    const keyMap: Record<string, string> = {
      Draft: 'purchasing.statuses.draft',
      Sent: 'purchasing.statuses.sent',
      Receiving: 'purchasing.statuses.receiving',
      EvaluatingResponses: 'purchasing.statuses.evaluating',
      Awarded: 'purchasing.statuses.awarded',
      Cancelled: 'purchasing.statuses.cancelled',
      Expired: 'purchasing.statuses.expired',
    };
    const key = keyMap[status];
    return key ? this.translate.instant(key) : status;
  }

  protected onRowClick(row: unknown): void {
    this.rowClicked.emit(row as RfqListItem);
  }
}

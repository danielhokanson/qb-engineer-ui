import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal, OnInit,
} from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { TranslatePipe } from '@ngx-translate/core';

import { ColumnDef } from '../../../models/column-def.model';

export interface ColumnManagerState {
  visibility: Record<string, boolean>;
  order: string[];
}

@Component({
  selector: 'app-column-manager-panel',
  standalone: true,
  imports: [DragDropModule, MatCheckboxModule, TranslatePipe],
  templateUrl: './column-manager-panel.component.html',
  styleUrl: './column-manager-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnManagerPanelComponent implements OnInit {
  readonly columns = input.required<ColumnDef[]>();
  readonly visibility = input.required<Record<string, boolean>>();
  readonly order = input.required<string[]>();

  readonly stateChanged = output<ColumnManagerState>();
  readonly resetRequested = output<void>();
  readonly closed = output<void>();

  protected readonly localOrder = signal<string[]>([]);
  protected readonly localVisibility = signal<Record<string, boolean>>({});

  ngOnInit(): void {
    this.localOrder.set([...this.order()]);
    this.localVisibility.set({ ...this.visibility() });
  }

  getColumnByField(field: string): ColumnDef | undefined {
    return this.columns().find(c => c.field === field);
  }

  isVisible(field: string): boolean {
    return this.localVisibility()[field] !== false;
  }

  toggleVisibility(field: string): void {
    const vis = { ...this.localVisibility() };
    vis[field] = !this.isVisible(field);
    this.localVisibility.set(vis);
    this.emitState();
  }

  onDrop(event: CdkDragDrop<string[]>): void {
    const order = [...this.localOrder()];
    moveItemInArray(order, event.previousIndex, event.currentIndex);
    this.localOrder.set(order);
    this.emitState();
  }

  onReset(): void {
    this.resetRequested.emit();
    this.closed.emit();
  }

  private emitState(): void {
    this.stateChanged.emit({
      visibility: this.localVisibility(),
      order: this.localOrder(),
    });
  }
}

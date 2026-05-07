import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface ClockEventTypeDef {
  code: string;
  label: string;
  statusMapping: string;
  oppositeCode: string;
  category: string;
  countsAsActive: boolean;
  isMismatchable: boolean;
  icon: string;
  color: string;
}

export interface ClockStatusInfo {
  label: string;
  shortLabel: string;
  cssClass: string;
}

/** Known status mapping values — derived from reference data metadata.statusMapping */
const STATUS_DISPLAY: Record<string, ClockStatusInfo> = {
  In: { label: 'Currently Working', shortLabel: 'IN', cssClass: 'in' },
  Out: { label: 'Clocked Out', shortLabel: 'OUT', cssClass: 'out' },
  OnBreak: { label: 'On Break', shortLabel: 'BREAK', cssClass: 'break' },
  OnLunch: { label: 'On Lunch', shortLabel: 'LUNCH', cssClass: 'break' },
};

const FALLBACK_STATUS: ClockStatusInfo = { label: 'Unknown', shortLabel: '?', cssClass: 'out' };

@Injectable({ providedIn: 'root' })
export class ClockEventTypeService {
  private readonly http = inject(HttpClient);
  private readonly _definitions = signal<ClockEventTypeDef[]>([]);
  private loaded = false;

  readonly definitions = this._definitions.asReadonly();

  /** Load clock event type definitions from reference data API. Safe to call multiple times. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    this.http.get<ReferenceDataItem[] | { data?: ReferenceDataItem[] }>('/api/v1/reference-data/clock_event_type').subscribe({
      next: (result) => {
        const items: ReferenceDataItem[] = Array.isArray(result) ? result : result.data ?? [];
        const defs = items.map((item: ReferenceDataItem) => this.parseDefinition(item));
        this._definitions.set(defs);
      },
      error: () => {
        this.loaded = false; // Allow retry
      },
    });
  }

  /** Get display info for a worker's current status string. */
  getStatusInfo(status: string | null | undefined): ClockStatusInfo {
    if (!status) return STATUS_DISPLAY['Out'] ?? FALLBACK_STATUS;

    // First try known statuses
    const known = STATUS_DISPLAY[status];
    if (known) return known;

    // Try to derive from loaded definitions — find event whose statusMapping matches
    const def = this._definitions().find((d) => d.statusMapping === status);
    if (def) {
      return {
        label: status,
        shortLabel: status.toUpperCase(),
        cssClass: def.category === 'break' || def.category === 'lunch' ? 'break' : 'out',
      };
    }

    return FALLBACK_STATUS;
  }

  /** Get the CSS class suffix for a status (e.g., 'in', 'break', 'out'). */
  getStatusCssClass(status: string | null | undefined): string {
    return this.getStatusInfo(status).cssClass;
  }

  /** Get short status label (e.g., 'IN', 'BREAK', 'OUT'). */
  getShortLabel(status: string | null | undefined): string {
    return this.getStatusInfo(status).shortLabel;
  }

  /** Get full status label (e.g., 'Currently Working', 'On Break'). */
  getLabel(status: string | null | undefined): string {
    return this.getStatusInfo(status).label;
  }

  /** Is the worker currently on premises (not clocked out)? */
  isActive(status: string | null | undefined): boolean {
    return !!status && status !== 'Out';
  }

  /** Is the worker currently working (status = 'In')? */
  isWorking(status: string | null | undefined): boolean {
    return status === 'In';
  }

  /** Is the worker on break or lunch? */
  isOnBreakOrLunch(status: string | null | undefined): boolean {
    if (!status) return false;
    const info = STATUS_DISPLAY[status];
    return info?.cssClass === 'break';
  }

  /** Is the worker clocked out? */
  isClockedOut(status: string | null | undefined): boolean {
    return !status || status === 'Out';
  }

  /**
   * Get available clock actions for a given worker status.
   * Returns event type definitions that are valid next actions.
   */
  getAvailableActions(currentStatus: string | null | undefined): ClockEventTypeDef[] {
    const defs = this._definitions();
    if (defs.length === 0) return [];

    const status = currentStatus ?? 'Out';
    const defMap = new Map(defs.map((d) => [d.code, d]));

    return defs.filter((def) => {
      // ClockOut special case: available whenever worker is active (not Out)
      if (def.statusMapping === 'Out') {
        return status !== 'Out';
      }

      // For all other events: show when opposite event's statusMapping matches current status
      const opposite = defMap.get(def.oppositeCode);
      return opposite ? opposite.statusMapping === status : false;
    });
  }

  private parseDefinition(item: ReferenceDataItem): ClockEventTypeDef {
    const meta = item.metadata ? JSON.parse(item.metadata) : {};
    return {
      code: item.code,
      label: item.label,
      statusMapping: meta.statusMapping ?? 'Out',
      oppositeCode: meta.oppositeCode ?? '',
      category: meta.category ?? 'work',
      countsAsActive: meta.countsAsActive ?? false,
      isMismatchable: meta.isMismatchable ?? false,
      icon: meta.icon ?? 'schedule',
      color: meta.color ?? '#94a3b8',
    };
  }
}

interface ReferenceDataItem {
  id: number;
  code: string;
  label: string;
  metadata: string | null;
}

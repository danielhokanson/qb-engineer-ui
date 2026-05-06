import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { AuthService } from '../../../shared/services/auth.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';
import { toDateOnly } from '../../../shared/utils/date.utils';

interface DailyHours {
  date: string;
  dayLabel: string;
  totalHours: number;
  entries: HourEntry[];
}

interface HourEntry {
  id: number;
  jobNumber: string | null;
  description: string;
  hours: number;
  startTime: string;
  endTime: string | null;
}

interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  totalHours: number;
  days: DailyHours[];
}

@Component({
  selector: 'app-mobile-hours',
  standalone: true,
  imports: [DatePipe, EmptyStateComponent, LoadingBlockDirective],
  templateUrl: './mobile-hours.component.html',
  styleUrl: './mobile-hours.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileHoursComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  protected readonly loading = signal(true);
  protected readonly weekData = signal<WeekSummary | null>(null);
  protected readonly expandedDay = signal<string | null>(null);
  protected readonly weekOffset = signal(0);

  protected readonly weekLabel = computed(() => {
    const data = this.weekData();
    if (!data) return '';
    return `${this.formatShortDate(data.weekStart)} - ${this.formatShortDate(data.weekEnd)}`;
  });

  protected readonly isCurrentWeek = computed(() => this.weekOffset() === 0);

  ngOnInit(): void {
    this.loadWeek();
  }

  private loadWeek(): void {
    const userId = this.authService.user()?.id;
    if (!userId) return;

    this.loading.set(true);
    const offset = this.weekOffset();

    // Calculate week start/end based on offset
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset + offset * 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Server expects DateOnly query params. toDateOnly takes the local
    // calendar date so the user's "this week" matches what they're
    // looking at on their calendar regardless of UTC offset.
    const startStr = toDateOnly(weekStart)!;
    const endStr = toDateOnly(weekEnd)!;

    this.http.get<{ data: HourEntry[] }>('/api/v1/time-tracking/entries', {
      params: {
        userId: userId.toString(),
        startDate: startStr,
        endDate: endStr,
        pageSize: '200',
      },
    }).subscribe({
      next: (result) => {
        const entries = result.data ?? [];
        const days = this.groupByDay(entries, weekStart);
        const totalHours = days.reduce((sum, d) => sum + d.totalHours, 0);

        this.weekData.set({
          weekStart: startStr,
          weekEnd: endStr,
          totalHours,
          days,
        });
        this.loading.set(false);
      },
      error: () => {
        this.weekData.set(null);
        this.loading.set(false);
      },
    });
  }

  private groupByDay(entries: HourEntry[], weekStart: Date): DailyHours[] {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days: DailyHours[] = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const dateStr = toDateOnly(date)!;
      const dayEntries = entries.filter((e) => e.startTime?.startsWith(dateStr));
      const totalHours = dayEntries.reduce((sum, e) => sum + (e.hours ?? 0), 0);

      days.push({
        date: dateStr,
        dayLabel: dayNames[date.getDay()],
        totalHours,
        entries: dayEntries,
      });
    }

    return days;
  }

  protected previousWeek(): void {
    this.weekOffset.update((v) => v - 1);
    this.expandedDay.set(null);
    this.loadWeek();
  }

  protected nextWeek(): void {
    if (this.isCurrentWeek()) return;
    this.weekOffset.update((v) => v + 1);
    this.expandedDay.set(null);
    this.loadWeek();
  }

  protected toggleDay(date: string): void {
    this.expandedDay.update((v) => (v === date ? null : date));
  }

  protected formatHours(hours: number): string {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  private formatShortDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  protected formatTime(isoStr: string): string {
    const date = new Date(isoStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  protected getDayDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  }
}

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  ReportEntityDefinition,
  ReportFilter,
  SavedReport,
  RunReportResponse,
} from '../models/report-builder.model';
import { CreateSavedReportRequest } from '../models/create-saved-report-request.model';

@Injectable({ providedIn: 'root' })
export class ReportBuilderService {
  private readonly http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/report-builder`;

  readonly entities = signal<ReportEntityDefinition[]>([]);
  readonly savedReports = signal<SavedReport[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  loadEntities(): void {
    this.loading.set(true);
    this.http.get<ReportEntityDefinition[]>(`${this.API}/entities`).subscribe({
      next: (data) => {
        this.entities.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadSavedReports(): void {
    this.http.get<SavedReport[]>(`${this.API}/saved`).subscribe({
      next: (data) => this.savedReports.set(data),
      error: () => {},
    });
  }

  getSavedReport(id: number): Observable<SavedReport> {
    return this.http.get<SavedReport>(`${this.API}/saved/${id}`);
  }

  createReport(request: CreateSavedReportRequest): Observable<SavedReport> {
    return this.http.post<SavedReport>(`${this.API}/saved`, request).pipe(
      tap(() => this.loadSavedReports()),
    );
  }

  updateReport(id: number, request: CreateSavedReportRequest): Observable<void> {
    return this.http.put<void>(`${this.API}/saved/${id}`, request).pipe(
      tap(() => this.loadSavedReports()),
    );
  }

  deleteReport(id: number): Observable<void> {
    return this.http.delete<void>(`${this.API}/saved/${id}`).pipe(
      tap(() => this.loadSavedReports()),
    );
  }

  runReport(params: {
    entitySource: string;
    columns: string[];
    filters: ReportFilter[];
    groupByField?: string;
    sortField?: string;
    sortDirection?: string;
  }): Observable<RunReportResponse> {
    return this.http.post<RunReportResponse>(`${this.API}/run`, params);
  }
}

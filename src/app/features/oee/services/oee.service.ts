import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { OeeCalculation } from '../models/oee-calculation.model';
import { OeeTrendPoint } from '../models/oee-trend-point.model';
import { SixBigLosses } from '../models/six-big-losses.model';
import { OeeTrendGranularity } from '../models/oee-trend-granularity.type';

@Injectable({ providedIn: 'root' })
export class OeeService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/reports`;

  getOeeReport(dateFrom: string, dateTo: string): Observable<OeeCalculation[]> {
    return this.http.get<OeeCalculation[]>(`${this.base}/oee`, {
      params: { dateFrom, dateTo },
    });
  }

  getOeeByWorkCenter(workCenterId: number, dateFrom: string, dateTo: string): Observable<OeeCalculation> {
    return this.http.get<OeeCalculation>(`${this.base}/oee/${workCenterId}`, {
      params: { dateFrom, dateTo },
    });
  }

  getOeeTrend(
    workCenterId: number,
    dateFrom: string,
    dateTo: string,
    granularity: OeeTrendGranularity = 'Daily',
  ): Observable<OeeTrendPoint[]> {
    return this.http.get<OeeTrendPoint[]>(`${this.base}/oee/${workCenterId}/trend`, {
      params: { dateFrom, dateTo, granularity },
    });
  }

  getSixBigLosses(workCenterId: number, dateFrom: string, dateTo: string): Observable<SixBigLosses> {
    return this.http.get<SixBigLosses>(`${this.base}/oee/${workCenterId}/losses`, {
      params: { dateFrom, dateTo },
    });
  }
}

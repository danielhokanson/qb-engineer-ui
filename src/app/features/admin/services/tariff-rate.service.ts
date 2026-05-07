import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  TariffRate,
  CreateTariffRateRequest,
  UpdateTariffRateRequest,
} from '../models/tariff-rate.model';

/**
 * Bought-parts effort PR4 — admin TariffRate CRUD wrapper. Powers the
 * `/admin/tariffs` page. SCD-2 supersession is the admin's
 * responsibility (close the prior row, insert a new one) — the API
 * doesn't auto-manage the effective window.
 */
@Injectable({ providedIn: 'root' })
export class TariffRateService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/tariff-rates`;

  list(): Observable<TariffRate[]> {
    return this.http.get<TariffRate[]>(this.base);
  }

  getById(id: number): Observable<TariffRate> {
    return this.http.get<TariffRate>(`${this.base}/${id}`);
  }

  create(request: CreateTariffRateRequest): Observable<TariffRate> {
    return this.http.post<TariffRate>(this.base, request);
  }

  update(id: number, request: UpdateTariffRateRequest): Observable<TariffRate> {
    return this.http.put<TariffRate>(`${this.base}/${id}`, request);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}

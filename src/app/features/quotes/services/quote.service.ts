import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { QuoteListItem } from '../models/quote-list-item.model';
import { QuoteDetail } from '../models/quote-detail.model';
import { CreateQuoteRequest } from '../models/create-quote-request.model';
import { SalesOrderListItem } from '../../sales-orders/models/sales-order-list-item.model';

@Injectable({ providedIn: 'root' })
export class QuoteService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/quotes`;

  getQuotes(customerId?: number, status?: string): Observable<QuoteListItem[]> {
    let params = new HttpParams();
    if (customerId) params = params.set('customerId', String(customerId));
    if (status) params = params.set('status', status);
    return this.http.get<QuoteListItem[]>(this.base, { params });
  }

  getQuoteById(id: number): Observable<QuoteDetail> {
    return this.http.get<QuoteDetail>(`${this.base}/${id}`);
  }

  createQuote(request: CreateQuoteRequest): Observable<QuoteDetail> {
    return this.http.post<QuoteDetail>(this.base, request);
  }

  updateQuote(id: number, request: { shippingAddressId?: number; expirationDate?: string; notes?: string; taxRate?: number }): Observable<void> {
    return this.http.put<void>(`${this.base}/${id}`, request);
  }

  sendQuote(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/send`, {});
  }

  acceptQuote(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/accept`, {});
  }

  rejectQuote(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/reject`, {});
  }

  convertToOrder(id: number): Observable<SalesOrderListItem> {
    return this.http.post<SalesOrderListItem>(`${this.base}/${id}/convert`, {});
  }

  deleteQuote(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}

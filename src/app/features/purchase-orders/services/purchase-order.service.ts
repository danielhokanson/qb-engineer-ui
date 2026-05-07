import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../environments/environment';
import { PagedResponse, PagedQuery } from '../../../shared/models/paged-response.model';
import { PurchaseOrderListItem } from '../models/purchase-order-list-item.model';
import { PurchaseOrderDetail } from '../models/purchase-order-detail.model';
import { CreatePurchaseOrderRequest } from '../models/create-purchase-order-request.model';
import { UpdatePurchaseOrderRequest } from '../models/update-purchase-order-request.model';
import { ReceiveItemsRequest } from '../models/receive-items-request.model';
import { PurchaseOrderRelease, CreatePurchaseOrderReleaseRequest, UpdatePurchaseOrderReleaseRequest } from '../models/purchase-order-release.model';
import { AutoPoSuggestion } from '../models/auto-po-suggestion.model';
import { AutoPoSettings, UpdateAutoPoSettingsRequest } from '../models/auto-po-settings.model';

/** Phase 3 F7-broad / WU-22 — paged purchase-order list query parameters. */
export interface PurchaseOrderListPagedQuery extends PagedQuery {
  vendorId?: number | null;
  jobId?: number | null;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class PurchaseOrderService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/purchase-orders`;
  private readonly autoPoBase = `${environment.apiUrl}/auto-po`;

  /**
   * Phase 3 F7-broad / WU-22 — backward-compat shim that calls the paged
   * endpoint and unwraps the envelope. New callers should use
   * {@link getPurchaseOrdersPaged} so they can read `totalCount`.
   */
  getPurchaseOrders(vendorId?: number, jobId?: number, status?: string, search?: string): Observable<PurchaseOrderListItem[]> {
    return this.getPurchaseOrdersPaged({
      vendorId, jobId, status, q: search, pageSize: 200,
    }).pipe(map(p => p.items));
  }

  /**
   * Phase 3 F7-broad / WU-22 — paged PO list. Returns the standard envelope
   * ({ items, totalCount, page, pageSize }) so the caller can wire up real
   * server-side pagination, sort, and filtering.
   */
  getPurchaseOrdersPaged(query: PurchaseOrderListPagedQuery = {}): Observable<PagedResponse<PurchaseOrderListItem>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.pageSize != null) params = params.set('pageSize', String(query.pageSize));
    if (query.sort) params = params.set('sort', query.sort);
    if (query.order) params = params.set('order', query.order);
    if (query.q) params = params.set('q', query.q);
    if (query.vendorId) params = params.set('vendorId', String(query.vendorId));
    if (query.jobId) params = params.set('jobId', String(query.jobId));
    if (query.status) params = params.set('status', query.status);
    if (query.dateFrom) params = params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params = params.set('dateTo', query.dateTo);
    return this.http.get<PagedResponse<PurchaseOrderListItem>>(this.base, { params });
  }

  getPurchaseOrderById(id: number): Observable<PurchaseOrderDetail> {
    return this.http.get<PurchaseOrderDetail>(`${this.base}/${id}`);
  }

  createPurchaseOrder(request: CreatePurchaseOrderRequest): Observable<PurchaseOrderDetail> {
    return this.http.post<PurchaseOrderDetail>(this.base, request);
  }

  updatePurchaseOrder(id: number, request: UpdatePurchaseOrderRequest): Observable<void> {
    return this.http.put<void>(`${this.base}/${id}`, request);
  }

  submitPurchaseOrder(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/submit`, {});
  }

  acknowledgePurchaseOrder(id: number, expectedDeliveryDate?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/acknowledge`, { expectedDeliveryDate });
  }

  receiveItems(id: number, request: ReceiveItemsRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/receive`, request);
  }

  cancelPurchaseOrder(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/cancel`, {});
  }

  closePurchaseOrder(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/close`, {});
  }

  // Phase 3 / WU-14 / H3 — short-close a partially-received PO with required reason.
  shortClosePurchaseOrder(id: number, reason: string): Observable<PurchaseOrderDetail> {
    return this.http.post<PurchaseOrderDetail>(`${this.base}/${id}/short-close`, { reason });
  }

  deletePurchaseOrder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  // ── Blanket PO Releases ──

  getReleases(poId: number): Observable<PurchaseOrderRelease[]> {
    return this.http.get<PurchaseOrderRelease[]>(`${this.base}/${poId}/releases`);
  }

  createRelease(poId: number, request: CreatePurchaseOrderReleaseRequest): Observable<PurchaseOrderRelease> {
    return this.http.post<PurchaseOrderRelease>(`${this.base}/${poId}/releases`, request);
  }

  updateRelease(poId: number, releaseNum: number, request: UpdatePurchaseOrderReleaseRequest): Observable<void> {
    return this.http.patch<void>(`${this.base}/${poId}/releases/${releaseNum}`, request);
  }

  // ── Auto-PO ──

  getAutoPoSuggestions(status?: string): Observable<AutoPoSuggestion[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<AutoPoSuggestion[]>(`${this.autoPoBase}/suggestions`, { params });
  }

  convertSuggestion(id: number): Observable<number> {
    return this.http.post<number>(`${this.autoPoBase}/suggestions/${id}/convert`, {});
  }

  dismissSuggestion(id: number): Observable<void> {
    return this.http.post<void>(`${this.autoPoBase}/suggestions/${id}/dismiss`, {});
  }

  bulkConvertSuggestions(ids: number[]): Observable<number[]> {
    return this.http.post<number[]>(`${this.autoPoBase}/suggestions/bulk-convert`, ids);
  }

  triggerAutoPoRun(): Observable<void> {
    return this.http.post<void>(`${this.autoPoBase}/run`, {});
  }

  getAutoPoSettings(): Observable<AutoPoSettings> {
    return this.http.get<AutoPoSettings>(`${this.autoPoBase}/settings`);
  }

  updateAutoPoSettings(settings: UpdateAutoPoSettingsRequest): Observable<AutoPoSettings> {
    return this.http.patch<AutoPoSettings>(`${this.autoPoBase}/settings`, settings);
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { PagedResponse, PagedQuery } from '../../../shared/models/paged-response.model';
import { PartListItem } from '../models/part-list-item.model';
import { PartDetail } from '../models/part-detail.model';
import { CreatePartRequest } from '../models/create-part-request.model';
import { UpdatePartRequest } from '../models/update-part-request.model';
import { CreateBOMEntryRequest } from '../models/create-bom-entry-request.model';
import { UpdateBOMEntryRequest } from '../models/update-bom-entry-request.model';
import { PartStatus } from '../models/part-status.type';
import { ProcurementSource } from '../models/procurement-source.type';
import { InventoryClass } from '../models/inventory-class.type';
import { PartRevision } from '../models/part-revision.model';
import { CreatePartRevisionRequest } from '../models/create-part-revision-request.model';
import { PartInventorySummary } from '../models/part-inventory-summary.model';
import { PartPurchaseHistoryItem } from '../models/part-purchase-history-item.model';
import { FileAttachment } from '../../../shared/models/file.model';
import { ActivityItem } from '../../../shared/models/activity.model';
import { Operation, OperationMaterial } from '../models/operation.model';
import { CreateOperationRequest } from '../models/create-operation-request.model';
import { UpdateOperationRequest } from '../models/update-operation-request.model';
import { CreateOperationMaterialRequest } from '../models/create-operation-material-request.model';
import { AddPartPriceRequest, PartPrice } from '../models/part-price.model';
import { PartAlternate, CreatePartAlternateRequest, UpdatePartAlternateRequest } from '../models/part-alternate.model';
import { BomRevisionSummary, BomRevisionDetail } from '../models/bom-revision.model';

/** Phase 3 F7-partial / WU-17 — paged part list query parameters. */
export interface PartListPagedQuery extends PagedQuery {
  status?: PartStatus;
  isActive?: boolean | null;
  /** Pillar 1 axis filter — Make / Buy / Subcontract / Phantom. */
  procurementSource?: ProcurementSource;
  /** Pillar 1 axis filter — Raw / Component / Subassembly / FinishedGood / Consumable / Tool. */
  inventoryClass?: InventoryClass;
  defaultVendorId?: number;
}

@Injectable({ providedIn: 'root' })
export class PartsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/parts`;

  /**
   * Phase 3 F7-partial / WU-17 — backward-compat shim. Calls the paged
   * endpoint and unwraps the envelope so existing callers that just want
   * the flat array keep working. New callers should use {@link getPartsPaged}
   * to read `totalCount` for true server-side pagination.
   *
   * Default page size is 200 (the server cap); the data-table component
   * handles client-side sort/filter/page within that slice. Lists exceeding
   * 200 parts need a follow-up to switch to server-side pagination.
   */
  getParts(status?: PartStatus, search?: string): Observable<PartListItem[]> {
    return this.getPartsPaged({
      status,
      q: search,
      pageSize: 200,
    }).pipe(map(p => p.items));
  }

  /**
   * Phase 3 F7-partial / WU-17 — paged part list. Returns the standard
   * envelope ({ items, totalCount, page, pageSize }) so callers can wire
   * up real server-side pagination, sort, and filtering.
   */
  getPartsPaged(query: PartListPagedQuery = {}): Observable<PagedResponse<PartListItem>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.pageSize != null) params = params.set('pageSize', String(query.pageSize));
    if (query.sort) params = params.set('sort', query.sort);
    if (query.order) params = params.set('order', query.order);
    if (query.q) params = params.set('q', query.q);
    if (query.status) params = params.set('status', query.status);
    if (query.isActive !== undefined && query.isActive !== null) params = params.set('isActive', String(query.isActive));
    if (query.procurementSource) params = params.set('procurementSource', query.procurementSource);
    if (query.inventoryClass) params = params.set('inventoryClass', query.inventoryClass);
    if (query.defaultVendorId != null) params = params.set('defaultVendorId', String(query.defaultVendorId));
    if (query.dateFrom) params = params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params = params.set('dateTo', query.dateTo);
    return this.http.get<PagedResponse<PartListItem>>(this.base, { params });
  }

  getPartById(id: number): Observable<PartDetail> {
    return this.http.get<PartDetail>(`${this.base}/${id}`);
  }

  createPart(request: CreatePartRequest): Observable<PartDetail> {
    return this.http.post<PartDetail>(this.base, request);
  }

  updatePart(id: number, request: UpdatePartRequest): Observable<PartDetail> {
    return this.http.patch<PartDetail>(`${this.base}/${id}`, request);
  }

  createBOMEntry(partId: number, request: CreateBOMEntryRequest): Observable<PartDetail> {
    return this.http.post<PartDetail>(`${this.base}/${partId}/bom`, request);
  }

  updateBOMEntry(partId: number, bomEntryId: number, request: UpdateBOMEntryRequest): Observable<PartDetail> {
    return this.http.patch<PartDetail>(`${this.base}/${partId}/bom/${bomEntryId}`, request);
  }

  deleteBOMEntry(partId: number, bomEntryId: number): Observable<PartDetail> {
    return this.http.delete<PartDetail>(`${this.base}/${partId}/bom/${bomEntryId}`);
  }

  deletePart(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  getRevisions(partId: number): Observable<PartRevision[]> {
    return this.http.get<PartRevision[]>(`${this.base}/${partId}/revisions`);
  }

  createRevision(partId: number, request: CreatePartRevisionRequest): Observable<PartRevision> {
    return this.http.post<PartRevision>(`${this.base}/${partId}/revisions`, request);
  }

  getFilesByRevision(partId: number, revisionId: number): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${environment.apiUrl}/parts/${partId}/revisions/${revisionId}/files`);
  }

  getPartFiles(partId: number): Observable<FileAttachment[]> {
    return this.http.get<FileAttachment[]>(`${environment.apiUrl}/parts/${partId}/files`);
  }

  getPartInventorySummary(partId: number): Observable<PartInventorySummary> {
    return this.http.get<PartInventorySummary>(`${this.base}/${partId}/inventory-summary`);
  }

  /**
   * Backward-from-part PO history. Server caps the result at 50 rows;
   * pass an optional `search` term to filter by PO #, vendor, or line
   * description before the cap is applied.
   */
  getPurchaseHistory(partId: number, search?: string): Observable<PartPurchaseHistoryItem[]> {
    const url = `${this.base}/${partId}/purchase-history`;
    const params = search?.trim() ? new HttpParams().set('search', search.trim()) : undefined;
    return this.http.get<PartPurchaseHistoryItem[]>(url, params ? { params } : {});
  }

  linkAccountingItem(partId: number, externalId: string, externalRef: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${partId}/link-accounting-item`, { externalId, externalRef });
  }

  unlinkAccountingItem(partId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${partId}/link-accounting-item`);
  }

  getOperations(partId: number): Observable<Operation[]> {
    return this.http.get<Operation[]>(`${this.base}/${partId}/operations`);
  }

  createOperation(partId: number, request: CreateOperationRequest): Observable<Operation> {
    return this.http.post<Operation>(`${this.base}/${partId}/operations`, request);
  }

  updateOperation(partId: number, operationId: number, request: UpdateOperationRequest): Observable<Operation> {
    return this.http.patch<Operation>(`${this.base}/${partId}/operations/${operationId}`, request);
  }

  deleteOperation(partId: number, operationId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${partId}/operations/${operationId}`);
  }

  createOperationMaterial(partId: number, operationId: number, request: CreateOperationMaterialRequest): Observable<OperationMaterial> {
    return this.http.post<OperationMaterial>(`${this.base}/${partId}/operations/${operationId}/materials`, request);
  }

  deleteOperationMaterial(partId: number, operationId: number, materialId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${partId}/operations/${operationId}/materials/${materialId}`);
  }

  getOperationFiles(partId: number, operationId: number): Observable<FileAttachment[]> {
    return this.http.get<FileAttachment[]>(`${environment.apiUrl}/operations/${operationId}/files`);
  }

  deleteOperationFile(fileId: number): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/files/${fileId}`);
  }

  getOperationActivity(partId: number, operationId: number): Observable<ActivityItem[]> {
    return this.http.get<ActivityItem[]>(`${this.base}/${partId}/operations/${operationId}/activity`);
  }

  addOperationComment(partId: number, operationId: number, comment: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${partId}/operations/${operationId}/activity`, { comment });
  }

  getFileDownloadUrl(fileId: number): string {
    return `${environment.apiUrl}/files/${fileId}/download`;
  }

  getPartThumbnails(partIds: number[]): Observable<{ partId: number; thumbnailUrl: string | null }[]> {
    if (partIds.length === 0) return of([]);
    let params = new HttpParams();
    for (const id of partIds) {
      params = params.append('partIds', String(id));
    }
    return this.http.get<{ partId: number; thumbnailUrl: string | null }[]>(`${this.base}/thumbnails`, { params });
  }

  /**
   * Returns the chronological history of effective-dated PartPrice rows for
   * the part — current open row first, then closed rows in EffectiveFrom
   * DESC order. Powers the Pricing tab's history table on Part detail.
   */
  getPartPriceHistory(partId: number): Observable<PartPrice[]> {
    return this.http.get<PartPrice[]>(`${this.base}/${partId}/prices`);
  }

  /**
   * Posts a new effective-dated PartPrice row. The server closes out any
   * prior open row by setting its EffectiveTo to this row's EffectiveFrom.
   */
  addPartPrice(partId: number, request: AddPartPriceRequest): Observable<PartPrice> {
    return this.http.post<PartPrice>(`${this.base}/${partId}/prices`, request);
  }

  /**
   * Removes a PartPrice history row. Pre-beta the server hard-deletes (no
   * soft-delete column) — once history is committed, prefer leaving rows
   * intact for audit. UI exposes this only on the most-recent open row.
   */
  deletePartPrice(partId: number, priceId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${partId}/prices/${priceId}`);
  }

  getPartAlternates(partId: number): Observable<PartAlternate[]> {
    return this.http.get<PartAlternate[]>(`${this.base}/${partId}/alternates`);
  }

  createPartAlternate(partId: number, request: CreatePartAlternateRequest): Observable<PartAlternate> {
    return this.http.post<PartAlternate>(`${this.base}/${partId}/alternates`, request);
  }

  updatePartAlternate(partId: number, alternateId: number, request: UpdatePartAlternateRequest): Observable<PartAlternate> {
    return this.http.patch<PartAlternate>(`${this.base}/${partId}/alternates/${alternateId}`, request);
  }

  deletePartAlternate(partId: number, alternateId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${partId}/alternates/${alternateId}`);
  }

  /** Phase 3 H4 / WU-20 — list BOM revisions for a part (newest first). */
  getBomRevisions(partId: number): Observable<BomRevisionSummary[]> {
    return this.http.get<BomRevisionSummary[]>(`${this.base}/${partId}/bom/revisions`);
  }

  /** Phase 3 H4 / WU-20 — read one immutable BOM revision in detail. */
  getBomRevisionById(partId: number, revisionId: number): Observable<BomRevisionDetail> {
    return this.http.get<BomRevisionDetail>(`${this.base}/${partId}/bom/revisions/${revisionId}`);
  }
}

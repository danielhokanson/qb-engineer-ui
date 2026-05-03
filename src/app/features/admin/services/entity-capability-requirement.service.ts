import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  EntityCapabilityRequirementResponseModel,
  UpsertEntityCapabilityRequirementRequestModel,
} from '../models/entity-capability-requirement.model';

/**
 * Admin CRUD client for entity-capability-requirement rows. Backs the
 * `/admin/entity-completeness` admin page; the rows it manages drive the
 * `EntityCompletenessService` evaluation server-side. Catalog ships empty —
 * Dan authors rules in this UI.
 *
 * All endpoints are admin-only (`[Authorize(Roles = "Admin")]` server-side).
 */
@Injectable({ providedIn: 'root' })
export class EntityCapabilityRequirementService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/admin/entity-capability-requirements`;

  list(
    entityType?: string,
    capabilityCode?: string,
  ): Observable<EntityCapabilityRequirementResponseModel[]> {
    let params = new HttpParams();
    if (entityType) params = params.set('entityType', entityType);
    if (capabilityCode) params = params.set('capabilityCode', capabilityCode);
    return this.http.get<EntityCapabilityRequirementResponseModel[]>(this.baseUrl, { params });
  }

  get(id: number): Observable<EntityCapabilityRequirementResponseModel> {
    return this.http.get<EntityCapabilityRequirementResponseModel>(`${this.baseUrl}/${id}`);
  }

  create(
    body: UpsertEntityCapabilityRequirementRequestModel,
  ): Observable<EntityCapabilityRequirementResponseModel> {
    return this.http.post<EntityCapabilityRequirementResponseModel>(this.baseUrl, body);
  }

  update(
    id: number,
    body: UpsertEntityCapabilityRequirementRequestModel,
  ): Observable<EntityCapabilityRequirementResponseModel> {
    return this.http.put<EntityCapabilityRequirementResponseModel>(`${this.baseUrl}/${id}`, body);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}

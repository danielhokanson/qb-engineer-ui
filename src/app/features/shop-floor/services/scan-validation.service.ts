import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';

export interface ScanValidation {
  action: ScanActionType;
  allowed: boolean;
  reason?: string;
}

export type ScanActionType = 'move' | 'count' | 'receive' | 'ship' | 'inspect' | 'issue' | 'return';

@Injectable({ providedIn: 'root' })
export class ScanValidationService {
  private readonly http = inject(HttpClient);
  private readonly inventoryBase = `${environment.apiUrl}/inventory`;
  private readonly shopFloorBase = `${environment.apiUrl}/display/shop-floor`;

  validatePartActions(partId: number): Observable<ScanValidation[]> {
    return this.http.get<ScanValidation[]>(
      `${this.inventoryBase}/scan-validations/${partId}`,
    );
  }

  validateJobActions(jobId: number): Observable<ScanValidation[]> {
    return this.http.get<ScanValidation[]>(
      `${this.shopFloorBase}/job-validations/${jobId}`,
    );
  }

  getAvailableActions(validations: ScanValidation[]): ScanValidation[] {
    return validations.filter(v => v.allowed);
  }

  getBlockedActions(validations: ScanValidation[]): ScanValidation[] {
    return validations.filter(v => !v.allowed);
  }
}

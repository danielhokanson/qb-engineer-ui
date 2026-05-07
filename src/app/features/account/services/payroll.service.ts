import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { PayStub, TaxDocument } from '../models/payroll.model';

@Injectable({ providedIn: 'root' })
export class PayrollService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/payroll`;

  private readonly _payStubs = signal<PayStub[]>([]);
  private readonly _taxDocuments = signal<TaxDocument[]>([]);

  readonly payStubs = this._payStubs.asReadonly();
  readonly taxDocuments = this._taxDocuments.asReadonly();

  loadMyPayStubs(): void {
    this.http.get<PayStub[]>(`${this.base}/pay-stubs/me`).subscribe(
      data => this._payStubs.set(data),
    );
  }

  loadMyTaxDocuments(): void {
    this.http.get<TaxDocument[]>(`${this.base}/tax-documents/me`).subscribe(
      data => this._taxDocuments.set(data),
    );
  }

  downloadPayStubPdf(id: number): void {
    window.open(`${this.base}/pay-stubs/${id}/pdf`, '_blank');
  }

  downloadTaxDocumentPdf(id: number): void {
    window.open(`${this.base}/tax-documents/${id}/pdf`, '_blank');
  }

  // Admin/OM methods
  getUserPayStubs(userId: number): Observable<PayStub[]> {
    return this.http.get<PayStub[]>(`${this.base}/pay-stubs/users/${userId}`);
  }

  getUserTaxDocuments(userId: number): Observable<TaxDocument[]> {
    return this.http.get<TaxDocument[]>(`${this.base}/tax-documents/users/${userId}`);
  }

  uploadPayStub(userId: number, request: { payPeriodStart: string; payPeriodEnd: string; payDate: string; grossPay: number; netPay: number; fileAttachmentId: number }): Observable<PayStub> {
    return this.http.post<PayStub>(`${this.base}/pay-stubs/users/${userId}`, request);
  }

  uploadTaxDocument(userId: number, request: { documentType: string; taxYear: number; fileAttachmentId: number }): Observable<TaxDocument> {
    return this.http.post<TaxDocument>(`${this.base}/tax-documents/users/${userId}`, request);
  }

  deletePayStub(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/pay-stubs/${id}`);
  }

  deleteTaxDocument(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/tax-documents/${id}`);
  }

  syncPayroll(): Observable<void> {
    return this.http.post<void>(`${this.base}/sync`, {});
  }
}

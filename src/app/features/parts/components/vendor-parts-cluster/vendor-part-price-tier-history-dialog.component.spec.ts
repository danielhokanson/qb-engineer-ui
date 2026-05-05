import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';

import {
  VendorPartPriceTierHistoryDialogComponent,
  VendorPartPriceTierHistoryDialogData,
} from './vendor-part-price-tier-history-dialog.component';
import { VendorPart, VendorPartPriceTier } from '../../models/vendor-part.model';
import { VendorPartsService } from '../../services/vendor-parts.service';

class FakeLoader implements TranslateLoader {
  getTranslation(): Observable<Record<string, string>> { return of({}); }
}

function makeVendorPart(overrides: Partial<VendorPart> = {}): VendorPart {
  return {
    id: 42, vendorId: 1, vendorCompanyName: 'Acme', partId: 7,
    partNumber: 'PRT', partName: 'Widget',
    vendorPartNumber: null, manufacturerName: null, vendorMpn: null,
    leadTimeDays: 14, minOrderQty: 1, packSize: null,
    countryOfOrigin: null, htsCode: null,
    isApproved: true, isPreferred: true,
    certifications: null, lastQuotedDate: null, notes: null,
    priceTiers: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    currency: 'USD',
    ...overrides,
  };
}

function makeTier(overrides: Partial<VendorPartPriceTier> = {}): VendorPartPriceTier {
  return {
    id: 1, vendorPartId: 42, minQuantity: 1, unitPrice: 5, currency: 'USD',
    effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveTo: null,
    notes: null,
    ...overrides,
  };
}

describe('VendorPartPriceTierHistoryDialogComponent', () => {
  let vendorPartsService: { getPriceTierHistory: ReturnType<typeof vi.fn> };

  function setup(data: VendorPartPriceTierHistoryDialogData) {
    const dialogRef = { close: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideAnimations(),
        provideTranslateService({ loader: { provide: TranslateLoader, useClass: FakeLoader } }),
        { provide: VendorPartsService, useValue: vendorPartsService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    // Construct imperatively (template renders shared components whose
    // required inputs are brittle in this Vitest harness — see
    // vendor-part-form-dialog.component.spec.ts for the same pattern).
    const component = TestBed.runInInjectionContext(() => new VendorPartPriceTierHistoryDialogComponent());
    return { component, dialogRef };
  }

  beforeEach(() => {
    vendorPartsService = {
      getPriceTierHistory: vi.fn().mockReturnValue(of([])),
    };
  });

  it('opens with the vendor-part id and calls getPriceTierHistory', () => {
    const vp = makeVendorPart();
    vendorPartsService.getPriceTierHistory.mockReturnValue(of([makeTier({ id: 1 }), makeTier({ id: 2 })]));
    const { component } = setup({ vendorPart: vp });

    component.ngOnInit();

    expect(vendorPartsService.getPriceTierHistory).toHaveBeenCalledWith(42);
    const c = component as unknown as { tiers: () => VendorPartPriceTier[] };
    expect(c.tiers()).toHaveLength(2);
  });

  it('renders the empty state when history is empty', () => {
    const vp = makeVendorPart();
    vendorPartsService.getPriceTierHistory.mockReturnValue(of([]));
    const { component } = setup({ vendorPart: vp });

    component.ngOnInit();

    const c = component as unknown as { tiers: () => VendorPartPriceTier[] };
    expect(c.tiers()).toEqual([]);
  });
});

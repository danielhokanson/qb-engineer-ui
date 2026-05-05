import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { provideAnimations } from '@angular/platform-browser/animations';

import { mockSignalInputs } from '../../../../../testing/signal-input-harness';
import { VendorPartListPanelComponent } from './vendor-part-list-panel.component';
import { VendorPart } from '../../models/vendor-part.model';

class FakeLoader implements TranslateLoader {
  getTranslation(): Observable<Record<string, string>> { return of({}); }
}

function makeVendorPart(overrides: Partial<VendorPart> = {}): VendorPart {
  return {
    id: 1, vendorId: 10, vendorCompanyName: 'Acme Co.',
    partId: 100, partNumber: 'PRT-100', partName: 'Widget',
    vendorPartNumber: 'V-100', manufacturerName: null, vendorMpn: null,
    leadTimeDays: 14, minOrderQty: 100, packSize: 25,
    countryOfOrigin: 'US', htsCode: null,
    isApproved: true, isPreferred: false, certifications: null,
    lastQuotedDate: null, notes: null,
    priceTiers: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    currency: 'USD',
    ...overrides,
  };
}

describe('VendorPartListPanelComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VendorPartListPanelComponent],
      providers: [
        provideHttpClient(),
        provideAnimations(),
        provideTranslateService({ loader: { provide: TranslateLoader, useClass: FakeLoader } }),
      ],
    });
  });

  it('exposes mode-specific empty-state copy keys for the sources mode', () => {
    const component = TestBed.runInInjectionContext(() => new VendorPartListPanelComponent());
    mockSignalInputs(component, {
      mode: 'sources',
      parentEntityType: 'part',
      parentEntityId: 42,
      vendorParts: [] as VendorPart[],
      loading: false,
    });
    const c = component as unknown as {
      tableId(): string;
      emptyIcon(): string;
      emptyMessageKey(): string;
      addLabelKey(): string;
    };
    expect(c.tableId()).toBe('part-vendor-sources');
    expect(c.emptyIcon()).toBe('store');
    expect(c.emptyMessageKey()).toBe('parts.detail.sourcesEmpty');
    expect(c.addLabelKey()).toBe('parts.detail.addVendorSource');
  });

  it('returns the lowest tier price across the priceTiers array', () => {
    const component = TestBed.runInInjectionContext(() => new VendorPartListPanelComponent());
    mockSignalInputs(component, {
      mode: 'sources',
      parentEntityType: 'part',
      parentEntityId: 42,
      vendorParts: [] as VendorPart[],
      loading: false,
    });
    const noTier = makeVendorPart({ priceTiers: [] });
    const withTiers = makeVendorPart({
      priceTiers: [
        { id: 1, vendorPartId: 1, minQuantity: 1, unitPrice: 10, currency: 'USD', effectiveFrom: '2026-01-01', effectiveTo: null, notes: null },
        { id: 2, vendorPartId: 1, minQuantity: 50, unitPrice: 8.5, currency: 'USD', effectiveFrom: '2026-01-01', effectiveTo: null, notes: null },
        { id: 3, vendorPartId: 1, minQuantity: 100, unitPrice: 9, currency: 'USD', effectiveFrom: '2026-01-01', effectiveTo: null, notes: null },
      ],
    });
    expect(component.getLowestTier(noTier)).toBeNull();
    expect(component.getLowestTier(withTiers)).toEqual({ price: 8.5, currency: 'USD' });
  });

  it('emits togglePreferred output when onTogglePreferred is invoked', () => {
    const component = TestBed.runInInjectionContext(() => new VendorPartListPanelComponent());
    mockSignalInputs(component, {
      mode: 'sources',
      parentEntityType: 'part',
      parentEntityId: 42,
      vendorParts: [] as VendorPart[],
      loading: false,
    });
    const cb = vi.fn();
    component.togglePreferred.subscribe(cb);
    const row = makeVendorPart({ id: 99, isPreferred: false });
    const c = component as unknown as { onTogglePreferred(r: VendorPart): void };
    c.onTogglePreferred(row);
    expect(cb).toHaveBeenCalledWith(row);
  });
});

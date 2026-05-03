import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { mockSignalInputs } from '../../../../../testing/signal-input-harness';
import { PartShippingStepComponent } from './part-shipping-step.component';

class FakeLoader implements TranslateLoader {
  getTranslation(): Observable<Record<string, string>> { return of({}); }
}

function buildPart(overrides: Partial<PartDetail> = {}): PartDetail {
  return {
    id: 42, partNumber: 'PRT-00042', name: 'Widget', description: null, revision: 'A',
    status: 'Draft',
    procurementSource: 'Buy', inventoryClass: 'Component', itemKindId: null, itemKindLabel: null,
    traceabilityType: 'None', abcClass: null, 
    materialSpecId: null, materialSpecLabel: null,
    externalId: null, externalRef: null,
    provider: null, preferredVendorId: null, preferredVendorName: null,
    minStockThreshold: null, reorderPoint: null, reorderQuantity: null,
    safetyStockDays: null,
    toolingAssetId: null, toolingAssetName: null,
    manualCostOverride: null, currentCostCalculationId: null,
    weightEach: null, weightDisplayUnit: null,
    lengthMm: null, widthMm: null, heightMm: null, dimensionDisplayUnit: null,
    volumeMl: null, volumeDisplayUnit: null,
    valuationClassId: null, valuationClassLabel: null,
    htsCode: null, hazmatClass: null, shelfLifeDays: null,
    backflushPolicy: null, isKit: false, isConfigurable: false,
    defaultBinId: null, sourcePartId: null,
    isMrpPlanned: false, lotSizingRule: null,
    fixedOrderQuantity: null, minimumOrderQuantity: null, orderMultiple: null,
    planningFenceDays: null, demandFenceDays: null,
    stockUomId: null, stockUomCode: null, stockUomLabel: null,
    purchaseUomId: null, purchaseUomCode: null, purchaseUomLabel: null,
    salesUomId: null, salesUomCode: null, salesUomLabel: null,
    requiresReceivingInspection: false, receivingInspectionTemplateId: null,
    inspectionFrequency: null, inspectionSkipAfterN: null,
    bomEntries: [], usedIn: [],
    createdAt: new Date(), updatedAt: new Date(),
    effectivePrice: 0, effectivePriceCurrency: 'USD', effectivePriceSource: 'Default',
    ...overrides,
  };
}

describe('PartShippingStepComponent (Phase 5 — save-on-Continue)', () => {
  let httpMock: HttpTestingController;
  let workflowService: WorkflowService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartShippingStepComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: { provide: TranslateLoader, useClass: FakeLoader } }),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    workflowService = TestBed.inject(WorkflowService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders without errors when entity is null', () => {
    const component = TestBed.runInInjectionContext(() => new PartShippingStepComponent());
    mockSignalInputs(component, {
      stepId: 'shipping', componentName: 'PartShippingStepComponent',
      runId: null, entityId: null, entity: null,
    });
    TestBed.flushEffects();
    expect(component).toBeTruthy();
  });

  it('PATCHes /workflows/:runId/step when WorkflowService.saveCurrentStep() fires after a user edit, converting to canonical SI', () => {
    const component = TestBed.runInInjectionContext(() => new PartShippingStepComponent());
    mockSignalInputs(component, {
      stepId: 'shipping', componentName: 'PartShippingStepComponent',
      runId: 7, entityId: 42, entity: buildPart(),
    });
    TestBed.flushEffects();

    const form = (component as unknown as { form: { patchValue(v: unknown): void; markAsDirty(): void } }).form;
    form.patchValue({ weight: 2, weightDisplayUnit: 'kg' });
    form.markAsDirty();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    const req = httpMock.expectOne(`${environment.apiUrl}/workflows/7/step`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.stepId).toBe('shipping');
    // 2 kg = 2000 g
    expect(req.request.body.fields.weightEach).toBe(2000);
    expect(req.request.body.fields.weightDisplayUnit).toBe('kg');
    req.flush({
      id: 7, entityType: 'Part', entityId: 42, definitionId: 'd', currentStepId: 'shipping',
      mode: 'guided', startedAt: '', startedByUserId: 1, completedAt: null,
      abandonedAt: null, abandonedReason: null, lastActivityAt: '', version: 1,
    });
    const partReq = httpMock.expectOne(`${environment.apiUrl}/parts/42`);
    partReq.flush(buildPart({ weightEach: 2000, weightDisplayUnit: 'kg' }));

    expect(saveResult).toEqual({ ok: true });
  });

  it('does NOT round-trip when the form is pristine — Back/Jump on a never-touched step is a no-op', () => {
    const component = TestBed.runInInjectionContext(() => new PartShippingStepComponent());
    mockSignalInputs(component, {
      stepId: 'shipping', componentName: 'PartShippingStepComponent',
      runId: 7, entityId: 42, entity: buildPart(),
    });
    TestBed.flushEffects();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    httpMock.verify();
    expect(saveResult).toEqual({ ok: true });
  });
});

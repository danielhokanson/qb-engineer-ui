import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { mockSignalInputs } from '../../../../../testing/signal-input-harness';
import { PartCostingStepComponent } from './part-costing-step.component';

class FakeLoader implements TranslateLoader {
  getTranslation(): Observable<Record<string, string>> { return of({}); }
}

function buildPart(overrides: Partial<PartDetail> = {}): PartDetail {
  return {
    id: 42, partNumber: 'PRT-00042', name: 'Widget', description: null, revision: 'A',
    status: 'Draft',
    procurementSource: 'Make', inventoryClass: 'Subassembly', itemKindId: null, itemKindLabel: null,
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

describe('PartCostingStepComponent (Phase 5 — save-on-Continue)', () => {
  let httpMock: HttpTestingController;
  let workflowService: WorkflowService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartCostingStepComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: { provide: TranslateLoader, useClass: FakeLoader } }),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    workflowService = TestBed.inject(WorkflowService);
  });

  afterEach(() => httpMock.verify());

  it('hydrates manualCostOverride from the entity', () => {
    const component = TestBed.runInInjectionContext(() => new PartCostingStepComponent());
    mockSignalInputs(component, {
      stepId: 'costing', componentName: 'PartCostingStepComponent',
      entityId: 42, entity: buildPart({ manualCostOverride: 12.5 }),
    });
    TestBed.flushEffects();
    const form = (component as unknown as { form: { value: { manualCostOverride: number | null } } }).form;
    expect(form.value.manualCostOverride).toBe(12.5);
  });

  it('only enables Tier 1 (flat) — Tier 2/3 setMode is rejected', () => {
    const component = TestBed.runInInjectionContext(() => new PartCostingStepComponent());
    mockSignalInputs(component, {
      stepId: 'costing', componentName: 'PartCostingStepComponent',
      entityId: 42, entity: buildPart(),
    });
    const c = component as unknown as {
      mode(): 'flat' | 'departmental' | 'abc';
      setMode(m: 'flat' | 'departmental' | 'abc'): void;
    };
    expect(c.mode()).toBe('flat');
    c.setMode('departmental');
    expect(c.mode()).toBe('flat'); // rejected
    c.setMode('abc');
    expect(c.mode()).toBe('flat'); // rejected
  });

  it('PATCHes /parts/:entityId with manualCostOverride when WorkflowService.saveCurrentStep() fires after a user edit', () => {
    const component = TestBed.runInInjectionContext(() => new PartCostingStepComponent());
    mockSignalInputs(component, {
      stepId: 'costing', componentName: 'PartCostingStepComponent',
      entityId: 42, entity: buildPart(),
    });
    TestBed.flushEffects();

    const form = (component as unknown as { form: { patchValue(v: unknown): void; markAsDirty(): void } }).form;
    form.patchValue({ manualCostOverride: 99 });
    form.markAsDirty();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    const req = httpMock.expectOne(`${environment.apiUrl}/parts/42`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.manualCostOverride).toBe(99);
    req.flush(buildPart({ manualCostOverride: 99 }));

    expect(saveResult).toEqual({ ok: true });
  });

  it('clearing manual override sends -1 sentinel', () => {
    const component = TestBed.runInInjectionContext(() => new PartCostingStepComponent());
    mockSignalInputs(component, {
      stepId: 'costing', componentName: 'PartCostingStepComponent',
      entityId: 42, entity: buildPart({ manualCostOverride: 12 }),
    });
    TestBed.flushEffects();

    const form = (component as unknown as { form: { patchValue(v: unknown): void; markAsDirty(): void } }).form;
    form.patchValue({ manualCostOverride: null });
    form.markAsDirty();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    const req = httpMock.expectOne(`${environment.apiUrl}/parts/42`);
    expect(req.request.body.manualCostOverride).toBe(-1);
    req.flush(buildPart({ manualCostOverride: null }));

    expect(saveResult).toEqual({ ok: true });
  });

  it('does NOT round-trip when the form is pristine — Back/Jump on a never-touched step is a no-op', () => {
    const component = TestBed.runInInjectionContext(() => new PartCostingStepComponent());
    mockSignalInputs(component, {
      stepId: 'costing', componentName: 'PartCostingStepComponent',
      entityId: 42, entity: buildPart(),
    });
    TestBed.flushEffects();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    httpMock.verify();
    expect(saveResult).toEqual({ ok: true });
  });
});

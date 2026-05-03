import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { mockSignalInputs } from '../../../../../testing/signal-input-harness';
import { PartBasicsStepComponent } from './part-basics-step.component';

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

describe('PartBasicsStepComponent (Phase 5 — save-on-Continue)', () => {
  let httpMock: HttpTestingController;
  let workflowService: WorkflowService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PartBasicsStepComponent],
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

  it('hydrates the form from the entity input', () => {
    const component = TestBed.runInInjectionContext(() => new PartBasicsStepComponent());
    mockSignalInputs(component, {
      stepId: 'basics', componentName: 'PartBasicsStepComponent',
      runId: 7, entityId: 42, entity: buildPart({ name: 'Hydration', description: 'Hydration notes' }),
    });
    TestBed.flushEffects();
    const form = (component as unknown as { form: { value: unknown } }).form;
    expect(form.value).toMatchObject({
      name: 'Hydration',
      description: 'Hydration notes',
    });
  });

  it('PATCHes /workflows/:runId/step when WorkflowService.saveCurrentStep() fires after a user edit', () => {
    const component = TestBed.runInInjectionContext(() => new PartBasicsStepComponent());
    mockSignalInputs(component, {
      stepId: 'basics', componentName: 'PartBasicsStepComponent',
      runId: 7, entityId: 42, entity: buildPart({ name: 'Initial' }),
    });
    TestBed.flushEffects();

    const form = (component as unknown as { form: { patchValue(v: unknown): void; markAsDirty(): void } }).form;
    form.patchValue({ name: 'Updated name' });
    form.markAsDirty();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    const req = httpMock.expectOne(`${environment.apiUrl}/workflows/7/step`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.stepId).toBe('basics');
    expect(req.request.body.fields.name).toBe('Updated name');
    req.flush({
      id: 7, entityType: 'Part', entityId: 42, definitionId: 'd', currentStepId: 'basics',
      mode: 'guided', startedAt: '', startedByUserId: 1, completedAt: null,
      abandonedAt: null, abandonedReason: null, lastActivityAt: '', version: 1,
    });
    const partReq = httpMock.expectOne(`${environment.apiUrl}/parts/42`);
    partReq.flush(buildPart({ name: 'Updated name' }));

    expect(saveResult).toEqual({ ok: true });
  });

  it('does NOT round-trip when the form is pristine — Back/Jump on a never-touched step is a no-op', () => {
    const component = TestBed.runInInjectionContext(() => new PartBasicsStepComponent());
    mockSignalInputs(component, {
      stepId: 'basics', componentName: 'PartBasicsStepComponent',
      runId: 7, entityId: 42, entity: buildPart({ name: 'Initial' }),
    });
    TestBed.flushEffects();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    // No HTTP — pristine guard short-circuits. saveCurrentStep still resolves ok so navigation proceeds.
    httpMock.verify();
    expect(saveResult).toEqual({ ok: true });
  });

  it('skips the PATCH when runId is null (workflow not yet materialized)', () => {
    const component = TestBed.runInInjectionContext(() => new PartBasicsStepComponent());
    mockSignalInputs(component, {
      stepId: 'basics', componentName: 'PartBasicsStepComponent',
      runId: null, entityId: null, entity: null,
    });
    TestBed.flushEffects();

    const form = (component as unknown as { form: { patchValue(v: unknown): void; markAsDirty(): void } }).form;
    form.patchValue({ name: 'Whatever' });
    form.markAsDirty();

    let saveResult: { ok: boolean } | null = null;
    workflowService.saveCurrentStep().subscribe((r) => (saveResult = r));

    httpMock.verify();
    expect(saveResult).toEqual({ ok: true });
  });
});

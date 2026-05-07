import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, effect } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NgStyle } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { switchMap, startWith, map } from 'rxjs';

import {
  DynamicFormControlModel,
  DynamicFormModel,
  DynamicFormService,
} from '@danielhokanson/ng-dynamic-forms-core';

import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { DynamicQbFormControlComponent } from '../../../../shared/components/dynamic-form/dynamic-qb-form-control.component';
import {
  sectionsToModels,
  isValueControl,
} from '../../../../shared/components/dynamic-form/compliance-form-adapter';
import {
  ComplianceFormDefinition,
  FormFieldDefinition,
  FormSection,
  normalizeFormPages,
} from '../../../../shared/models/compliance-form-definition.model';

@Component({
  selector: 'app-compliance-form-renderer',
  standalone: true,
  imports: [
    NgStyle,
    ReactiveFormsModule,
    ValidationButtonComponent,
    DynamicQbFormControlComponent,
  ],
  templateUrl: './compliance-form-renderer.component.html',
  styleUrl: './compliance-form-renderer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComplianceFormRendererComponent {
  private readonly formService = inject(DynamicFormService);

  readonly definition = input.required<ComplianceFormDefinition>();
  readonly initialData = input<Record<string, unknown> | null>(null);
  readonly readonly = input(false);
  readonly saving = input(false);
  readonly submitting = input(false);
  readonly extraValidation = input<(() => string[]) | null>(null);

  readonly save = output<Record<string, unknown>>();
  readonly submitForm = output<Record<string, unknown>>();
  readonly back = output<void>();

  protected readonly form = signal<FormGroup>(new FormGroup({}));
  protected readonly dynamicModel = signal<DynamicFormModel>([]);
  protected readonly modelMap = signal<Map<string, DynamicFormControlModel>>(new Map());

  /** Whether this form uses government (IRS-style) layout */
  protected readonly isGovernmentLayout = computed(() => this.definition().formLayout === 'government');
  protected readonly formMaxWidth = computed(() => this.definition().maxWidth ?? null);

  /** CSS custom property overrides from PDF extraction metrics */
  protected readonly formStyleVars = computed(() => {
    const styles = this.definition().formStyles;
    if (!styles) return {};
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(styles)) {
      vars[`--${key}`] = value;
    }
    return vars;
  });

  /** Normalized pages — always populated regardless of definition format */
  protected readonly pages = computed(() => normalizeFormPages(this.definition()));
  protected readonly hasMultiplePages = computed(() => this.pages().length > 1);
  protected readonly activePageIndex = signal(0);
  protected readonly activePage = computed(() => this.pages()[this.activePageIndex()] ?? this.pages()[0]);

  /** Per-page model maps for rendering */
  protected readonly pageModelMaps = signal<Map<string, Map<string, DynamicFormControlModel>>>(new Map());

  // Bridge form status changes to a signal via toSignal — avoids NG0600
  private readonly _formViolations = toSignal(
    toObservable(this.form).pipe(
      switchMap(f => f.statusChanges.pipe(
        startWith(null),
        map(() => FormValidationService.collectViolations(f, this.buildFieldLabels())),
      )),
    ),
    { initialValue: [] },
  );

  // Track form validity as a signal via statusChanges so that submitDisabled
  // re-evaluates reactively (accessing form().invalid directly is not a signal
  // dependency — same FormGroup reference, only its internal state changes).
  private readonly _formValid = toSignal(
    toObservable(this.form).pipe(
      switchMap(f => f.statusChanges.pipe(
        startWith(null),
        map(() => f.valid),
      )),
    ),
    { initialValue: false },
  );

  protected readonly violations = computed(() => [
    ...this._formViolations(),
    ...(this.extraValidation()?.() ?? []),
  ]);

  protected readonly submitDisabled = computed(() =>
    !this._formValid() || this.submitting() || this.violations().length > 0,
  );

  /** Whether the current page has any interactive fields */
  protected readonly currentPageIsReadonly = computed(() => {
    const page = this.activePage();
    if (page?.readonly) return true;
    return page?.sections.every(s => s.fields.every(f => !isValueControl(f))) ?? true;
  });

  /** Whether we're on the last page (show submit on last page only) */
  protected readonly isLastPage = computed(() => this.activePageIndex() === this.pages().length - 1);
  protected readonly isFirstPage = computed(() => this.activePageIndex() === 0);

  constructor() {
    effect(() => {
      const def = this.definition();
      const data = this.initialData();
      if (!def) return;

      // Build models from ALL pages (single form group spans all pages)
      const pages = normalizeFormPages(def);
      const allSections = pages.flatMap(p => p.sections);
      const models = sectionsToModels(allSections, data);
      this.dynamicModel.set(models);

      // Build global model lookup map
      const map = new Map<string, DynamicFormControlModel>();
      for (const m of models) {
        map.set(m.id, m);
      }
      this.modelMap.set(map);

      // Build per-page model maps for rendering
      const pageMaps = new Map<string, Map<string, DynamicFormControlModel>>();
      for (const page of pages) {
        const pageModels = sectionsToModels(page.sections, data);
        const pageMap = new Map<string, DynamicFormControlModel>();
        for (const m of pageModels) {
          pageMap.set(m.id, m);
        }
        pageMaps.set(page.id, pageMap);
      }
      this.pageModelMaps.set(pageMaps);

      // Create form group from ALL models (single form spans all tabs)
      const fg = this.formService.createFormGroup(models);
      this.form.set(fg);

      // Reset to first page when definition changes
      this.activePageIndex.set(0);

      // Auto-set today's date for any signature-date field if not already populated
      const today = new Date().toISOString().split('T')[0];
      for (const page of normalizeFormPages(def)) {
        for (const section of page.sections) {
          for (const field of section.fields) {
            if (field.fieldLayout === 'signature-date' && fg.controls[field.id] && !data?.[field.id]) {
              fg.controls[field.id].setValue(today, { emitEvent: false });
            }
          }
        }
      }
    });
  }

  protected getModelForPage(fieldId: string, pageId: string): DynamicFormControlModel | null {
    return this.pageModelMaps().get(pageId)?.get(fieldId) ?? null;
  }

  protected shouldShowField(field: FormFieldDefinition): boolean {
    if (!field.dependsOn) return true;
    const dep = field.dependsOn;
    const control = this.form().controls[dep.field];
    if (!control) return true;
    const val = control.value;
    const op = dep.operator ?? 'eq';
    if (op === 'truthy') return !!val;
    if (op === 'neq') return val !== dep.value;
    return val === dep.value;
  }

  /** Check if a section has a government layout type */
  protected isGovSection(section: FormSection): boolean {
    return !!section.layout && section.layout !== 'default';
  }

  /** Check if a section should be completely hidden (no fields, no instructions, no content) */
  protected isEmptySection(section: FormSection): boolean {
    const hasFields = section.fields && section.fields.length > 0;
    const hasInstructions = !!section.instructions;
    return !hasFields && !hasInstructions;
  }

  /** Get step name lines for multi-line step labels */
  protected getStepNameLines(section: FormSection): string[] {
    return section.stepName?.split('\n') ?? [];
  }

  /** Convert newlines to <br> for section titles */
  protected nlToBr(text: string | undefined): string {
    return (text ?? '').replace(/\n/g, '<br>');
  }

  /** Check if a field is an interactive form control (not display-only) */
  protected isInteractiveField(field: FormFieldDefinition): boolean {
    return isValueControl(field);
  }

  /** Format SSN input as XXX-XX-XXXX and sync the FormControl */
  protected formatSsn(event: Event, fieldId: string): void {
    const el = event.target as HTMLInputElement;
    const digits = el.value.replace(/\D/g, '').slice(0, 9);
    if (digits.length <= 3) {
      el.value = digits;
    } else if (digits.length <= 5) {
      el.value = `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
      el.value = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }
    this.form().controls[fieldId]?.setValue(el.value, { emitEvent: false });
  }

  protected switchPage(index: number): void {
    this.activePageIndex.set(index);
  }

  protected nextPage(): void {
    const next = this.activePageIndex() + 1;
    if (next < this.pages().length) {
      this.activePageIndex.set(next);
    }
  }

  protected prevPage(): void {
    const prev = this.activePageIndex() - 1;
    if (prev >= 0) {
      this.activePageIndex.set(prev);
    }
  }

  protected onBack(): void {
    this.back.emit();
  }

  protected onSave(): void {
    this.save.emit(this.getFormData());
  }

  protected onSubmit(): void {
    if (this.form().invalid) return;
    this.submitForm.emit(this.getFormData());
  }

  private getFormData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const pages = this.pages();
    const controls = this.form().controls;
    for (const page of pages) {
      if (page.readonly) continue;
      for (const section of page.sections) {
        for (const field of section.fields) {
          if (!isValueControl(field)) continue;
          // Use direct key lookup — form.get() interprets dots/brackets as path separators
          // which breaks PDF annotation IDs like "topmostSubform[0].Page1[0].f1_01[0]"
          const control = controls[field.id];
          if (control) {
            data[field.id] = control.value;
          }
        }
      }
    }
    return data;
  }

  private buildFieldLabels(): Record<string, string> {
    const labels: Record<string, string> = {};
    const pages = this.pages();
    for (const page of pages) {
      for (const section of page.sections) {
        for (const field of section.fields) {
          if (isValueControl(field)) {
            labels[field.id] = field.amountLabel || field.label || field.id;
          }
        }
      }
    }
    return labels;
  }
}

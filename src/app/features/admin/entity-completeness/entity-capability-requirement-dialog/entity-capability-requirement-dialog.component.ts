import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';

import { EntityCapabilityRequirementService } from '../../services/entity-capability-requirement.service';
import {
  EntityCapabilityRequirementResponseModel,
  UpsertEntityCapabilityRequirementRequestModel,
} from '../../models/entity-capability-requirement.model';

/**
 * Authoring dialog for one entity-capability requirement row. Used by the
 * `/admin/entity-completeness` page in both create and edit modes.
 *
 * Predicate is a free-form JSON textarea — the server validates the shape
 * (`{ "type": "fieldPresent", "field": "..." }` and friends). Client-side
 * we just enforce that the input parses as JSON before allowing save.
 *
 * The set of supported entity types is fixed for now (Vendor / Part /
 * Customer); when a new entity gets a completeness chip, extend the
 * `entityTypeOptions` array. The capability code is a free-text input —
 * a typeahead against the catalog is a follow-up enhancement.
 */
@Component({
  selector: 'app-entity-capability-requirement-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    DialogComponent, InputComponent, SelectComponent, TextareaComponent,
    ValidationButtonComponent,
  ],
  templateUrl: './entity-capability-requirement-dialog.component.html',
  styleUrl: './entity-capability-requirement-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityCapabilityRequirementDialogComponent {
  private readonly service = inject(EntityCapabilityRequirementService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly requirement = input<EntityCapabilityRequirementResponseModel | null>(null);
  readonly closed = output<void>();
  readonly saved = output<void>();

  protected readonly saving = signal(false);

  protected readonly entityTypeOptions: SelectOption[] = [
    { value: 'Vendor', label: 'Vendor' },
    { value: 'Part', label: 'Part' },
    { value: 'Customer', label: 'Customer' },
  ];

  protected readonly form = new FormGroup({
    entityType: new FormControl<string>('Vendor', [Validators.required]),
    capabilityCode: new FormControl<string>('', [Validators.required, Validators.maxLength(120)]),
    requirementId: new FormControl<string>('', [
      Validators.required,
      Validators.pattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
      Validators.maxLength(120),
    ]),
    predicate: new FormControl<string>('', [Validators.required, this.jsonValidator]),
    displayNameKey: new FormControl<string>('', [Validators.required, Validators.maxLength(200)]),
    missingMessageKey: new FormControl<string>('', [Validators.required, Validators.maxLength(200)]),
    sortOrder: new FormControl<number>(0, [Validators.required]),
  });

  protected readonly violations = computed(() =>
    FormValidationService.getViolations(this.form, {
      entityType: 'Entity Type',
      capabilityCode: 'Capability Code',
      requirementId: 'Requirement Id',
      predicate: 'Predicate',
      displayNameKey: 'Display Name Key',
      missingMessageKey: 'Missing Message Key',
      sortOrder: 'Sort Order',
    }),
  );

  protected readonly title = computed(() =>
    this.requirement()
      ? this.translate.instant('admin.entityCompleteness.dialog.titleEdit')
      : this.translate.instant('admin.entityCompleteness.dialog.titleNew'),
  );

  constructor() {
    const r = this.requirement();
    if (r) {
      this.form.patchValue({
        entityType: r.entityType,
        capabilityCode: r.capabilityCode,
        requirementId: r.requirementId,
        predicate: r.predicate,
        displayNameKey: r.displayNameKey,
        missingMessageKey: r.missingMessageKey,
        sortOrder: r.sortOrder,
      });
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  protected save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const f = this.form.getRawValue();
    const body: UpsertEntityCapabilityRequirementRequestModel = {
      entityType: f.entityType ?? 'Vendor',
      capabilityCode: f.capabilityCode ?? '',
      requirementId: f.requirementId ?? '',
      predicate: f.predicate ?? '',
      displayNameKey: f.displayNameKey ?? '',
      missingMessageKey: f.missingMessageKey ?? '',
      sortOrder: f.sortOrder ?? 0,
    };

    const r = this.requirement();
    const call = r ? this.service.update(r.id, body) : this.service.create(body);
    call.subscribe({
      next: () => {
        this.saving.set(false);
        this.snackbar.success(this.translate.instant('common.saved'));
        this.saved.emit();
      },
      error: () => this.saving.set(false),
    });
  }

  /** Custom validator — predicate must parse as JSON. */
  private jsonValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (!value) return null;
    try {
      JSON.parse(value);
      return null;
    } catch {
      return { json: true };
    }
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';

import { PartsService } from '../../services/parts.service';
import { PartDetail } from '../../models/part-detail.model';
import { ProcurementSource, PROCUREMENT_SOURCES } from '../../models/procurement-source.type';
import { InventoryClass, INVENTORY_CLASSES } from '../../models/inventory-class.type';

export interface PartQuickCreateDialogData {
  /** Pre-fill from the picker's typed term so the user doesn't retype. */
  initialName?: string;
  /**
   * Default ProcurementSource for the new part. The vendor-side flow
   * (creating a part from a vendor's catalog) passes 'Buy' since
   * vendor-supplied parts are almost always Buy. Other contexts can
   * leave undefined for the server-side default.
   */
  defaultProcurementSource?: ProcurementSource;
}

/**
 * Inline-create surface invoked from `<app-entity-picker>` when the user
 * clicks "+ Create new part 'X'". Three required server fields (per
 * CreatePartRequest): Name, ProcurementSource, InventoryClass. Name is
 * pre-filled from the picker's typed term; ProcurementSource defaults to
 * the caller's `defaultProcurementSource` (typically 'Buy' from a vendor
 * catalog context — Dan's call: default ProcurementSource but NOT
 * InventoryClass). User picks InventoryClass explicitly.
 *
 * PartNumber is server-assigned (PartsService doesn't accept one). Every
 * other detail field is left null and must be filled in via the full part
 * edit / workflow later — capability-indexed completeness (PR #3) will
 * surface the resulting part as "Incomplete for compliance" / etc., as
 * appropriate.
 *
 * Returns the created PartDetail on resolve, or null on dismiss.
 */
@Component({
  selector: 'app-part-quick-create-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    DialogComponent, InputComponent, SelectComponent, ValidationButtonComponent,
  ],
  templateUrl: './part-quick-create-dialog.component.html',
  styleUrl: './part-quick-create-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartQuickCreateDialogComponent {
  private readonly partsService = inject(PartsService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly dialogRef = inject(MatDialogRef<PartQuickCreateDialogComponent, PartDetail | null>);
  protected readonly data = inject<PartQuickCreateDialogData>(MAT_DIALOG_DATA);

  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl<string>(
      this.data.initialName ?? '',
      { nonNullable: true, validators: [Validators.required, Validators.maxLength(256)] },
    ),
    procurementSource: new FormControl<ProcurementSource>(
      this.data.defaultProcurementSource ?? 'Buy',
      { nonNullable: true, validators: [Validators.required] },
    ),
    inventoryClass: new FormControl<InventoryClass | null>(
      null,
      [Validators.required],
    ),
  });

  protected readonly title = computed(() =>
    this.translate.instant('partQuickCreate.title'),
  );

  // Enum → SelectOption arrays. Labels go through i18n so the user sees
  // localized text rather than the enum literal — same convention as the
  // full part workflow's basics step.
  protected readonly procurementSourceOptions: SelectOption[] = PROCUREMENT_SOURCES.map((v) => ({
    value: v,
    label: this.translate.instant(`parts.procurementSource.${v}`),
  }));

  protected readonly inventoryClassOptions: SelectOption[] = INVENTORY_CLASSES.map((v) => ({
    value: v,
    label: this.translate.instant(`parts.inventoryClass.${v}`),
  }));

  protected readonly violations = FormValidationService.getViolations(this.form, {
    name: this.translate.instant('parts.workflow.basics.nameLabel'),
    procurementSource: this.translate.instant('parts.workflow.basics.procurementSourceLabel'),
    inventoryClass: this.translate.instant('parts.workflow.basics.inventoryClassLabel'),
  });

  close(): void {
    this.dialogRef.close(null);
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.partsService.createPart({
      name: v.name.trim(),
      procurementSource: v.procurementSource,
      inventoryClass: v.inventoryClass!,
    }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.snackbar.success(
          this.translate.instant('partQuickCreate.created', { name: created.name }),
        );
        this.dialogRef.close(created);
      },
      error: () => this.saving.set(false),
    });
  }
}

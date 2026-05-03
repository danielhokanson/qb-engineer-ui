import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';

import { VendorService } from '../../services/vendor.service';
import { VendorListItem } from '../../models/vendor-list-item.model';

export interface VendorQuickCreateDialogData {
  /** Pre-fill from the picker's typed term so the user doesn't retype. */
  initialCompanyName?: string;
}

/**
 * Inline-create surface invoked from `<app-entity-picker>` when the user
 * clicks "+ Create new vendor 'X'". Single-field form (CompanyName) — every
 * other vendor field is optional at the API level, so the bare minimum
 * record can be created here and fleshed out later via the full vendor
 * edit dialog.
 *
 * Returns the created VendorListItem on resolve, or null on dismiss.
 * Caller (typically a `vendor-part-form-dialog`) drops the new id into
 * its form's `vendorId`.
 *
 * Counterpart of `<app-part-quick-create-dialog>`. The two share no code
 * because their field shapes diverge — vendor needs only CompanyName,
 * part needs Name + InventoryClass + (defaulted) ProcurementSource.
 *
 * Capability-indexed completeness (PR #3) will surface the resulting
 * vendor as "Incomplete for PO" / etc., depending on which capabilities
 * have unmet field requirements.
 */
@Component({
  selector: 'app-vendor-quick-create-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    DialogComponent, InputComponent, ValidationButtonComponent,
  ],
  templateUrl: './vendor-quick-create-dialog.component.html',
  styleUrl: './vendor-quick-create-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorQuickCreateDialogComponent {
  private readonly vendorService = inject(VendorService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly dialogRef = inject(MatDialogRef<VendorQuickCreateDialogComponent, VendorListItem | null>);
  protected readonly data = inject<VendorQuickCreateDialogData>(MAT_DIALOG_DATA);

  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    companyName: new FormControl<string>(
      this.data.initialCompanyName ?? '',
      { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] },
    ),
  });

  protected readonly title = computed(() =>
    this.translate.instant('vendorQuickCreate.title'),
  );

  protected readonly violations = FormValidationService.getViolations(this.form, {
    companyName: this.translate.instant('vendors.companyName'),
  });

  close(): void {
    this.dialogRef.close(null);
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const companyName = this.form.controls.companyName.value.trim();
    this.vendorService.createVendor({ companyName }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.snackbar.success(
          this.translate.instant('vendorQuickCreate.created', { name: created.companyName }),
        );
        this.dialogRef.close(created);
      },
      error: () => this.saving.set(false),
    });
  }
}

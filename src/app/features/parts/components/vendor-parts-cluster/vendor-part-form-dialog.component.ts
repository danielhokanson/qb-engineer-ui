import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { EntityPickerComponent } from '../../../../shared/components/entity-picker/entity-picker.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { toIsoDate } from '../../../../shared/utils/date.utils';

import { VendorPartsService } from '../../services/vendor-parts.service';
import { VendorPart } from '../../models/vendor-part.model';
import { VendorPartParentEntityType } from './vendor-part-list-panel.component';

export interface VendorPartFormDialogData {
  vendorPart: VendorPart | null;
  parentEntityType: VendorPartParentEntityType;
  parentEntityId: number;
  /** Display label for the locked parent entity (vendor name or part number/name). */
  parentLabel?: string;
  /**
   * First-vendor shortcut — when the create dialog opens for a part that
   * has no VendorPart rows yet, callers pass `true` here so the isPreferred
   * toggle defaults checked. The user doesn't have to think about preference
   * for their first source; preference only becomes a real decision once
   * an alternate exists.
   */
  defaultIsPreferred?: boolean;
}

@Component({
  selector: 'app-vendor-part-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    DialogComponent, InputComponent, TextareaComponent, ToggleComponent, DatepickerComponent,
    EntityPickerComponent, ValidationButtonComponent,
  ],
  templateUrl: './vendor-part-form-dialog.component.html',
  styleUrl: './vendor-part-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorPartFormDialogComponent {
  private readonly vendorPartsService = inject(VendorPartsService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly dialogRef = inject(MatDialogRef<VendorPartFormDialogComponent, VendorPart | null>);
  protected readonly data = inject<VendorPartFormDialogData>(MAT_DIALOG_DATA);

  protected readonly saving = signal(false);
  protected readonly isEdit = !!this.data.vendorPart;

  protected readonly title = computed(() =>
    this.isEdit
      ? this.translate.instant('vendorPart.dialogTitleEdit')
      : this.translate.instant('vendorPart.dialogTitleCreate'),
  );

  /** When true, vendor picker is shown (creating from a Part detail page, picking the vendor). */
  protected readonly showVendorPicker = !this.isEdit && this.data.parentEntityType === 'part';
  /** When true, part picker is shown (creating from a Vendor detail page, picking the part). */
  protected readonly showPartPicker = !this.isEdit && this.data.parentEntityType === 'vendor';

  protected readonly form = new FormGroup({
    vendorId: new FormControl<number | null>(
      this.data.vendorPart?.vendorId ?? (this.data.parentEntityType === 'vendor' ? this.data.parentEntityId : null),
      this.showVendorPicker ? [Validators.required] : [],
    ),
    partId: new FormControl<number | null>(
      this.data.vendorPart?.partId ?? (this.data.parentEntityType === 'part' ? this.data.parentEntityId : null),
      this.showPartPicker ? [Validators.required] : [],
    ),
    vendorPartNumber: new FormControl<string | null>(this.data.vendorPart?.vendorPartNumber ?? '', [Validators.maxLength(100)]),
    manufacturerName: new FormControl<string | null>(this.data.vendorPart?.manufacturerName ?? '', [Validators.maxLength(200)]),
    vendorMpn: new FormControl<string | null>(this.data.vendorPart?.vendorMpn ?? '', [Validators.maxLength(100)]),
    leadTimeDays: new FormControl<number | null>(this.data.vendorPart?.leadTimeDays ?? null, [Validators.min(0)]),
    minOrderQty: new FormControl<number | null>(this.data.vendorPart?.minOrderQty ?? null, [Validators.min(0)]),
    packSize: new FormControl<number | null>(this.data.vendorPart?.packSize ?? null, [Validators.min(0)]),
    countryOfOrigin: new FormControl<string | null>(this.data.vendorPart?.countryOfOrigin ?? '', [Validators.maxLength(2)]),
    htsCode: new FormControl<string | null>(this.data.vendorPart?.htsCode ?? '', [Validators.maxLength(20)]),
    isApproved: new FormControl<boolean>(this.data.vendorPart?.isApproved ?? true, { nonNullable: true }),
    isPreferred: new FormControl<boolean>(
      this.data.vendorPart?.isPreferred ?? this.data.defaultIsPreferred ?? false,
      { nonNullable: true },
    ),
    lastQuotedDate: new FormControl<Date | null>(
      this.data.vendorPart?.lastQuotedDate ? new Date(this.data.vendorPart.lastQuotedDate) : null,
    ),
    notes: new FormControl<string | null>(this.data.vendorPart?.notes ?? '', [Validators.maxLength(2000)]),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    vendorId: this.translate.instant('vendors.vendor'),
    partId: this.translate.instant('parts.part'),
    vendorPartNumber: this.translate.instant('vendorPart.vendorPartNumber'),
    manufacturerName: this.translate.instant('vendorPart.manufacturerName'),
    vendorMpn: this.translate.instant('vendorPart.vendorMpn'),
    leadTimeDays: this.translate.instant('vendorPart.leadTimeDays'),
    minOrderQty: this.translate.instant('vendorPart.minOrderQty'),
    packSize: this.translate.instant('vendorPart.packSize'),
    countryOfOrigin: this.translate.instant('vendorPart.countryOfOrigin'),
    htsCode: this.translate.instant('vendorPart.htsCode'),
    notes: this.translate.instant('vendorPart.notes'),
  });

  close(): void {
    this.dialogRef.close(null);
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.getRawValue();

    const payload = {
      vendorPartNumber: v.vendorPartNumber || null,
      manufacturerName: v.manufacturerName || null,
      vendorMpn: v.vendorMpn || null,
      leadTimeDays: v.leadTimeDays ?? null,
      minOrderQty: v.minOrderQty ?? null,
      packSize: v.packSize ?? null,
      countryOfOrigin: v.countryOfOrigin || null,
      htsCode: v.htsCode || null,
      isApproved: v.isApproved,
      isPreferred: v.isPreferred,
      lastQuotedDate: v.lastQuotedDate ? toIsoDate(v.lastQuotedDate) : null,
      notes: v.notes || null,
    };

    const successMsg = this.isEdit ? 'Vendor source updated' : 'Vendor source added';

    if (this.isEdit && this.data.vendorPart) {
      this.vendorPartsService.update(this.data.vendorPart.id, payload).subscribe({
        next: (result) => {
          this.saving.set(false);
          this.snackbar.success(successMsg);
          this.dialogRef.close(result);
        },
        error: () => this.saving.set(false),
      });
    } else {
      const vendorId = v.vendorId!;
      const partId = v.partId!;
      this.vendorPartsService.create({ vendorId, partId, ...payload }).subscribe({
        next: (result) => {
          this.saving.set(false);
          this.snackbar.success(successMsg);
          this.dialogRef.close(result);
        },
        error: () => this.saving.set(false),
      });
    }
  }
}

import { ChangeDetectionStrategy, Component, inject, input, output, signal, ViewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { VendorService } from '../../services/vendor.service';
import { VendorDetail } from '../../models/vendor-detail.model';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent } from '../../../../shared/components/select/select.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { AddressFormComponent } from '../../../../shared/components/address-form/address-form.component';
import { Address } from '../../../../shared/models/address.model';
import { DraftConfig } from '../../../../shared/models/draft-config.model';
import { PAYMENT_TERMS_OPTIONS } from '../../../../shared/models/credit-terms.const';
import { toAddress, fromAddressToVendor } from '../../../../shared/utils/address.utils';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';

@Component({
  selector: 'app-vendor-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DialogComponent, InputComponent, SelectComponent, TextareaComponent, ToggleComponent,
    AddressFormComponent, ValidationButtonComponent, TranslatePipe,
  ],
  templateUrl: './vendor-dialog.component.html',
  styleUrl: './vendor-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorDialogComponent {
  @ViewChild(DialogComponent) private dialogRef!: DialogComponent;
  private readonly vendorService = inject(VendorService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  readonly vendor = input<VendorDetail | null>(null);
  readonly closed = output<void>();
  readonly saved = output<void>();

  protected readonly saving = signal(false);

  protected get draftConfig(): DraftConfig {
    return {
      entityType: 'vendor',
      entityId: this.vendor()?.id?.toString() ?? 'new',
      route: '/vendors',
    };
  }

  readonly form = new FormGroup({
    companyName: new FormControl('', [Validators.required]),
    contactName: new FormControl(''),
    email: new FormControl('', [Validators.email]),
    phone: new FormControl(''),
    address: new FormControl<Address | null>(null),
    paymentTerms: new FormControl(''),
    notes: new FormControl(''),
    isActive: new FormControl(true),
    // Bought-parts effort PR4 — per-vendor variance threshold override.
    offTierVariancePct: new FormControl<number | null>(null, [Validators.min(0)]),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    companyName: 'Company Name',
    contactName: 'Contact Name',
    email: 'Email',
    phone: 'Phone',
    paymentTerms: 'Payment Terms',
    notes: 'Notes',
    isActive: 'Active',
    offTierVariancePct: 'Off-Tier Variance %',
  });

  protected readonly paymentTermsOptions = PAYMENT_TERMS_OPTIONS;

  constructor() {
    const v = this.vendor();
    if (v) {
      this.form.patchValue({
        companyName: v.companyName,
        contactName: v.contactName ?? '',
        email: v.email ?? '',
        phone: v.phone ?? '',
        address: toAddress({ address: v.address, city: v.city, state: v.state, zipCode: v.zipCode, country: v.country }),
        paymentTerms: v.paymentTerms ?? '',
        notes: v.notes ?? '',
        isActive: v.isActive,
        offTierVariancePct: (v as { offTierVariancePct?: number | null }).offTierVariancePct ?? null,
      });
    }
  }

  protected get isEditing(): boolean {
    return this.vendor() !== null;
  }

  protected close(): void {
    this.closed.emit();
  }

  protected save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const f = this.form.getRawValue();
    const addr = f.address;
    const v = this.vendor();

    const payload = {
      companyName: f.companyName || undefined,
      contactName: f.contactName || undefined,
      email: f.email || undefined,
      phone: f.phone || undefined,
      ...fromAddressToVendor(addr),
      paymentTerms: f.paymentTerms || undefined,
      notes: f.notes || undefined,
      offTierVariancePct: f.offTierVariancePct,
    };

    if (v) {
      this.vendorService.updateVendor(v.id, {
        ...payload,
        isActive: f.isActive ?? true,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogRef.clearDraft();
          this.snackbar.success(this.translate.instant('vendors.vendorUpdated'));
          this.saved.emit();
        },
        error: () => this.saving.set(false),
      });
    } else {
      this.vendorService.createVendor({
        ...payload,
        companyName: f.companyName!,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.dialogRef.clearDraft();
          this.snackbar.success(this.translate.instant('vendors.vendorCreated'));
          this.saved.emit();
        },
        error: () => this.saving.set(false),
      });
    }
  }
}

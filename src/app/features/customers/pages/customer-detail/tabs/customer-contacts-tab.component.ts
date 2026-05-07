import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';

import { CustomerService } from '../../../services/customer.service';
import { ReferenceDataService } from '../../../../../shared/services/reference-data.service';
import { FormValidationService } from '../../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../../shared/services/snackbar.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { AvatarComponent } from '../../../../../shared/components/avatar/avatar.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../../../shared/components/toggle/toggle.component';
import { DialogComponent } from '../../../../../shared/components/dialog/dialog.component';
import { ValidationButtonComponent } from '../../../../../shared/components/validation-button/validation-button.component';
import { Contact } from '../../../models/contact.model';


@Component({
  selector: 'app-customer-contacts-tab',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AvatarComponent, InputComponent, SelectComponent, ToggleComponent,
    DialogComponent, ValidationButtonComponent,
  ],
  templateUrl: './customer-contacts-tab.component.html',
  styleUrl: '../customer-detail-tabs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerContactsTabComponent implements OnInit {
  private readonly customerService = inject(CustomerService);
  private readonly refDataService = inject(ReferenceDataService);
  private readonly snackbar = inject(SnackbarService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  readonly customerId = input.required<number>();

  protected readonly contacts = signal<Contact[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly showDialog = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly roleOptions = signal<SelectOption[]>([{ value: null, label: '-- None --' }]);

  protected readonly contactForm = new FormGroup({
    firstName: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    lastName: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    email: new FormControl('', [Validators.email, Validators.maxLength(200)]),
    phone: new FormControl(''),
    role: new FormControl<string | null>(null),
    isPrimary: new FormControl(false),
  });

  protected readonly violations = computed(() =>
    FormValidationService.getViolations(this.contactForm, {
      firstName: 'First Name',
      lastName: 'Last Name',
      email: 'Email',
    })
  );

  protected readonly dialogTitle = computed(() =>
    this.editingId() ? 'Edit Contact' : 'New Contact'
  );

  protected getInitials(c: Contact): string {
    return (c.firstName[0] ?? '') + (c.lastName[0] ?? '');
  }

  ngOnInit(): void {
    this.refDataService.getAsOptions('contact_role', { allLabel: '-- None --', valueField: 'label' })
      .subscribe(opts => this.roleOptions.set(opts));
    this.loadContacts();
  }

  private loadContacts(): void {
    this.loading.set(true);
    this.customerService.getCustomerById(this.customerId()).subscribe({
      next: detail => {
        this.contacts.set(detail.contacts ?? []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected openAdd(): void {
    this.editingId.set(null);
    this.contactForm.reset({ isPrimary: false });
    this.showDialog.set(true);
  }

  protected openEdit(contact: Contact): void {
    this.editingId.set(contact.id);
    this.contactForm.patchValue({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      role: contact.role ?? null,
      isPrimary: contact.isPrimary,
    });
    this.showDialog.set(true);
  }

  protected closeDialog(): void {
    this.showDialog.set(false);
    this.contactForm.reset();
    this.editingId.set(null);
  }

  protected saveContact(): void {
    if (this.contactForm.invalid || this.saving()) return;
    const v = this.contactForm.value;
    const payload = {
      firstName: v.firstName!,
      lastName: v.lastName!,
      email: v.email ?? undefined,
      phone: v.phone ?? undefined,
      role: v.role ?? undefined,
      isPrimary: v.isPrimary ?? false,
    };
    this.saving.set(true);
    const id = this.editingId();
    const obs = id
      ? this.customerService.updateContact(this.customerId(), id, payload)
      : this.customerService.createContact(this.customerId(), payload);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeDialog();
        this.loadContacts();
        this.snackbar.success(id ? 'Contact updated' : 'Contact added');
      },
      error: () => this.saving.set(false),
    });
  }

  protected deleteContact(contact: Contact): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Remove Contact?',
        message: `Remove ${contact.firstName} ${contact.lastName} from this customer?`,
        confirmLabel: 'Remove',
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.customerService.deleteContact(this.customerId(), contact.id).subscribe({
        next: () => {
          this.loadContacts();
          this.snackbar.success('Contact removed');
        },
      });
    });
  }
}

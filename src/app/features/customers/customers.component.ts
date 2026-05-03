import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, startWith } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { CustomerService } from './services/customer.service';
import { CustomerListItem } from './models/customer-list-item.model';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { DialogComponent } from '../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../shared/components/select/select.component';
import { DataTableComponent } from '../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../shared/models/column-def.model';
import { FormValidationService } from '../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../shared/components/validation-button/validation-button.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnackbarService } from '../../shared/services/snackbar.service';
import { LoadingBlockDirective } from '../../shared/directives/loading-block.directive';
import { EntityCompletenessChipComponent } from '../../shared/components/entity-completeness-chip/entity-completeness-chip.component';
import { EntityCompletenessBadgeComponent } from '../../shared/components/entity-completeness-badge/entity-completeness-badge.component';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [
    ReactiveFormsModule, DatePipe, TranslatePipe,
    PageHeaderComponent, DialogComponent,
    InputComponent, SelectComponent,
    DataTableComponent, ColumnCellDirective, ValidationButtonComponent,
    LoadingBlockDirective,
    EntityCompletenessChipComponent, EntityCompletenessBadgeComponent,
  ],
  templateUrl: './customers.component.html',
  styleUrl: './customers.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomersComponent {
  private readonly customerService = inject(CustomerService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly customers = signal<CustomerListItem[]>([]);
  // Phase 3 F7-partial / WU-17 — surfaces the server-side totalCount so the
  // header can show "X of Y" once the data-table is wired to true server
  // pagination. Today the data-table still slices the 200-record page
  // client-side, but the envelope is in place.
  protected readonly totalCount = signal<number>(0);

  // Filters
  protected readonly searchControl = new FormControl('');
  protected readonly activeFilterControl = new FormControl<boolean | null>(null);

  private readonly searchTerm = toSignal(this.searchControl.valueChanges.pipe(startWith('')), { initialValue: '' });

  protected readonly activeOptions: SelectOption[] = [
    { value: null, label: this.translate.instant('common.all') },
    { value: true, label: this.translate.instant('common.active') },
    { value: false, label: this.translate.instant('common.inactive') },
  ];

  // Customer Create Dialog — Phase 3 F3 extends the form with the full-record
  // fields a small-shop onboarding flow captures: credit limit, default tax
  // code id, default currency, and billing/shipping addresses. All are
  // optional; existing minimal-payload submissions still work.
  protected readonly showDialog = signal(false);
  protected readonly customerForm = new FormGroup({
    name: new FormControl('', [Validators.required]),
    companyName: new FormControl(''),
    email: new FormControl('', [Validators.email]),
    phone: new FormControl(''),
    // F3 — full-record fields
    creditLimit: new FormControl<number | null>(null, [Validators.min(0), Validators.max(1_000_000_000)]),
    defaultTaxCodeId: new FormControl<number | null>(null),
    // ISO 4217: 3 uppercase letters (matches server validation)
    defaultCurrency: new FormControl<string | null>(null, [Validators.pattern(/^[A-Z]{3}$/)]),
    billingAddress: new FormGroup({
      street: new FormControl<string | null>(null),
      line2: new FormControl<string | null>(null),
      city: new FormControl<string | null>(null),
      state: new FormControl<string | null>(null),
      postal: new FormControl<string | null>(null),
      country: new FormControl<string | null>('US'),
    }),
    shippingAddress: new FormGroup({
      street: new FormControl<string | null>(null),
      line2: new FormControl<string | null>(null),
      city: new FormControl<string | null>(null),
      state: new FormControl<string | null>(null),
      postal: new FormControl<string | null>(null),
      country: new FormControl<string | null>('US'),
    }),
  });

  protected readonly customerViolations = computed(() =>
    FormValidationService.getViolations(this.customerForm, {
      name: this.translate.instant('common.name'),
      companyName: this.translate.instant('customers.companyName'),
      email: this.translate.instant('common.email'),
      phone: this.translate.instant('common.phone'),
      creditLimit: this.translate.instant('customers.creditLimit'),
      defaultCurrency: this.translate.instant('customers.defaultCurrency'),
    })
  );

  // Table
  protected readonly customerColumns: ColumnDef[] = [
    { field: 'name', header: this.translate.instant('customers.colName'), sortable: true },
    { field: 'companyName', header: this.translate.instant('customers.colCompany'), sortable: true },
    { field: 'email', header: this.translate.instant('customers.colEmail'), sortable: true },
    { field: 'phone', header: this.translate.instant('customers.colPhone'), sortable: true },
    { field: 'isActive', header: this.translate.instant('customers.colActive'), sortable: true, type: 'enum', filterable: true, filterOptions: [
      { value: true, label: this.translate.instant('common.active') }, { value: false, label: this.translate.instant('common.inactive') },
    ], width: '80px' },
    { field: 'contactCount', header: this.translate.instant('customers.colContacts'), sortable: true, width: '90px', align: 'center' },
    { field: 'jobCount', header: this.translate.instant('customers.colJobs'), sortable: true, width: '70px', align: 'center' },
    { field: 'createdAt', header: this.translate.instant('customers.colCreated'), sortable: true, type: 'date', width: '110px' },
    // Hidden by default — power users opt in via column-manager. Renders the
    // full completeness chip (click → popover with per-capability gaps).
    { field: 'completeness', header: this.translate.instant('entityCompleteness.columnHeader'), width: '160px', align: 'center', visible: false },
  ];

  constructor() {
    this.loadCustomers();

    // Phase 3 F7-partial / WU-17 — debounced search. Typed input fires the
    // standardised `?q=` query param against the server (300ms debounce per
    // the WU-17 charter). Active-filter changes also re-fetch so the server
    // pagination + filter contract is exercised live.
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.loadCustomers());

    this.activeFilterControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.loadCustomers());
  }

  protected loadCustomers(): void {
    this.loading.set(true);
    const search = (this.searchTerm() ?? '').trim() || undefined;
    const isActive = this.activeFilterControl.value ?? undefined;
    // Phase 3 F7-partial / WU-17 — call the paged endpoint directly so we
    // can read totalCount for the header counter. PageSize=200 matches the
    // server cap; the data-table handles client-side slicing within that
    // window. Switch to true server-paging if a tenant exceeds 200 rows.
    this.customerService.getCustomersPaged({
      q: search,
      isActive,
      pageSize: 200,
      sort: 'createdAt',
      order: 'desc',
    }).subscribe({
      next: (paged) => {
        this.customers.set(paged.items);
        this.totalCount.set(paged.totalCount);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected applyFilters(): void { this.loadCustomers(); }

  protected selectCustomer(item: CustomerListItem): void {
    this.router.navigate(['/customers', item.id]);
  }

  // ─── Customer Create ───
  protected openCreateCustomer(): void {
    this.customerForm.reset({
      name: '', companyName: '', email: '', phone: '',
      creditLimit: null, defaultTaxCodeId: null, defaultCurrency: null,
      billingAddress: { street: null, line2: null, city: null, state: null, postal: null, country: 'US' },
      shippingAddress: { street: null, line2: null, city: null, state: null, postal: null, country: 'US' },
    });
    this.showDialog.set(true);
  }

  protected closeDialog(): void { this.showDialog.set(false); }

  /** Returns the inner address object only if the user filled in any required field. */
  private extractAddress(group: { street: string | null; line2: string | null; city: string | null; state: string | null; postal: string | null; country: string | null }) {
    const filled = !!(group.street || group.city || group.state || group.postal);
    if (!filled) return undefined;
    return {
      street: group.street ?? '',
      line2: group.line2 ?? undefined,
      city: group.city ?? '',
      state: group.state ?? '',
      postal: group.postal ?? '',
      country: group.country ?? undefined,
    };
  }

  protected saveCustomer(): void {
    if (this.customerForm.invalid) return;
    this.saving.set(true);
    // Drop any prior server messages so a re-submit doesn't accumulate.
    FormValidationService.clearServerErrors(this.customerForm);
    const form = this.customerForm.getRawValue();

    this.customerService.createCustomer({
      name: form.name!,
      companyName: form.companyName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      // F3 — full-record fields. Empty strings collapse to undefined so the
      // server treats them as unset rather than failing validation on a blank
      // address sub-object.
      creditLimit: form.creditLimit ?? undefined,
      defaultTaxCodeId: form.defaultTaxCodeId ?? undefined,
      defaultCurrency: form.defaultCurrency || undefined,
      billingAddress: this.extractAddress(form.billingAddress),
      shippingAddress: this.extractAddress(form.shippingAddress),
    }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.closeDialog();
        this.snackbar.success(this.translate.instant('customers.customerCreated'));
        this.router.navigate(['/customers', created.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        // Phase 3 / WU-02: surface per-field server errors against the form
        // so the validation popover lights up; legacy non-envelope errors
        // fall through to the central interceptor's snackbar.
        FormValidationService.applyServerError(this.customerForm, err);
      },
    });
  }
}

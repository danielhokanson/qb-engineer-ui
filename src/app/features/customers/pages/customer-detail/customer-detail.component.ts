import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { CustomerService } from '../../services/customer.service';
import { CustomerSummary } from '../../models/customer-summary.model';
import {
  CustomerDetailLayoutResolverService,
  CustomerDetailTabId,
  TabLayoutEntry,
} from '../../services/customer-detail-layout-resolver.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { CustomerOverviewTabComponent } from './tabs/customer-overview-tab.component';
import { CustomerContactsTabComponent } from './tabs/customer-contacts-tab.component';
import { CustomerAddressesTabComponent } from './tabs/customer-addresses-tab.component';
import { CustomerEstimatesTabComponent } from './tabs/customer-estimates-tab.component';
import { CustomerQuotesTabComponent } from './tabs/customer-quotes-tab.component';
import { CustomerOrdersTabComponent } from './tabs/customer-orders-tab.component';
import { CustomerJobsTabComponent } from './tabs/customer-jobs-tab.component';
import { CustomerInvoicesTabComponent } from './tabs/customer-invoices-tab.component';
import { CustomerActivityTabComponent } from './tabs/customer-activity-tab.component';
import { CustomerInteractionsTabComponent } from './tabs/customer-interactions-tab.component';
import { CustomerPricingTabComponent } from './tabs/customer-pricing-tab.component';
import { CustomerIdentityClusterComponent } from '../../components/customer-clusters/customer-identity-cluster.component';
import { CustomerActivityClusterComponent } from '../../components/customer-clusters/customer-activity-cluster.component';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { EntityCompletenessChipComponent } from '../../../../shared/components/entity-completeness-chip/entity-completeness-chip.component';

/**
 * Pillar 5 — Customer detail shell.
 *
 * Tabs are driven by `CustomerDetailLayoutResolverService.resolve(...)` which
 * maps the customer's lifecycle bucket (Active / Prospect / Archived, derived
 * from `IsActive` + open-doc counts) to an ordered list of tab descriptors.
 * Identity (overview) is always first; Activity always last.
 *
 * Existing per-tab components (`customer-{tab}-tab.component`) continue to
 * surface through the resolver-driven shell. The `overview` tab now mounts
 * the new `<app-customer-identity-cluster>` (read + edit). The `activity`
 * tab mounts the new `<app-customer-activity-cluster>` (wraps the shared
 * `<app-entity-activity-section>`).
 *
 * Spec source of truth: `docs/entity-detail-pattern.md` § 6.
 */
@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [
    TranslatePipe, RouterLink, MatTooltipModule,
    CustomerOverviewTabComponent, CustomerContactsTabComponent, CustomerAddressesTabComponent,
    CustomerEstimatesTabComponent, CustomerQuotesTabComponent, CustomerOrdersTabComponent,
    CustomerJobsTabComponent, CustomerInvoicesTabComponent, CustomerActivityTabComponent, CustomerInteractionsTabComponent,
    CustomerPricingTabComponent,
    CustomerIdentityClusterComponent, CustomerActivityClusterComponent,
    CurrencyDisplayComponent,
    EntityCompletenessChipComponent,
  ],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly customerService = inject(CustomerService);
  private readonly snackbar = inject(SnackbarService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly layoutResolver = inject(CustomerDetailLayoutResolverService);

  protected readonly customerId = toSignal(
    this.route.paramMap.pipe(map(p => +p.get('id')!)),
    { initialValue: 0 },
  );

  protected readonly activeTab = toSignal(
    this.route.paramMap.pipe(map(p => (p.get('tab') ?? 'overview') as CustomerDetailTabId)),
    { initialValue: 'overview' as CustomerDetailTabId },
  );

  protected readonly customer = signal<CustomerSummary | null>(null);
  protected readonly loading = signal(true);
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);

  /**
   * Pillar 5 — Resolved tab layout for the loaded Customer. Derived from the
   * customer's lifecycle bucket via `deriveLifecycle(...)`.
   */
  protected readonly tabLayout = computed<TabLayoutEntry[]>(() => {
    const c = this.customer();
    if (!c) return [];
    const lifecycle = this.layoutResolver.deriveLifecycle(c);
    return this.layoutResolver.resolve(lifecycle);
  });

  constructor() {
    effect(() => {
      const id = this.customerId();
      if (id > 0) this.loadCustomer(id);
    });

    // If the resolver no longer surfaces the active tab (e.g. customer
    // archived → Orders tab disappears), fall back to the first tab.
    effect(() => {
      const layout = this.tabLayout();
      if (layout.length === 0) return;
      const current = this.activeTab();
      if (!layout.some(t => t.id === current)) {
        const fallback = layout[0].id;
        this.router.navigate(['..', fallback], { relativeTo: this.route, replaceUrl: true });
      }
    });
  }

  private loadCustomer(id: number): void {
    this.loading.set(true);
    this.customerService.getCustomerSummary(id).subscribe({
      next: c => {
        this.customer.set(c);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.router.navigate(['/customers']);
      },
    });
  }

  protected switchTab(tab: CustomerDetailTabId): void {
    this.router.navigate(['..', tab], { relativeTo: this.route });
  }

  protected toggleEdit(): void {
    this.editing.update(v => !v);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  /**
   * Pillar 5 — Generic save handler used by the identity cluster (and any
   * future editable cluster). The cluster emits a `Partial<CustomerSummary>`
   * patch; we map onto `UpdateCustomerRequest` and refresh.
   */
  protected saveClusterPatch(patch: Partial<CustomerSummary>): void {
    const c = this.customer();
    if (!c) return;
    this.saving.set(true);
    this.customerService.updateCustomer(c.id, {
      name: patch.name ?? c.name,
      companyName: patch.companyName ?? c.companyName,
      email: patch.email ?? c.email,
      phone: patch.phone ?? c.phone,
      isActive: patch.isActive ?? c.isActive,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(false);
        this.loadCustomer(c.id);
        this.snackbar.success(this.translate.instant('customers.saved'));
      },
      error: () => this.saving.set(false),
    });
  }

  protected archiveCustomer(): void {
    const c = this.customer();
    if (!c) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('customers.archiveTitle'),
        message: this.translate.instant('customers.archiveMessage'),
        confirmLabel: this.translate.instant('common.archive'),
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.customerService.deleteCustomer(c.id).subscribe({
        next: () => {
          this.snackbar.success(this.translate.instant('customers.archived'));
          this.router.navigate(['/customers']);
        },
      });
    });
  }
}

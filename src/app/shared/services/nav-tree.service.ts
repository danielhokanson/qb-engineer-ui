import { Injectable, Signal, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

import { AuthService } from './auth.service';
import { NavItem } from '../models/nav-item.model';

@Injectable({ providedIn: 'root' })
export class NavTreeService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects.split('?')[0]),
    ),
    { initialValue: this.router.url.split('?')[0] },
  );

  // Pinned-top items: always rendered at the top of the sidebar regardless of
  // which group the user has drilled into. Empty by default — Dashboard used
  // to live here as a "one click from anywhere" landing-page shortcut, but
  // the constant top-anchor read as more chrome than affordance, so it now
  // lives inside the Operations group like the other workflow-specific tools.
  private readonly allPinnedTopTree: NavItem[] = [];

  private readonly allMainTree: NavItem[] = [
    {
      icon: 'space_dashboard', label: 'Operations', i18nKey: 'navGroups.operations',
      children: [
        { icon: 'dashboard', label: 'Dashboard', i18nKey: 'nav.dashboard', route: '/dashboard', shortcut: ['Q', 'D'] },
        { icon: 'view_kanban', label: 'Board', i18nKey: 'nav.kanban', route: '/kanban', shortcut: ['Q', 'K'], allowedRoles: ['Admin', 'Manager', 'Engineer', 'ProductionWorker'] },
        { icon: 'inbox', label: 'Backlog', i18nKey: 'nav.backlog', route: '/backlog', shortcut: ['Q', 'B'], allowedRoles: ['Admin', 'Manager', 'PM', 'Engineer'] },
        { icon: 'event_note', label: 'Planning', i18nKey: 'nav.planning', route: '/planning', allowedRoles: ['Admin', 'Manager', 'PM'] },
        { icon: 'calendar_month', label: 'Calendar', i18nKey: 'nav.calendar', route: '/calendar' },
        { icon: 'rule', label: 'Approvals', i18nKey: 'nav.approvals', route: '/approvals', allowedRoles: ['Admin', 'Manager', 'PM', 'OfficeManager'] },
      ],
    },
    {
      icon: 'sell', label: 'Sales', i18nKey: 'navGroups.sales',
      children: [
        { icon: 'people', label: 'Customers', i18nKey: 'nav.customers', route: '/customers', allowedRoles: ['Admin', 'Manager', 'PM', 'OfficeManager'] },
        { icon: 'people_outline', label: 'Leads', i18nKey: 'nav.leads', route: '/leads', allowedRoles: ['Admin', 'Manager', 'PM'] },
        { icon: 'request_quote', label: 'Quotes', i18nKey: 'nav.quotes', route: '/quotes', allowedRoles: ['Admin', 'Manager', 'PM', 'OfficeManager'] },
        { icon: 'shopping_cart', label: 'Sales Orders', i18nKey: 'nav.salesOrders', route: '/sales-orders', allowedRoles: ['Admin', 'Manager', 'PM', 'OfficeManager'] },
        { icon: 'outbox', label: 'Shipments', i18nKey: 'nav.shipments', route: '/shipments', allowedRoles: ['Admin', 'Manager', 'OfficeManager'] },
        { icon: 'assignment_return', label: 'Customer Returns', i18nKey: 'nav.customerReturns', route: '/customer-returns', allowedRoles: ['Admin', 'Manager', 'PM', 'OfficeManager'] },
        { icon: 'receipt', label: 'Invoices', i18nKey: 'nav.invoices', route: '/invoices', allowedRoles: ['Admin', 'Manager', 'OfficeManager'] },
        { icon: 'payments', label: 'Payments', i18nKey: 'nav.payments', route: '/payments', allowedRoles: ['Admin', 'Manager', 'OfficeManager'] },
      ],
    },
    {
      icon: 'precision_manufacturing', label: 'Production', i18nKey: 'navGroups.production',
      children: [
        { icon: 'category', label: 'Parts', i18nKey: 'nav.parts', route: '/parts', shortcut: ['Q', 'P'], allowedRoles: ['Admin', 'Manager', 'Engineer', 'PM'] },
        { icon: 'hub', label: 'MRP', i18nKey: 'nav.mrp', route: '/mrp', allowedRoles: ['Admin', 'Manager'] },
        { icon: 'event_available', label: 'Scheduling', i18nKey: 'nav.scheduling', route: '/scheduling', allowedRoles: ['Admin', 'Manager'] },
        { icon: 'batch_prediction', label: 'Lots', i18nKey: 'nav.lots', route: '/lots', allowedRoles: ['Admin', 'Manager', 'Engineer'] },
        { icon: 'speed', label: 'OEE', i18nKey: 'nav.oee', route: '/oee', allowedRoles: ['Admin', 'Manager'] },
      ],
    },
    {
      icon: 'inventory_2', label: 'Inventory', i18nKey: 'navGroups.inventory',
      children: [
        { icon: 'inventory', label: 'Stock', i18nKey: 'nav.inventory', route: '/inventory', shortcut: ['Q', 'I'], allowedRoles: ['Admin', 'Manager', 'Engineer', 'OfficeManager'] },
        { icon: 'build', label: 'Assets', i18nKey: 'nav.assets', route: '/assets', allowedRoles: ['Admin', 'Manager'] },
      ],
    },
    {
      icon: 'local_shipping', label: 'Purchasing', i18nKey: 'navGroups.purchasing',
      children: [
        { icon: 'storefront', label: 'Vendors', i18nKey: 'nav.vendors', route: '/vendors', allowedRoles: ['Admin', 'Manager', 'OfficeManager'] },
        { icon: 'description', label: 'Purchase Orders', i18nKey: 'nav.purchaseOrders', route: '/purchase-orders', allowedRoles: ['Admin', 'Manager', 'OfficeManager'] },
        { icon: 'request_page', label: 'RFQs', i18nKey: 'nav.purchasing', route: '/purchasing', allowedRoles: ['Admin', 'Manager', 'OfficeManager'] },
      ],
    },
    {
      icon: 'groups', label: 'People', i18nKey: 'navGroups.people',
      children: [
        { icon: 'badge', label: 'Employees', i18nKey: 'nav.employees', route: '/employees', allowedRoles: ['Admin', 'Manager'] },
        { icon: 'schedule', label: 'Time', i18nKey: 'nav.timeTracking', route: '/time-tracking', shortcut: ['Q', 'T'] },
        { icon: 'receipt_long', label: 'Expenses', i18nKey: 'nav.expenses', route: '/expenses', allowedRoles: ['Admin', 'Manager', 'Engineer', 'OfficeManager'] },
        { icon: 'school', label: 'Training', i18nKey: 'nav.training', route: '/training/library' },
      ],
    },
    {
      icon: 'insights', label: 'Insights', i18nKey: 'navGroups.insights',
      children: [
        { icon: 'bar_chart', label: 'Reports', i18nKey: 'nav.reports', route: '/reports', shortcut: ['Q', 'R'], allowedRoles: ['Admin', 'Manager', 'PM'] },
        { icon: 'smart_toy', label: 'AI', i18nKey: 'nav.ai', route: '/ai' },
      ],
    },
  ];

  private readonly allBottomTree: NavItem[] = [
    { icon: 'storefront', label: 'Shop Floor', i18nKey: 'nav.shopFloor', route: '/display/shop-floor', allowedRoles: ['Admin', 'Manager'] },
    {
      icon: 'settings', label: 'Admin', i18nKey: 'nav.admin', routePrefix: '/admin',
      allowedRoles: ['Admin', 'Manager', 'OfficeManager'],
      children: [
        {
          icon: 'manage_accounts', label: 'Users & Access', i18nKey: 'adminGroups.usersAccess',
          children: [
            { icon: 'people', label: 'Users', i18nKey: 'admin.tabs.users', route: '/admin/users', allowedRoles: ['Admin'] },
            { icon: 'groups', label: 'Teams', i18nKey: 'admin.tabs.teams', route: '/admin/teams', allowedRoles: ['Admin'] },
            { icon: 'layers', label: 'Role Templates', i18nKey: 'admin.tabs.roleTemplates', route: '/admin/role-templates', allowedRoles: ['Admin'] },
            { icon: 'verified_user', label: 'MFA Policy', i18nKey: 'admin.tabs.mfa', route: '/admin/mfa', allowedRoles: ['Admin'] },
          ],
        },
        {
          icon: 'dataset', label: 'Master Data', i18nKey: 'adminGroups.masterData',
          children: [
            { icon: 'dataset', label: 'Reference Data', i18nKey: 'admin.tabs.referenceData', route: '/admin/reference-data', allowedRoles: ['Admin'] },
            { icon: 'translate', label: 'Terminology', i18nKey: 'admin.tabs.terminology', route: '/admin/terminology', allowedRoles: ['Admin'] },
            { icon: 'route', label: 'Track Types', i18nKey: 'admin.tabs.trackTypes', route: '/admin/track-types', allowedRoles: ['Admin'] },
            { icon: 'percent', label: 'Sales Tax', i18nKey: 'admin.tabs.salesTax', route: '/admin/sales-tax', allowedRoles: ['Admin'] },
          ],
        },
        {
          icon: 'hub', label: 'Integrations', i18nKey: 'adminGroups.integrations',
          children: [
            { icon: 'hub', label: 'Integrations', i18nKey: 'admin.tabs.integrations', route: '/admin/integrations', allowedRoles: ['Admin'] },
            { icon: 'swap_horiz', label: 'EDI', i18nKey: 'admin.tabs.edi', route: '/admin/edi', allowedRoles: ['Admin'] },
            { icon: 'outbox', label: 'Integration Outbox', i18nKey: 'admin.tabs.integrationOutbox', route: '/admin/integration-outbox', allowedRoles: ['Admin'] },
            { icon: 'smart_toy', label: 'AI Assistants', i18nKey: 'admin.tabs.aiAssistants', route: '/admin/ai-assistants', allowedRoles: ['Admin'] },
            { icon: 'auto_awesome', label: 'Auto-PO', i18nKey: 'admin.tabs.autoPo', route: '/admin/auto-po', allowedRoles: ['Admin'] },
          ],
        },
        {
          icon: 'auto_fix_high', label: 'Workflow', i18nKey: 'adminGroups.workflow',
          children: [
            { icon: 'auto_fix_high', label: 'Automations', i18nKey: 'admin.tabs.automations', route: '/admin/automations', allowedRoles: ['Admin'] },
            { icon: 'event', label: 'Events', i18nKey: 'admin.tabs.events', route: '/admin/events', allowedRoles: ['Admin', 'Manager'] },
            { icon: 'campaign', label: 'Announcements', i18nKey: 'admin.tabs.announcements', route: '/admin/announcements', allowedRoles: ['Admin', 'Manager'] },
            { icon: 'school', label: 'Training', i18nKey: 'admin.tabs.training', route: '/admin/training', allowedRoles: ['Admin', 'Manager'] },
            { icon: 'fact_check', label: 'Compliance', i18nKey: 'admin.tabs.compliance', route: '/admin/compliance', allowedRoles: ['Admin', 'Manager', 'OfficeManager'] },
            { icon: 'receipt_long', label: 'Expense Policy', i18nKey: 'admin.tabs.expenses', route: '/admin/expenses', allowedRoles: ['Admin'] },
          ],
        },
        {
          icon: 'toggle_on', label: 'Capabilities', i18nKey: 'adminGroups.capabilities',
          children: [
            { icon: 'toggle_on', label: 'Capabilities', i18nKey: 'admin.tabs.capabilities', route: '/admin/capabilities', allowedRoles: ['Admin'] },
            { icon: 'quiz', label: 'Discovery Wizard', i18nKey: 'admin.tabs.discovery', route: '/admin/discovery', allowedRoles: ['Admin'] },
            { icon: 'dashboard_customize', label: 'Presets', i18nKey: 'admin.tabs.presets', route: '/admin/presets', allowedRoles: ['Admin'] },
            { icon: 'fact_check', label: 'Entity Completeness', i18nKey: 'admin.tabs.entityCompleteness', route: '/admin/entity-completeness', allowedRoles: ['Admin'] },
          ],
        },
        {
          icon: 'settings', label: 'System', i18nKey: 'adminGroups.system',
          children: [
            { icon: 'tune', label: 'Settings', i18nKey: 'admin.tabs.settings', route: '/admin/settings', allowedRoles: ['Admin'] },
            { icon: 'manage_search', label: 'Audit Log', i18nKey: 'admin.tabs.auditLog', route: '/admin/audit-log', allowedRoles: ['Admin'] },
            { icon: 'vpn_key', label: 'BI API Keys', i18nKey: 'admin.tabs.biApiKeys', route: '/admin/bi-api-keys', allowedRoles: ['Admin'] },
            { icon: 'edit_note', label: 'Time Corrections', i18nKey: 'admin.tabs.timeCorrections', route: '/admin/time-corrections', allowedRoles: ['Admin', 'Manager'] },
          ],
        },
      ],
    },
  ];

  readonly pinnedTopTree: Signal<NavItem[]> = computed(() => this.filterTree(this.allPinnedTopTree));
  readonly mainTree: Signal<NavItem[]> = computed(() => this.filterTree(this.allMainTree));
  readonly bottomTree: Signal<NavItem[]> = computed(() => this.filterTree(this.allBottomTree));

  /**
   * Full ancestor chain of the current URL, walking all groups (including
   * non-routePrefix groups). Used by the header breadcrumb so that e.g.
   * `/dashboard` shows `Operations > Dashboard` even though Operations
   * doesn't own the `/dashboard` URL prefix.
   */
  readonly breadcrumbTrail: Signal<NavItem[]> = computed(() => {
    const url = this.currentUrl();
    return this.findTrail([...this.mainTree(), ...this.bottomTree()], url, /*requirePrefix*/ false);
  });

  /**
   * Ancestor chain used by the sidebar to auto-drill into the current URL's
   * group on page load so the second tier (group's children) is visible. Uses
   * the same resolution as the breadcrumb — every nav group, not just those
   * with an explicit routePrefix — so e.g. /kanban lands on Operations'
   * children instead of the tier-1 group list. Manual drill-override still
   * wins between navigations (sidebar.drillPath() checks drillOverride first).
   */
  readonly drillTrail: Signal<NavItem[]> = computed(() => {
    const url = this.currentUrl();
    return this.findTrail([...this.mainTree(), ...this.bottomTree()], url, /*requirePrefix*/ false);
  });

  private filterTree(tree: NavItem[]): NavItem[] {
    return tree
      .filter(item => this.isAllowed(item))
      .map(item => ({
        ...item,
        children: item.children ? this.filterTree(item.children) : undefined,
      }))
      .filter(item => {
        if (!item.children) return true;
        return item.children.length > 0;
      });
  }

  private isAllowed(item: NavItem): boolean {
    if (!item.allowedRoles) return true;
    return this.auth.hasAnyRole(item.allowedRoles);
  }

  private findTrail(tree: NavItem[], url: string, requirePrefix: boolean, insideDrillable = false): NavItem[] {
    for (const item of tree) {
      if (item.children?.length) {
        if (requirePrefix && item.routePrefix && !this.urlMatchesPrefix(url, item.routePrefix)) continue;
        const isDrillable = insideDrillable || !!item.routePrefix;
        const childTrail = this.findTrail(item.children, url, requirePrefix, isDrillable);
        if (childTrail.length > 0) {
          if (requirePrefix) {
            return isDrillable ? [item, ...childTrail] : childTrail;
          }
          return [item, ...childTrail];
        }
      } else if (item.route && (item.route === url || url.startsWith(item.route + '/'))) {
        return [item];
      }
    }
    return [];
  }

  private urlMatchesPrefix(url: string, prefix: string): boolean {
    return url === prefix || url.startsWith(prefix + '/');
  }
}

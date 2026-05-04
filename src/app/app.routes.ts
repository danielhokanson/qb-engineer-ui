import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login.component';
import { SetupComponent } from './features/auth/setup.component';
import { TokenSetupComponent } from './features/auth/token-setup.component';
import { authGuard } from './shared/guards/auth.guard';
import { demoOnlyGuard } from './shared/guards/demo-only.guard';
import { mobileRedirectGuard } from './shared/guards/mobile-redirect.guard';
import { roleGuard } from './shared/guards/role.guard';
import { rootRedirectGuard } from './shared/guards/root-redirect.guard';
import { setupRequiredGuard, setupCompleteGuard } from './shared/guards/setup.guard';

export const routes: Routes = [
  { path: 'login', canActivate: [setupCompleteGuard], component: LoginComponent },
  { path: 'sso/callback', loadComponent: () => import('./features/auth/sso-callback.component').then(m => m.SsoCallbackComponent) },
  {
    path: 'welcome',
    canActivate: [demoOnlyGuard],
    loadComponent: () => import('./features/welcome/welcome.component').then(m => m.WelcomeComponent),
  },
  { path: 'setup', canActivate: [setupRequiredGuard], component: SetupComponent },
  { path: 'setup/:token', component: TokenSetupComponent },
  {
    path: 'chat/popout',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/chat/components/chat-popout/chat-popout.component').then(m => m.ChatPopoutComponent),
  },
  // Root branches on build target before authGuard runs so the demo's /welcome
  // page is reachable without login. In prod, the guard returns /dashboard and
  // the authGuard shell below takes over — same behavior as before.
  { path: '', pathMatch: 'full', canActivate: [rootRedirectGuard], children: [] },
  {
    path: '',
    canActivate: [authGuard, mobileRedirectGuard],
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        path: 'kanban',
        loadChildren: () =>
          import('./features/kanban/kanban.routes').then((m) => m.KANBAN_ROUTES),
      },
      {
        path: 'backlog',
        loadChildren: () =>
          import('./features/backlog/backlog.routes').then((m) => m.BACKLOG_ROUTES),
      },
      {
        path: 'calendar',
        loadChildren: () =>
          import('./features/calendar/calendar.routes').then((m) => m.CALENDAR_ROUTES),
      },
      {
        path: 'parts',
        canActivate: [roleGuard('Admin', 'Manager', 'Engineer', 'PM')],
        loadChildren: () =>
          import('./features/parts/parts.routes').then((m) => m.PARTS_ROUTES),
      },
      {
        path: 'inventory',
        canActivate: [roleGuard('Admin', 'Manager', 'Engineer', 'OfficeManager')],
        loadChildren: () =>
          import('./features/inventory/inventory.routes').then((m) => m.INVENTORY_ROUTES),
      },
      {
        path: 'customers',
        canActivate: [roleGuard('Admin', 'Manager', 'PM', 'OfficeManager')],
        loadChildren: () =>
          import('./features/customers/customers.routes').then((m) => m.CUSTOMERS_ROUTES),
      },
      {
        path: 'leads',
        canActivate: [roleGuard('Admin', 'Manager', 'PM')],
        loadChildren: () =>
          import('./features/leads/leads.routes').then((m) => m.LEADS_ROUTES),
      },
      {
        path: 'expenses',
        loadChildren: () =>
          import('./features/expenses/expenses.routes').then((m) => m.EXPENSES_ROUTES),
      },
      {
        path: 'assets',
        canActivate: [roleGuard('Admin', 'Manager')],
        loadChildren: () =>
          import('./features/assets/assets.routes').then((m) => m.ASSETS_ROUTES),
      },
      {
        path: 'time-tracking',
        loadChildren: () =>
          import('./features/time-tracking/time-tracking.routes').then((m) => m.TIME_TRACKING_ROUTES),
      },
      {
        path: 'employees',
        canActivate: [roleGuard('Admin', 'Manager')],
        loadChildren: () =>
          import('./features/employees/employees.routes').then((m) => m.EMPLOYEES_ROUTES),
      },
      {
        path: 'reports',
        canActivate: [roleGuard('Admin', 'Manager', 'PM')],
        loadChildren: () =>
          import('./features/reports/reports.routes').then((m) => m.REPORTS_ROUTES),
      },
      {
        path: 'planning',
        canActivate: [roleGuard('Admin', 'Manager', 'PM')],
        loadChildren: () =>
          import('./features/planning/planning.routes').then((m) => m.PLANNING_ROUTES),
      },
      {
        path: 'vendors',
        canActivate: [roleGuard('Admin', 'Manager', 'OfficeManager')],
        loadChildren: () =>
          import('./features/vendors/vendors.routes').then((m) => m.VENDORS_ROUTES),
      },
      {
        path: 'purchasing',
        canActivate: [roleGuard('Admin', 'Manager', 'OfficeManager')],
        loadChildren: () =>
          import('./features/purchasing/purchasing.routes').then((m) => m.PURCHASING_ROUTES),
      },
      {
        path: 'purchase-orders',
        canActivate: [roleGuard('Admin', 'Manager', 'OfficeManager')],
        loadChildren: () =>
          import('./features/purchase-orders/purchase-orders.routes').then((m) => m.PURCHASE_ORDERS_ROUTES),
      },
      {
        path: 'sales-orders',
        canActivate: [roleGuard('Admin', 'Manager', 'PM', 'OfficeManager')],
        loadChildren: () =>
          import('./features/sales-orders/sales-orders.routes').then((m) => m.SALES_ORDERS_ROUTES),
      },
      {
        path: 'quotes',
        canActivate: [roleGuard('Admin', 'Manager', 'PM', 'OfficeManager')],
        loadChildren: () =>
          import('./features/quotes/quotes.routes').then((m) => m.QUOTES_ROUTES),
      },
      {
        path: 'shipments',
        canActivate: [roleGuard('Admin', 'Manager', 'OfficeManager')],
        loadChildren: () =>
          import('./features/shipments/shipments.routes').then((m) => m.SHIPMENTS_ROUTES),
      },
      {
        path: 'invoices',
        canActivate: [roleGuard('Admin', 'Manager', 'OfficeManager')],
        loadChildren: () =>
          import('./features/invoices/invoices.routes').then((m) => m.INVOICES_ROUTES),
      },
      {
        path: 'payments',
        canActivate: [roleGuard('Admin', 'Manager', 'OfficeManager')],
        loadChildren: () =>
          import('./features/payments/payments.routes').then((m) => m.PAYMENTS_ROUTES),
      },
      {
        path: 'notifications',
        loadChildren: () =>
          import('./features/notifications/notifications.routes').then((m) => m.NOTIFICATION_ROUTES),
      },
      {
        path: 'worker',
        loadChildren: () =>
          import('./features/worker/worker.routes').then((m) => m.WORKER_ROUTES),
      },
      {
        path: 'approvals',
        canActivate: [roleGuard('Admin', 'Manager', 'PM', 'OfficeManager')],
        loadChildren: () =>
          import('./features/approvals/approvals.routes').then((m) => m.APPROVALS_ROUTES),
      },
      {
        path: 'quality',
        canActivate: [roleGuard('Admin', 'Manager', 'Engineer')],
        loadChildren: () =>
          import('./features/quality/quality.routes').then((m) => m.QUALITY_ROUTES),
      },
      {
        path: 'customer-returns',
        canActivate: [roleGuard('Admin', 'Manager', 'PM', 'OfficeManager')],
        loadChildren: () =>
          import('./features/customer-returns/customer-returns.routes').then((m) => m.CUSTOMER_RETURNS_ROUTES),
      },
      {
        path: 'lots',
        canActivate: [roleGuard('Admin', 'Manager', 'Engineer')],
        loadChildren: () =>
          import('./features/lots/lots.routes').then((m) => m.LOTS_ROUTES),
      },
      {
        path: 'account',
        loadChildren: () =>
          import('./features/account/account.routes').then((m) => m.ACCOUNT_ROUTES),
      },
      {
        path: 'onboarding',
        loadChildren: () =>
          import('./features/onboarding/onboarding.routes').then((m) => m.ONBOARDING_ROUTES),
      },
      {
        path: 'training',
        loadChildren: () =>
          import('./features/training/training.routes').then((m) => m.TRAINING_ROUTES),
      },
      {
        path: 'ai',
        loadChildren: () =>
          import('./features/ai/ai.routes').then((m) => m.AI_ROUTES),
      },
      {
        path: 'mrp',
        canActivate: [roleGuard('Admin', 'Manager')],
        loadChildren: () =>
          import('./features/mrp/mrp.routes').then((m) => m.MRP_ROUTES),
      },
      {
        path: 'oee',
        canActivate: [roleGuard('Admin', 'Manager')],
        loadChildren: () =>
          import('./features/oee/oee.routes').then((m) => m.OEE_ROUTES),
      },
      {
        path: 'scheduling',
        canActivate: [roleGuard('Admin', 'Manager')],
        loadChildren: () =>
          import('./features/scheduling/scheduling.routes').then((m) => m.SCHEDULING_ROUTES),
      },
      {
        path: 'chat',
        loadChildren: () =>
          import('./features/chat/chat.routes').then((m) => m.CHAT_ROUTES),
      },
      {
        path: 'admin',
        canActivate: [roleGuard('Admin', 'Manager', 'OfficeManager')],
        loadChildren: () =>
          import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      {
        // Workflow Pattern Phase 4 — demo route, no role gating (any
        // authenticated user can poke at the shell). Phase 5+ wires
        // per-entity workflow surfaces into their own routes.
        path: 'workflow-shell-demo',
        loadComponent: () =>
          import('./features/workflow-demo/workflow-shell-demo.component')
            .then(m => m.WorkflowShellDemoComponent),
      },
    ],
  },
  {
    path: 'm',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/mobile/mobile.routes').then((m) => m.MOBILE_ROUTES),
  },
  {
    path: 'display/shop-floor',
    loadChildren: () =>
      import('./features/shop-floor/shop-floor.routes').then((m) => m.SHOP_FLOOR_ROUTES),
  },
  {
    path: 'dev-tools',
    loadChildren: () =>
      import('./features/dev-tools/dev-tools.routes').then((m) => m.DEV_TOOLS_ROUTES),
  },
  {
    path: '__render-form',
    loadChildren: () =>
      import('./features/render/render.routes').then((m) => m.RENDER_ROUTES),
  },
];

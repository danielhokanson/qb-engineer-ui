import { Routes } from '@angular/router';
import { AdminComponent } from './admin.component';

export const ADMIN_ROUTES: Routes = [
  { path: '', redirectTo: 'users', pathMatch: 'full' },
  // Phase 4 Phase-A — diagnostic page that renders the loaded capability descriptor.
  // Listed before the catch-all `:tab` route so it wins. Phase C added the
  // working `/admin/capabilities` page below; the debug page stays as a
  // diagnostic and will be replaced/folded into Phase E's full admin UI.
  {
    path: 'capabilities-debug',
    loadComponent: () =>
      import('./capabilities-debug/capabilities-debug.component').then((m) => m.CapabilitiesDebugComponent),
  },
  // Phase 4 Phase-E — full admin capability management surface (replaces
  // Phase C minimum). List page at `/admin/capabilities`; per-capability
  // detail page at `/admin/capabilities/:id`. Detail route MUST be listed
  // before the `:tab` catch-all so the AdminComponent doesn't intercept the
  // capability code as a tab name. Both lazy-loaded.
  {
    path: 'capabilities',
    loadComponent: () =>
      import('./capabilities/capabilities.component').then((m) => m.CapabilitiesComponent),
  },
  {
    path: 'capabilities/:id',
    loadComponent: () =>
      import('./capability-detail/capability-detail.component').then(
        (m) => m.CapabilityDetailComponent,
      ),
  },
  // Phase 4 Phase-F — discovery wizard. Lazy-loaded; admin-only via the
  // server's [Authorize(Roles="Admin")] on the API endpoints. Routed before
  // the `:tab` catch-all so AdminComponent doesn't intercept it.
  {
    path: 'discovery',
    loadComponent: () =>
      import('./discovery/discovery.component').then((m) => m.DiscoveryComponent),
  },
  // Phase 4 Phase-G — preset browser + apply. Lazy-loaded admin-only routes.
  // Specific routes (compare, custom) listed BEFORE the :id catch-all so
  // their literal segments win over the dynamic route.
  {
    path: 'presets',
    loadComponent: () =>
      import('./presets/preset-browser/preset-browser.component').then((m) => m.PresetBrowserComponent),
  },
  {
    path: 'presets/compare',
    loadComponent: () =>
      import('./presets/preset-compare/preset-compare.component').then((m) => m.PresetCompareComponent),
  },
  {
    path: 'presets/custom',
    loadComponent: () =>
      import('./presets/preset-custom/preset-custom.component').then((m) => m.PresetCustomComponent),
  },
  {
    path: 'presets/:id',
    loadComponent: () =>
      import('./presets/preset-detail/preset-detail.component').then((m) => m.PresetDetailComponent),
  },
  // Phase-4 entity-completeness — admin CRUD over the requirement-row catalog
  // that drives the per-entity completeness chip + badge. Routed before the
  // `:tab` catch-all so AdminComponent doesn't intercept the literal segment.
  {
    path: 'entity-completeness',
    loadComponent: () =>
      import('./entity-completeness/entity-completeness-admin.component').then(
        (m) => m.EntityCompletenessAdminComponent,
      ),
  },
  // Bought-parts effort PR1 — working calendars + holidays. Drives every
  // business-day calculation in the system. Tenant-default + per-CompanyLocation
  // override; resolution at runtime via IWorkingCalendarService server-side.
  {
    path: 'working-calendars',
    loadComponent: () =>
      import('./working-calendars/working-calendars.component').then(
        (m) => m.WorkingCalendarsComponent,
      ),
  },
  { path: ':tab', component: AdminComponent },
];

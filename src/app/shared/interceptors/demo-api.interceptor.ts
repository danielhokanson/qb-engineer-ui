import { HttpEvent, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { DemoDataStore } from '../services/demo-data-store.service';
import { synthesizeAggregate } from './demo-aggregate-synth';
import { resolveDemoPath } from './demo-url-map';

type Row = Record<string, unknown> & { id?: number | string };

const PASS_THROUGH_PREFIXES = [
  '/demo-data/',
  '/assets/',
  'assets/',
  'data:',
  'blob:',
];

/**
 * Short-circuits all API calls in demo mode and synthesizes responses from
 * /demo-data/*.json. Must be registered FIRST in the interceptor chain so the
 * auth interceptor does not try to attach a Bearer token.
 *
 * Philosophy: tolerate everything. Unknown GET → []. Unknown write → echo
 * payload with synthetic id. Known auth → hand back a stub admin session.
 */
export const demoApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.demoMode) return next(req);

  const url = req.url;

  // Let static-asset and demo-data file reads go straight to HttpClient.
  if (PASS_THROUGH_PREFIXES.some(p => url.startsWith(p))) return next(req);
  if (/\.(json|png|jpe?g|svg|ico|woff2?|css|js)(\?|$)/i.test(url)) return next(req);

  // Absolute URLs that don't target this origin (GitHub API for version check, etc.)
  // must pass through — intercepting them would feed bogus demo shapes back to
  // code that expects real external responses.
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== window.location.origin) return next(req);
    } catch {
      // Fall through — malformed URL, let the interceptor handle it.
    }
  }

  const store = inject(DemoDataStore);

  // Auth endpoints — synthesize a logged-in admin session without ever hitting a server.
  const authResp = handleAuth(url, req.method, req.body);
  if (authResp) return ok(authResp);

  return defer(() => from(handleApi(store, req)));
};

function handleAuth(url: string, method: string, _body: unknown): unknown | null {
  const path = safePath(url);

  if (path.endsWith('/auth/login') || path.endsWith('/auth/kiosk-login') || path.endsWith('/auth/scan-login') || path.endsWith('/auth/complete-setup') || path.endsWith('/auth/setup')) {
    return loginResponse();
  }
  if (path.endsWith('/auth/refresh')) {
    return { token: demoToken(), expiresAt: isoPlus(60 * 60 * 8) };
  }
  if (path.endsWith('/auth/me')) {
    return demoUser();
  }
  if (path.endsWith('/auth/status')) {
    return { setupRequired: false, hasUsers: true };
  }
  if (path.endsWith('/auth/logout')) {
    return { success: true };
  }
  if (path.endsWith('/auth/sso/providers')) {
    return [];
  }
  if (path.includes('/auth/validate-token/')) {
    return { valid: false, email: null };
  }
  if (path.endsWith('/auth/set-pin')) {
    return { success: true };
  }

  // Accounting mode — demo is always standalone.
  if (path.endsWith('/admin/accounting-mode') && method === 'GET') {
    return { mode: 'standalone', providerId: null, isConfigured: false };
  }
  if (path.endsWith('/accounting/providers')) {
    return [];
  }

  // MFA scaffolding — demo never requires it.
  if (path.includes('/mfa/') || path.endsWith('/mfa')) {
    return { required: false, enabled: false };
  }

  return null;
}

async function handleApi(store: DemoDataStore, req: HttpRequest<unknown>): Promise<HttpEvent<unknown>> {
  // Try aggregate/computed endpoints first (dashboard, search, reports, admin/*, etc.).
  // Generic entity fallback runs only when this returns undefined.
  // Use urlWithParams so the synth sees the query string (HttpClient keeps params
  // separate from url until transport time).
  const aggregate = await synthesizeAggregate(store, req.method, req.urlWithParams);
  if (aggregate !== undefined) return httpOk(aggregate);

  const resolved = resolveDemoPath(req.url);

  // Unknown endpoint — give the UI a harmless shape.
  if (!resolved) return httpOk(emptyShapeForMethod(req.method));

  const { key, file, rest } = resolved;

  // No file mapping — return empty list for GETs, synthetic success for writes.
  if (!file) return httpOk(emptyShapeForMethod(req.method));

  const rows = await store.load(file);
  const filtered = applyQuoteTypeFilter(key, rows);

  // Trailing /:id or /:id/subresource.
  const idSegment = rest[0];
  const isById = idSegment !== undefined && /^\d+$/.test(idSegment);

  switch (req.method) {
    case 'GET': {
      if (isById) {
        const row = filtered.find(r => String(r.id) === idSegment);
        // Sub-resource on an entity (e.g. /jobs/42/subtasks) — return [] for now.
        if (rest.length > 1) return httpOk([]);
        return httpOk(row ?? null);
      }
      return httpOk(filtered);
    }
    case 'POST': {
      const body = (req.body ?? {}) as Row;
      const created = store.append(file, body);
      return httpOk(created, 201);
    }
    case 'PATCH':
    case 'PUT': {
      if (isById) {
        const updated = store.update(file, idSegment, (req.body ?? {}) as Row);
        return httpOk(updated ?? {});
      }
      return httpOk({});
    }
    case 'DELETE': {
      if (isById) store.remove(file, idSegment);
      return httpOk(null, 204);
    }
    default:
      return httpOk({});
  }
}

function applyQuoteTypeFilter(key: string, rows: Row[]): Row[] {
  if (key === 'estimates') return rows.filter(r => String(r['type']).toLowerCase() === 'estimate');
  if (key === 'quotes') return rows.filter(r => {
    const t = String(r['type'] ?? '').toLowerCase();
    return t === 'quote' || t === '';
  });
  return rows;
}

function emptyShapeForMethod(method: string): unknown {
  if (method === 'GET') return [];
  if (method === 'DELETE') return null;
  return {};
}

function ok<T>(body: T): Observable<HttpEvent<T>> {
  return of(new HttpResponse<T>({ status: 200, body }));
}

function httpOk<T>(body: T, status = 200): HttpEvent<T> {
  return new HttpResponse<T>({ status, body });
}

function safePath(url: string): string {
  try {
    return url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
  } catch {
    return url;
  }
}

function loginResponse(): unknown {
  return {
    token: demoToken(),
    expiresAt: isoPlus(60 * 60 * 8),
    user: demoUser(),
  };
}

function demoUser(): unknown {
  return {
    id: 1,
    email: 'demo@qb-engineer.com',
    firstName: 'Demo',
    lastName: 'Viewer',
    initials: 'DV',
    avatarColor: '#0d9488',
    roles: ['Admin', 'Manager', 'Engineer', 'OfficeManager', 'ProductionWorker'],
    profileComplete: true,
  };
}

/** Opaque non-JWT string — auth interceptor won't see it anyway in demo mode. */
function demoToken(): string {
  return 'demo-session-' + Math.random().toString(36).slice(2, 10);
}

function isoPlus(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { LayoutService } from '../services/layout.service';

const OWN_API_PATTERN = /^(\/api\/|https?:\/\/localhost)/;

/** URLs that should never trigger a refresh attempt. */
const NO_REFRESH_URLS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/setup', '/auth/complete-setup'];

let isRefreshing = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const layout = inject(LayoutService);
  const dialog = inject(MatDialog);
  const token = authService.token();
  const isOwnApi = OWN_API_PATTERN.test(req.url);

  const authReq = token && isOwnApi
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  /** Redirect to login preserving the current route as returnUrl. */
  const redirectToLogin = () => {
    authService.clearAuth();
    // Close any open MatDialog (detail dialogs, confirms, etc.) before
    // navigating away — without this they overlay the /login page since
    // the dialog overlay outlives the route change. Reported bug:
    // expired-session leaves the part-detail dialog visible on top of
    // the login form.
    dialog.closeAll();
    const currentUrl = router.url;
    const queryParams: Record<string, string> = { reason: 'session_expired' };
    // Preserve current route so user returns here after re-login
    if (currentUrl && currentUrl !== '/' && !layout.isAuthRoute()) {
      queryParams['returnUrl'] = currentUrl;
    }
    router.navigate(['/login'], { queryParams });
  };

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && isOwnApi && authService.isAuthenticated()) {
        // Don't attempt refresh for auth endpoints themselves
        if (NO_REFRESH_URLS.some(url => req.url.includes(url))) {
          redirectToLogin();
          return throwError(() => error);
        }

        // Prevent concurrent refresh attempts
        if (isRefreshing) {
          redirectToLogin();
          return throwError(() => error);
        }

        isRefreshing = true;
        return authService.refreshAccessToken().pipe(
          switchMap((newToken) => {
            isRefreshing = false;
            if (newToken) {
              // Retry the original request with the new token
              const retryReq = req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
              return next(retryReq);
            }
            // Refresh failed — session is gone
            redirectToLogin();
            return throwError(() => error);
          }),
          catchError((refreshError) => {
            isRefreshing = false;
            redirectToLogin();
            return throwError(() => refreshError);
          }),
        );
      }
      return throwError(() => error);
    }),
  );
};

import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { Observable, tap, catchError, of, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { SsoProvider } from '../models/sso-provider.model';
import { LinkedSsoProvider } from '../models/linked-sso-provider.model';

export interface AuthUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  initials: string | null;
  avatarColor: string | null;
  roles: string[];
  profileComplete: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
  mfaRequired?: boolean;
  mfaUserId?: number;
}

export interface SetupStatusResponse {
  setupRequired: boolean;
}

export interface SetupRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyEin?: string;
  companyWebsite?: string;
  locationName?: string;
  locationLine1?: string;
  locationLine2?: string;
  locationCity?: string;
  locationState?: string;
  locationPostalCode?: string;
}

export interface CompleteSetupRequest {
  token: string;
  password: string;
}

export interface SetupTokenInfo {
  firstName: string;
  lastName: string;
  email: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(MatDialog);
  private readonly _token = signal<string | null>(this.loadToken());
  private readonly _user = signal<AuthUser | null>(this.loadUser());

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._token() !== null);

  hasRole(role: string): boolean {
    return this._user()?.roles.includes(role) ?? false;
  }

  hasAnyRole(roles: string[]): boolean {
    const userRoles = this._user()?.roles ?? [];
    return roles.some(r => userRoles.includes(r));
  }

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/login`, credentials)
      .pipe(
        tap((response) => {
          // Don't persist auth when MFA verification is still needed
          if (response.mfaRequired) return;

          this._token.set(response.token);
          this._user.set(response.user);
          localStorage.setItem('qbe-token', response.token);
          localStorage.setItem('qbe-user', JSON.stringify(response.user));
        }),
      );
  }

  /** Complete auth after successful MFA validation. */
  completeMfaLogin(token: string): void {
    this._token.set(token);
    localStorage.setItem('qbe-token', token);
    // Fetch user profile from /me endpoint
    this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (user) => {
        this._user.set(user);
        localStorage.setItem('qbe-user', JSON.stringify(user));
      },
    });
  }

  checkSetupStatus(): Observable<SetupStatusResponse> {
    return this.http.get<SetupStatusResponse>(`${environment.apiUrl}/auth/status`);
  }

  setup(data: SetupRequest): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/setup`, data)
      .pipe(
        tap((response) => {
          this._token.set(response.token);
          this._user.set(response.user);
          localStorage.setItem('qbe-token', response.token);
          localStorage.setItem('qbe-user', JSON.stringify(response.user));
        }),
      );
  }

  validateSetupToken(token: string): Observable<SetupTokenInfo> {
    return this.http.get<SetupTokenInfo>(`${environment.apiUrl}/auth/validate-token/${encodeURIComponent(token)}`);
  }

  completeSetup(data: CompleteSetupRequest): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/complete-setup`, data)
      .pipe(
        tap((response) => {
          this._token.set(response.token);
          this._user.set(response.user);
          localStorage.setItem('qbe-token', response.token);
          localStorage.setItem('qbe-user', JSON.stringify(response.user));
        }),
      );
  }

  setPin(pin: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/auth/set-pin`, { pin });
  }

  kioskLogin(barcode: string, pin: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/kiosk-login`, { barcode, pin })
      .pipe(
        tap((response) => {
          this._token.set(response.token);
          this._user.set(response.user);
          localStorage.setItem('qbe-token', response.token);
          localStorage.setItem('qbe-user', JSON.stringify(response.user));
        }),
      );
  }

  /**
   * Unified scan login — works with any scan type (RFID, NFC, barcode, biometric).
   * Backend resolves the scan value against UserScanIdentifiers + EmployeeBarcode.
   */
  scanLogin(scanValue: string, pin: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/scan-login`, { scanValue, pin })
      .pipe(
        tap((response) => {
          this._token.set(response.token);
          this._user.set(response.user);
          localStorage.setItem('qbe-token', response.token);
          localStorage.setItem('qbe-user', JSON.stringify(response.user));
        }),
      );
  }

  getSsoProviders(): Observable<SsoProvider[]> {
    return this.http.get<SsoProvider[]>(`${environment.apiUrl}/auth/sso/providers`).pipe(
      catchError(() => of([])),
    );
  }

  ssoLogin(provider: string): void {
    window.location.href = `${environment.apiUrl}/auth/sso/${provider}/login`;
  }

  handleSsoToken(token: string): void {
    this._token.set(token);
    localStorage.setItem('qbe-token', token);
    // Fetch user profile from /me endpoint to populate user signal
    this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (user) => {
        this._user.set(user);
        localStorage.setItem('qbe-user', JSON.stringify(user));
      },
      error: () => {
        // SSO token was valid but /me failed — clear stale state
        this._token.set(null);
        localStorage.removeItem('qbe-token');
      },
    });
  }

  getLinkedSsoProviders(): Observable<LinkedSsoProvider[]> {
    return this.http.get<LinkedSsoProvider[]>(`${environment.apiUrl}/auth/sso/linked`);
  }

  unlinkSso(provider: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/auth/sso/unlink/${provider}`);
  }

  /** Attempt to refresh the current token. Returns the new token or null on failure. */
  refreshAccessToken(): Observable<string | null> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/refresh`, {}).pipe(
      tap((response) => {
        this._token.set(response.token);
        this._user.set(response.user);
        localStorage.setItem('qbe-token', response.token);
        localStorage.setItem('qbe-user', JSON.stringify(response.user));
      }),
      map((response) => response.token),
      catchError(() => of(null)),
    );
  }

  async logout(): Promise<void> {
    // Run before-logout checks (e.g., draft warning dialog)
    if (this._beforeLogout) {
      const proceed = await this._beforeLogout();
      if (!proceed) return;
    }

    // Notify server to revoke the session (fire-and-forget)
    this.http.post(`${environment.apiUrl}/auth/logout`, {}).pipe(catchError(() => of(null))).subscribe();

    this.clearAuth();
    this._broadcastLogout?.();
  }

  clearAuth(): void {
    this._token.set(null);
    this._user.set(null);
    localStorage.removeItem('qbe-token');
    localStorage.removeItem('qbe-user');
    // Close any open MatDialog (detail dialogs, confirms, etc.) — every
    // auth-loss path funnels through here (interceptor 401 redirect,
    // explicit logout, cross-tab broadcast, SignalR auth failure, kiosk
    // reset), so this is the single chokepoint that prevents an
    // overlay from leaking onto /login. Reported bug: detail dialog
    // stayed visible over the login page after the user was logged out.
    this.dialog.closeAll();
  }

  /** Update local user state after self-service profile edit. */
  refreshUser(updated: Partial<AuthUser>): void {
    const current = this._user();
    if (!current) return;
    const merged = { ...current, ...updated };
    this._user.set(merged);
    localStorage.setItem('qbe-user', JSON.stringify(merged));
  }

  /** Set by BroadcastService to avoid circular dependency. */
  private _broadcastLogout?: () => void;
  /** Set by DraftRecoveryService to check for unsaved drafts before logout. */
  private _beforeLogout?: () => Promise<boolean>;

  /** @internal Used by BroadcastService to register the broadcast callback. */
  registerBroadcastCallback(fn: () => void): void {
    this._broadcastLogout = fn;
  }

  /** @internal Used by DraftRecoveryService to register before-logout check. */
  registerBeforeLogoutCallback(fn: () => Promise<boolean>): void {
    this._beforeLogout = fn;
  }

  private loadToken(): string | null {
    return localStorage.getItem('qbe-token');
  }

  private loadUser(): AuthUser | null {
    const raw = localStorage.getItem('qbe-user');
    return raw ? JSON.parse(raw) : null;
  }
}

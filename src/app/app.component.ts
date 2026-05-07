import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, computed, effect, inject, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

import { AppHeaderComponent } from './core/layout/app-header.component';
import { SidebarComponent } from './core/layout/sidebar.component';
import { ToastContainerComponent } from './shared/components/toast/toast.component';
import { ConnectionBannerComponent } from './shared/components/connection-banner/connection-banner.component';
import { AnnouncementOverlayComponent } from './shared/components/announcement-overlay/announcement-overlay.component';
import { OnboardingBannerComponent } from './shared/components/onboarding-banner/onboarding-banner.component';
import { ChatPreviewPopupComponent } from './shared/components/chat-preview-popup/chat-preview-popup.component';
import { OfflineBannerComponent } from './shared/components/offline-banner/offline-banner.component';
import { LoadingOverlayComponent } from './shared/components/loading-overlay/loading-overlay.component';
import { KeyboardShortcutsHelpComponent } from './shared/components/keyboard-shortcuts-help/keyboard-shortcuts-help.component';
import { DemoMarkerComponent } from './shared/components/demo-marker/demo-marker.component';
import { initDemoMode } from './shared/utils/demo-mode.utils';
import { SyncConflictDialogComponent, SyncConflictDialogData } from './shared/components/sync-conflict-dialog/sync-conflict-dialog.component';
import { SyncConflict, SyncConflictResolution } from './shared/models/sync-conflict.model';
import { AuthService } from './shared/services/auth.service';
import { LayoutService } from './shared/services/layout.service';
import { SignalrService } from './shared/services/signalr.service';
import { NotificationHubService } from './shared/services/notification-hub.service';
import { ChatHubService } from './shared/services/chat-hub.service';
import { NotificationService } from './shared/services/notification.service';
import { UserPreferencesService } from './shared/services/user-preferences.service';
import { LoadingService } from './shared/services/loading.service';
import { RouteLoadingService } from './shared/services/route-loading.service';
import { ThemeService } from './shared/services/theme.service';
import { HelpTourService } from './shared/services/help-tour.service';
import { AccountingService } from './shared/services/accounting.service';
import { KeyboardShortcutsService } from './shared/services/keyboard-shortcuts.service';
import { BroadcastService } from './shared/services/broadcast.service';
import { LanguageService } from './shared/services/language.service';
import { ScannerService } from './shared/services/scanner.service';
import { OfflineQueueService } from './shared/services/offline-queue.service';
import { DraftRecoveryService } from './shared/services/draft-recovery.service';
import { DraftBroadcastService } from './shared/services/draft-broadcast.service';
import { AnnouncementService } from './shared/services/announcement.service';
import { CapabilityService } from './shared/services/capability.service';
import { CurrencyService } from './shared/services/currency.service';
import { EmployeeProfileService } from './features/account/services/employee-profile.service';
import { TrainingService } from './features/training/services/training.service';
import { WalkthroughContent } from './features/training/models/walkthrough-content.model';
import { DriverStep } from './shared/services/help-tour.service';
import { createTourSvg, clearTourConnector, updateTourConnector, attachScrollRefresh, setupPopoverDraggable } from './shared/utils/tour-connector.utils';
import { KANBAN_TOUR } from './shared/tours/kanban-tour';
import { DASHBOARD_TOUR } from './shared/tours/dashboard-tour';
import { PARTS_TOUR } from './shared/tours/parts-tour';
import { INVENTORY_TOUR } from './shared/tours/inventory-tour';
import { EXPENSES_TOUR } from './shared/tours/expenses-tour';
import { TIME_TRACKING_TOUR } from './shared/tours/time-tracking-tour';
import { REPORTS_TOUR } from './shared/tours/reports-tour';
import { ADMIN_TOUR } from './shared/tours/admin-tour';
import { PLANNING_TOUR } from './shared/tours/planning-tour';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TranslatePipe, AppHeaderComponent, SidebarComponent, ToastContainerComponent, ConnectionBannerComponent, AnnouncementOverlayComponent, OnboardingBannerComponent, OfflineBannerComponent, LoadingOverlayComponent, KeyboardShortcutsHelpComponent, ChatPreviewPopupComponent, DemoMarkerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly layout = inject(LayoutService);
  private readonly signalr = inject(SignalrService);
  private readonly notificationHub = inject(NotificationHubService);
  private readonly chatHub = inject(ChatHubService);
  private readonly notificationService = inject(NotificationService);
  private readonly userPreferences = inject(UserPreferencesService);
  private readonly loadingService = inject(LoadingService);
  private readonly routeLoading = inject(RouteLoadingService);
  private readonly themeService = inject(ThemeService);
  private readonly helpTours = inject(HelpTourService);
  private readonly accountingService = inject(AccountingService);
  private readonly keyboardShortcuts = inject(KeyboardShortcutsService);
  private readonly broadcast = inject(BroadcastService);
  private readonly languageService = inject(LanguageService);
  private readonly scanner = inject(ScannerService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly draftRecovery = inject(DraftRecoveryService);
  private readonly draftBroadcast = inject(DraftBroadcastService);
  private readonly announcementService = inject(AnnouncementService);
  private readonly capabilityService = inject(CapabilityService);
  private readonly currencyService = inject(CurrencyService);
  private readonly employeeProfile = inject(EmployeeProfileService);
  private readonly trainingService = inject(TrainingService);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);

  /** Prevents double-launching an inline tour on direct ?walkthrough= navigation. */
  private walkthroughRunning = false;

  /** Tracks whether the user was ever authenticated in this session. Only a
   *  true→false transition should push to /login (session expiry / logout).
   *  On initial boot with no token, the route guards decide the destination —
   *  the effect must not pre-empt the demo's rootRedirectGuard → /welcome. */
  private wasAuthenticated = false;

  protected readonly showShell = computed(() => this.authService.isAuthenticated() && !this.layout.isDisplayRoute() && !this.layout.isAuthRoute());
  protected readonly isGlobalLoading = this.loadingService.isLoading;

  constructor() {
    // Reactively connect/disconnect hubs based on auth state
    effect(() => {
      if (this.authService.isAuthenticated()) {
        // Hub connections + non-capability-gated init runs immediately —
        // these don't depend on the capability descriptor.
        this.notificationHub.connect();
        this.chatHub.connect();
        this.userPreferences.load();
        this.scanner.start();
        this.draftRecovery.onLogin();

        // Capability descriptor MUST resolve before any capability-gated
        // service makes HTTP calls. Otherwise the layer-3 interceptor can't
        // short-circuit (isKnown returns false on an unloaded descriptor)
        // and gated calls 403 before layer 2 catches them as red console
        // errors. Chaining via the load() Observable closes the race.
        this.capabilityService.load().subscribe({
          next: () => {
            this.notificationService.load();
            this.accountingService.load();
            this.employeeProfile.load();
            this.announcementService.loadActive();
            // Base currency — load once after auth so currency-display can
            // disambiguate non-base currencies inline. Failures fall back
            // to USD inside the service; no need to chain anything.
            this.currencyService.load().subscribe();
          },
        });
        this.wasAuthenticated = true;
      } else {
        this.capabilityService.clear();
        this.signalr.stopAll();
        // Don't stop the scanner on display/kiosk routes — they manage their own scanner lifecycle
        if (!this.layout.isDisplayRoute()) {
          this.scanner.stop();
        }
        // Only push to /login on a true→false transition (session expiry, logout).
        // On initial boot, wasAuthenticated is still false — let the route guards
        // (rootRedirectGuard, authGuard) decide where to send the user. Otherwise
        // this effect's setTimeout races with and clobbers the demo's root→/welcome
        // redirect.
        if (this.wasAuthenticated && !this.layout.isAuthRoute() && !this.layout.isDisplayRoute()) {
          setTimeout(() => this.router.navigate(['/login']));
        }
        this.wasAuthenticated = false;
      }
    });

    // Watch for sync conflicts and open resolution dialog
    effect(() => {
      const conflict = this.offlineQueue.conflict();
      if (conflict) {
        this.openConflictDialog(conflict);
      }
    });
  }

  ngOnInit(): void {
    initDemoMode();
    this.routeLoading.initialize();
    this.broadcast.initialize();
    this.draftBroadcast.initialize();
    this.languageService.initialize();

    // Register before-logout callback for draft warning
    this.authService.registerBeforeLogoutCallback(() => this.draftRecovery.checkBeforeLogout());
    this.themeService.loadBrandSettings();
    this.registerTours();
    this.keyboardShortcuts.initialize();
    this.watchWalkthroughUrl();
  }

  ngOnDestroy(): void {
    this.signalr.stopAll();
    this.keyboardShortcuts.destroy();
    this.scanner.stop();
    this.draftRecovery.cancelTtlCheck();
  }

  private openConflictDialog(conflict: SyncConflict): void {
    this.dialog.open<SyncConflictDialogComponent, SyncConflictDialogData, SyncConflictResolution>(
      SyncConflictDialogComponent,
      {
        width: '520px',
        disableClose: true,
        data: { conflict },
      }
    ).afterClosed().subscribe(resolution => {
      switch (resolution) {
        case 'keep-mine':
          this.offlineQueue.resolveConflictKeepMine(conflict.entryId);
          break;
        case 'keep-server':
          this.offlineQueue.resolveConflictKeepServer(conflict.entryId);
          break;
        default:
          this.offlineQueue.resolveConflictCancel();
          break;
      }
    });
  }

  /**
   * Resumes tours on page reload / direct URL entry.
   *
   * `?tutorial=<id>` — HelpTourService (contextual help tours from the header AI panel)
   * `?walkthrough=<moduleId>` — inline driver.js (training module walkthroughs).
   *   Training-module.component handles the normal start flow; this method handles
   *   direct navigation to `<targetPage>?walkthrough=<id>` without going through the
   *   training UI first.
   */
  private watchWalkthroughUrl(): void {
    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e: NavigationEnd) => {
        const url = this.router.parseUrl((e as NavigationEnd).urlAfterRedirects ?? (e as NavigationEnd).url);
        if (!this.authService.isAuthenticated()) return;

        // ── ?tutorial= — contextual help tours ──────────────────────────────
        const tutorialParam = url.queryParams['tutorial'];
        if (tutorialParam) {
          const moduleId = Number(tutorialParam);
          if (!isNaN(moduleId) && !this.helpTours.isRunning) {
            setTimeout(() => {
              if (this.helpTours.isRunning) return;
              this.trainingService.getModule(moduleId).subscribe({
                next: module => {
                  if (module.contentType !== 'Walkthrough') return;
                  try {
                    const content = JSON.parse(module.contentJson) as WalkthroughContent;
                    this.helpTours.startSteps(content.steps, tutorialParam);
                  } catch { /* malformed JSON — ignore */ }
                },
              });
            }, 800);
          }
        }

        // ── ?walkthrough= — training module walkthroughs ────────────────────
        const walkthroughParam = url.queryParams['walkthrough'];
        if (walkthroughParam) {
          const moduleId = Number(walkthroughParam);
          if (!isNaN(moduleId)) {
            setTimeout(() => {
              // Skip if training-module.component already launched its own tour
              if (document.querySelector('.driver-popover') || this.walkthroughRunning) return;
              this.trainingService.getModule(moduleId).subscribe({
                next: module => {
                  if (module.contentType !== 'Walkthrough') return;
                  try {
                    const content = JSON.parse(module.contentJson) as WalkthroughContent;
                    this.startInlineWalkthrough(content.steps, moduleId);
                  } catch { /* malformed JSON — ignore */ }
                },
              });
            }, 800);
          }
        }
      });
  }

  /**
   * Starts an inline driver.js walkthrough tour without navigating.
   * Used when resuming a training walkthrough from a direct URL or page reload.
   */
  private startInlineWalkthrough(steps: DriverStep[], moduleId: number): void {
    this.walkthroughRunning = true;
    const svg = createTourSvg();
    document.body.appendChild(svg);
    const removeScrollRefresh = attachScrollRefresh(svg);
    const router = this.router;
    const trainingService = this.trainingService;
    const ngZone = this.ngZone;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.walkthroughRunning = false;
      removeScrollRefresh();
      svg.remove();
    };

     
    import('driver.js').then(({ driver }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (driver as any)({
        animate: true,
        overlayOpacity: 0,
        popoverOffset: 20,
        allowClose: true,
        popoverClass: 'qb-tour-popover',
        doneBtnText: '<span class="material-icons-outlined" aria-hidden="true">check</span>Done',
        onHighlighted: () => {
          requestAnimationFrame(() => {
            updateTourConnector(svg, { center: true });
            setupPopoverDraggable();
          });
        },
        onDeselected: () => {
          clearTourConnector(svg);
        },
        onNextClick: () => {
          if (d.hasNextStep()) {
            d.moveNext();
          } else {
            cleanup();
            ngZone.run(() => {
              trainingService.completeModule(moduleId).subscribe({
                error: () => { /* swallow — navigation proceeds regardless */ },
              });
              router.navigateByUrl(`/training/module/${moduleId}`);
            });
            setTimeout(() => d.destroy(), 0);
          }
        },
        onDestroyed: () => {
          cleanup();
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      d.setSteps(steps as any);
      d.drive();
    }).catch(() => { /* driver.js not available */ });
  }

  private registerTours(): void {
    [KANBAN_TOUR, DASHBOARD_TOUR, PARTS_TOUR, INVENTORY_TOUR,
     EXPENSES_TOUR, TIME_TRACKING_TOUR, REPORTS_TOUR, ADMIN_TOUR, PLANNING_TOUR]
      .forEach(t => this.helpTours.register(t));
  }
}

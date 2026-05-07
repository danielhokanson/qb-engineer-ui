import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, HostBinding, inject, OnDestroy, OnInit, Renderer2, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, forkJoin, interval, of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { environment } from '../../../environments/environment';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { InputComponent } from '../../shared/components/input/input.component';
import { KioskSearchBarComponent } from './components/kiosk-search-bar/kiosk-search-bar.component';
import { KioskSessionBarComponent } from './components/kiosk-session-bar/kiosk-session-bar.component';
import { KioskSetupComponent } from './components/kiosk-setup/kiosk-setup.component';
import { TrainingModeBannerComponent } from './components/training-mode-banner/training-mode-banner.component';
import { KioskSessionService } from '../../shared/services/kiosk-session.service';
import { ShopFloorService } from './services/shop-floor.service';
import { ClockEventTypeService } from '../../shared/services/clock-event-type.service';
import { EventsService } from '../events/services/events.service';
import { AppEvent } from '../events/models/event.model';
import { AuthService } from '../../shared/services/auth.service';
import { ScannerService } from '../../shared/services/scanner.service';
import { LoadingService } from '../../shared/services/loading.service';
import { ShopFloorOverview, ShopFloorJob } from './models/shop-floor-overview.model';
import { ClockWorker } from './models/clock-worker.model';
import { PurchaseOrderService } from '../purchase-orders/services/purchase-order.service';
import { PurchaseOrderDetail } from '../purchase-orders/models/purchase-order-detail.model';
import { PurchaseOrderLine } from '../purchase-orders/models/purchase-order-line.model';
import { InventoryService } from '../inventory/services/inventory.service';
import { ShipmentService } from '../shipments/services/shipment.service';
import { ShipmentListItem } from '../shipments/models/shipment-list-item.model';
import { ShipmentDetail } from '../shipments/models/shipment-detail.model';
import { SelectComponent, SelectOption } from '../../shared/components/select/select.component';
import { ScanUndoListComponent } from './components/scan-undo-list/scan-undo-list.component';
import { ScanActionOverlayComponent } from './components/scan-action-overlay/scan-action-overlay.component';
import { ScanDailyLogComponent } from './components/scan-daily-log/scan-daily-log.component';
import { ScanDevicesPanelComponent } from './components/scan-devices-panel/scan-devices-panel.component';
import { ScanLocationViewComponent } from './components/scan-location-view/scan-location-view.component';
import { NumericKeypadComponent } from './components/numeric-keypad/numeric-keypad.component';

const FONT_SIZES = [12, 14, 16, 18, 20] as const;

const REFRESH_INTERVAL_MS = 15_000;
const AUTO_LOGOUT_MS = 30_000;
const PIN_TIMEOUT_MS = 20_000;
const JOB_SELECT_TIMEOUT_MS = 15_000;

type DisplayPhase = 'main' | 'pin' | 'actions' | 'job-select' | 'receiving' | 'shipping';

@Component({
  selector: 'app-shop-floor-display',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, AvatarComponent, InputComponent, SelectComponent, KioskSearchBarComponent, KioskSessionBarComponent, KioskSetupComponent, TrainingModeBannerComponent, ScanUndoListComponent, ScanActionOverlayComponent, ScanDailyLogComponent, ScanDevicesPanelComponent, ScanLocationViewComponent, NumericKeypadComponent],
  templateUrl: './shop-floor-display.component.html',
  styleUrl: './shop-floor-display.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopFloorDisplayComponent implements OnInit, OnDestroy {
  private readonly renderer = inject(Renderer2);

  // Theme toggle (light/dark) — persisted to localStorage
  protected readonly theme = signal<'light' | 'dark'>(
    (localStorage.getItem('sf-theme') as 'light' | 'dark') || 'light',
  );
  @HostBinding('attr.data-theme') get dataTheme() { return this.theme(); }

  // Snapshot the main site's <html data-theme> so we can restore it on destroy.
  // While the kiosk is active we push the shop-floor theme to <html> as well —
  // CDK overlays (dialogs, toasts, dropdowns) render outside this host and would
  // otherwise inherit the main site's theme instead of the kiosk's.
  private readonly originalHtmlTheme: string | null = document.documentElement.getAttribute('data-theme');

  // Font size scaling — persisted to localStorage
  protected readonly fontSizeIndex = signal(
    Math.max(0, Math.min(FONT_SIZES.length - 1, parseInt(localStorage.getItem('sf-font-index') ?? '0', 10) || 0)),
  );
  protected readonly fontSize = computed(() => FONT_SIZES[this.fontSizeIndex()]);

  private readonly shopFloorService = inject(ShopFloorService);
  private readonly authService = inject(AuthService);
  private readonly scanner = inject(ScannerService);
  protected readonly loading = inject(LoadingService);
  protected readonly clockTypes = inject(ClockEventTypeService);
  private readonly poService = inject(PurchaseOrderService);
  private readonly inventoryService = inject(InventoryService);
  private readonly shipmentService = inject(ShipmentService);
  private readonly eventsService = inject(EventsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  protected readonly kioskSession = inject(KioskSessionService);

  // Training mode — when enabled, actions are simulated (no backend calls)
  protected readonly trainingMode = signal(false);

  // Data
  protected readonly overview = signal<ShopFloorOverview | null>(null);
  protected readonly upcomingEvents = signal<AppEvent[]>([]);
  protected readonly workers = signal<ClockWorker[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly clockDisplay = signal('');

  // Pairing gate — true when this device has no kiosk device token (or the
  // token was revoked). Shows the admin setup flow instead of attempting to
  // load shop-floor data (which would 401).
  protected readonly isUnpaired = signal(!localStorage.getItem('qbe-kiosk-device-token'));

  // Live elapsed times — recomputed every second via tick signal
  private readonly tick = signal(0);
  protected readonly workerTimes = computed(() => {
    this.tick(); // subscribe to tick
    const now = Date.now();
    const map: Record<number, string> = {};
    for (const w of this.workers()) {
      if (w.statusSince) {
        const elapsed = now - new Date(w.statusSince).getTime();
        map[w.userId] = this.formatDuration(elapsed);
      } else {
        map[w.userId] = w.timeOnTask;
      }
    }
    return map;
  });

  // Computed worker groups (using ClockEventTypeService for status checks)
  protected readonly workersIn = computed(() => this.workers().filter(w => this.clockTypes.isWorking(w.status)));
  protected readonly workersOnBreak = computed(() => this.workers().filter(w => this.clockTypes.isOnBreakOrLunch(w.status)));
  protected readonly workersOut = computed(() => this.workers().filter(w => this.clockTypes.isClockedOut(w.status)));
  protected readonly activeWorkers = computed(() => this.workers().filter(w => this.clockTypes.isActive(w.status)));
  protected readonly inactiveWorkers = computed(() => this.workers().filter(w => this.clockTypes.isClockedOut(w.status)));
  protected readonly activeJobs = computed(() => this.overview()?.activeJobs ?? []);
  protected readonly unassignedJobs = computed(() =>
    this.activeJobs().filter(j => !j.assigneeId),
  );
  protected readonly completedToday = computed(() => this.overview()?.completedToday ?? 0);
  protected readonly maxVisibleJobs = 4;
  protected readonly maintenanceAlerts = computed(() => this.overview()?.maintenanceAlerts ?? 0);

  // Phase state
  protected readonly phase = signal<DisplayPhase>('main');
  protected readonly selectedWorker = signal<ClockWorker | null>(null);

  // Auth state (scan → PIN, card tap → password)
  protected readonly scannedValue = signal<string | null>(null);
  protected readonly isPasswordAuth = computed(() => this.scannedValue() === null);
  protected readonly pinControl = new FormControl('');
  protected readonly pinError = signal<string | null>(null);
  protected readonly authenticating = signal(false);

  // Action state
  protected readonly processing = signal<string | null>(null);
  protected readonly actionFeedback = signal<{ workerId: number; success: boolean } | null>(null);

  // Job selection state (shown after clock-in if worker has no assignments)
  protected readonly jobSelectWorker = signal<ClockWorker | null>(null);

  // Receiving state
  protected readonly receivablePOs = signal<PurchaseOrderDetail[]>([]);
  protected readonly selectedPO = signal<PurchaseOrderDetail | null>(null);
  protected readonly receivingLines = signal<{ line: PurchaseOrderLine; receiveQty: number }[]>([]);
  protected readonly receivingSubmitting = signal(false);
  protected readonly binLocationOptions = signal<SelectOption[]>([]);
  protected readonly receiveBinId = new FormControl<number | null>(null);

  // Shipping state
  protected readonly shippableShipments = signal<ShipmentListItem[]>([]);
  protected readonly selectedShipment = signal<ShipmentDetail | null>(null);
  protected readonly shippingSubmitting = signal(false);

  // Drag-and-drop state
  protected readonly draggingJobId = signal<number | null>(null);
  protected readonly dropTargetUserId = signal<number | null>(null);

  // Role-based UI gating
  private readonly RECEIVE_ROLES = new Set(['Admin', 'Manager', 'OfficeManager', 'Engineer', 'ProductionWorker']);
  private readonly SHIP_ROLES = new Set(['Admin', 'Manager', 'OfficeManager']);
  protected readonly canReceive = computed(() => {
    const worker = this.selectedWorker();
    return worker ? this.RECEIVE_ROLES.has(worker.role) && this.clockTypes.isActive(worker.status) : false;
  });
  protected readonly canShip = computed(() => {
    const worker = this.selectedWorker();
    return worker ? this.SHIP_ROLES.has(worker.role) && this.clockTypes.isActive(worker.status) : false;
  });

  // Undo panel
  protected readonly undoPanelOpen = signal(false);

  // Daily log panel
  protected readonly showDailyLog = signal(false);

  // Devices panel
  protected readonly showDevicesPanel = signal(false);

  // Location scan state
  protected readonly scannedLocationId = signal<number | null>(null);
  protected readonly scannedLocationName = signal<string | null>(null);

  // Scan feedback
  protected readonly scanFeedback = signal<string | null>(null);

  private readonly elRef = inject(ElementRef);

  private autoLogoutTimer: ReturnType<typeof setTimeout> | null = null;
  private phaseTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Auto-focus PIN field when entering PIN phase
  private readonly pinFocusEffect = effect(() => {
    if (this.phase() === 'pin') {
      setTimeout(() => {
        const input = (this.elRef.nativeElement as HTMLElement).querySelector('.sf-auth-card__field input') as HTMLInputElement | null;
        input?.focus();
      }, 50);
    }
  });

  // Passive scan listener — reacts to ScannerService signals
  private readonly scanEffect = effect(() => {
    const scan = this.scanner.lastScan();
    if (!scan || scan.context !== 'shop-floor') return;
    this.scanner.clearLastScan();

    // Only handle scans on the main dashboard — ignore during overlays
    if (this.phase() !== 'main') return;

    this.handleScanValue(scan.value);
  });

  // Mirror the shop-floor theme onto <html> so CDK overlays (dialogs, toasts,
  // dropdowns) inherit the kiosk theme rather than the main site's theme.
  private readonly htmlThemeEffect = effect(() => {
    document.documentElement.setAttribute('data-theme', this.theme());
  });

  ngOnInit(): void {
    this.authService.clearAuth();
    this.updateClock();

    // If this device isn't paired yet, skip all data loads — the template
    // renders the kiosk-setup gate instead. loadData() would 401 anyway.
    if (!this.isUnpaired()) {
      this.clockTypes.load();
      this.loadData();
    }

    // Apply persisted font size zoom
    if (this.fontSizeIndex() > 0) {
      this.applyFontSize();
    }

    // Start passive scanner — listens to keyboard-wedge / RFID on document, no focus needed.
    // Use restart() to guarantee the listener is active regardless of auth effect timing
    // (clearAuth() above triggers the auth effect asynchronously, which may call scanner.stop()).
    this.scanner.setContext('shop-floor');
    this.scanner.restart();

    interval(REFRESH_INTERVAL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.phase() === 'main' && !this.isUnpaired()) this.loadData();
      });

    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateClock());
  }

  ngOnDestroy(): void {
    this.scanner.stop();
    // Restore the main site's <html data-theme> so leaving the kiosk doesn't
    // leak the kiosk's theme back into the main app shell.
    if (this.originalHtmlTheme === null) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', this.originalHtmlTheme);
    }
  }

  // ─── Scan Handling ───

  private handleScanValue(scanValue: string): void {
    // Identify the scan via API — could be employee badge, RFID, or job barcode
    this.shopFloorService.identifyScan(scanValue).subscribe({
      next: (result) => {
        if (result.scanType === 'employee') {
          const worker = this.workers().find(w => w.userId === result.entityId);
          if (worker) {
            this.enterPinPhase(worker, scanValue);
          } else {
            this.showScanFeedback('Employee not found in current team');
          }
        } else if (result.scanType === 'job') {
          this.showScanFeedback(`Job ${result.entityNumber} — ${result.entityTitle}`);
        } else if (result.scanType === 'storage-location') {
          this.scannedLocationId.set(result.entityId ?? null);
          this.scannedLocationName.set(result.entityTitle ?? result.entityNumber ?? 'Unknown');
        } else if (result.scanType === 'sales-order') {
          this.showScanFeedback(`Sales Order ${result.entityNumber} — tap your badge to ship`);
        } else {
          this.showScanFeedback(`Scan not recognized: ${scanValue}`);
        }
      },
      error: () => {
        // Identification failed — treat as badge scan anyway (fallback)
        this.scannedValue.set(scanValue);
        this.pinControl.reset();
        this.pinError.set(null);
        this.phase.set('pin');
      },
    });
  }

  private showScanFeedback(message: string): void {
    this.scanFeedback.set(message);
    setTimeout(() => this.scanFeedback.set(null), 4000);
  }

  // ─── Worker Selection (tap on card → PIN) ───

  protected selectWorker(worker: ClockWorker): void {
    // Tapping a card identifies the worker — still need PIN to authenticate
    this.enterPinPhase(worker, null);
  }

  private enterPinPhase(worker: ClockWorker, scanValue: string | null): void {
    this.selectedWorker.set(worker);
    this.scannedValue.set(scanValue);
    this.pinControl.reset();
    this.pinError.set(null);
    this.phase.set('pin');
    this.startPhaseTimeout(PIN_TIMEOUT_MS);
  }

  // ─── PIN Auth ───

  protected onPinSubmit(): void {
    this.clearPhaseTimeout(); // User is actively submitting
    const credential = this.pinControl.value?.trim();
    const scanValue = this.scannedValue();
    const worker = this.selectedWorker();

    if (scanValue) {
      // Scan-based auth: scanValue + PIN
      if (!credential || credential.length < 4) {
        this.pinError.set('PIN must be at least 4 digits');
        return;
      }
      this.authenticating.set(true);
      this.pinError.set(null);
      this.authService.scanLogin(scanValue, credential).subscribe({
        next: () => {
          this.authenticating.set(false);
          this.enterActionsPhase();
        },
        error: () => {
          this.authenticating.set(false);
          this.pinError.set('Invalid badge or PIN');
        },
      });
    } else if (worker) {
      // Card-tap auth: full password required
      if (!credential || credential.length < 1) {
        this.pinError.set('Password is required');
        return;
      }
      this.authenticating.set(true);
      this.pinError.set(null);
      this.authService.login({ email: worker.email, password: credential }).subscribe({
        next: () => {
          this.authenticating.set(false);
          this.enterActionsPhase();
        },
        error: () => {
          this.authenticating.set(false);
          this.pinError.set('Invalid password');
        },
      });
    }
  }

  protected cancelPin(): void {
    this.resetToMain();
  }

  // ─── Keypad input (touchscreen PIN entry) ───

  protected onKeypadDigit(digit: string): void {
    this.resetPinTimeout();
    const current = this.pinControl.value ?? '';
    const max = this.isPasswordAuth() ? 128 : 8;
    if (current.length >= max) return;
    this.pinControl.setValue(current + digit);
  }

  protected onKeypadBackspace(): void {
    this.resetPinTimeout();
    const current = this.pinControl.value ?? '';
    if (!current) return;
    this.pinControl.setValue(current.slice(0, -1));
  }

  protected onKeypadClear(): void {
    this.resetPinTimeout();
    this.pinControl.setValue('');
  }

  private resetPinTimeout(): void {
    if (this.phase() === 'pin') this.startPhaseTimeout(PIN_TIMEOUT_MS);
  }

  // ─── Actions Phase ───

  private enterActionsPhase(): void {
    this.clearPhaseTimeout();
    this.loadData();
    this.phase.set('actions');
    this.startAutoLogoutTimer();
  }

  protected clockAction(worker: ClockWorker, eventType: string): void {
    const key = `${worker.userId}-${eventType}`;
    if (this.processing()) return;
    this.processing.set(key);
    this.resetAutoLogoutTimer();

    this.loading.track('Processing...', this.shopFloorService.clockInOut(worker.userId, eventType)).subscribe({
      next: () => {
        this.processing.set(null);
        this.actionFeedback.set({ workerId: worker.userId, success: true });
        this.loadData();

        // After clock-in, if worker has no assignments → show job picker
        const eventDef = this.clockTypes.definitions().find(d => d.code === eventType);
        if (eventDef?.statusMapping === 'In' && eventDef.category === 'work' && worker.assignments.length === 0) {
          setTimeout(() => {
            this.actionFeedback.set(null);
            this.jobSelectWorker.set(worker);
            this.phase.set('job-select');
            this.startPhaseTimeout(JOB_SELECT_TIMEOUT_MS);
          }, 800);
        } else {
          setTimeout(() => {
            this.actionFeedback.set(null);
            this.ephemeralLogout();
          }, 1500);
        }
      },
      error: () => {
        this.processing.set(null);
        this.actionFeedback.set({ workerId: worker.userId, success: false });
        setTimeout(() => this.actionFeedback.set(null), 3000);
      },
    });
  }

  // ─── Job Selection ───

  protected selectJob(job: ShopFloorJob): void {
    const worker = this.jobSelectWorker();
    if (!worker || this.processing()) return;
    this.processing.set(`assign-${job.id}`);
    this.resetAutoLogoutTimer();

    this.loading.track('Assigning job...', this.shopFloorService.assignJob(job.id, worker.userId)).subscribe({
      next: () => {
        this.processing.set(null);
        this.loadData();
        setTimeout(() => this.ephemeralLogout(), 800);
      },
      error: () => {
        this.processing.set(null);
      },
    });
  }

  protected skipJobSelect(): void {
    this.ephemeralLogout();
  }

  // ─── Drag & Drop (unassigned jobs → worker cards) ───

  protected onDragStart(event: DragEvent, job: ShopFloorJob): void {
    this.draggingJobId.set(job.id);
    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData('application/x-job-id', String(job.id));
  }

  protected onDragEnd(): void {
    this.draggingJobId.set(null);
    this.dropTargetUserId.set(null);
  }

  protected onDragOverCard(event: DragEvent, worker: ClockWorker): void {
    if (!this.draggingJobId()) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    this.dropTargetUserId.set(worker.userId);
  }

  protected onDragLeaveCard(): void {
    this.dropTargetUserId.set(null);
  }

  protected onDropCard(event: DragEvent, worker: ClockWorker): void {
    event.preventDefault();
    const jobIdStr = event.dataTransfer?.getData('application/x-job-id');
    this.dropTargetUserId.set(null);
    this.draggingJobId.set(null);

    if (!jobIdStr) return;
    const jobId = parseInt(jobIdStr, 10);
    if (isNaN(jobId)) return;

    this.processing.set(`assign-${jobId}`);
    this.loading.track('Assigning job...', this.shopFloorService.assignJob(jobId, worker.userId)).subscribe({
      next: () => {
        this.processing.set(null);
        this.loadData();
      },
      error: () => {
        this.processing.set(null);
      },
    });
  }

  // ─── Job Timer Actions ───

  protected startJobTimer(assignment: { jobId: number }): void {
    if (this.processing()) return;
    this.processing.set(`timer-start-${assignment.jobId}`);
    this.resetAutoLogoutTimer();

    this.loading.track('Starting timer...', this.shopFloorService.startTimer(assignment.jobId)).subscribe({
      next: () => {
        this.processing.set(null);
        this.loadData();
        this.showScanFeedback('Timer started');
      },
      error: () => {
        this.processing.set(null);
        this.showScanFeedback('Could not start timer');
      },
    });
  }

  protected completeJob(assignment: { jobId: number }): void {
    if (this.processing()) return;
    this.processing.set(`complete-${assignment.jobId}`);
    this.resetAutoLogoutTimer();

    this.loading.track('Completing job...', this.shopFloorService.completeJob(assignment.jobId)).subscribe({
      next: () => {
        this.processing.set(null);
        this.loadData();
        this.showScanFeedback('Job marked complete');
        setTimeout(() => this.ephemeralLogout(), 1200);
      },
      error: () => {
        this.processing.set(null);
        this.showScanFeedback('Could not complete job');
      },
    });
  }

  protected stopJobTimer(): void {
    if (this.processing()) return;
    this.processing.set('timer-stop');
    this.resetAutoLogoutTimer();

    this.loading.track('Stopping timer...', this.shopFloorService.stopTimer()).subscribe({
      next: () => {
        this.processing.set(null);
        this.loadData();
        this.showScanFeedback('Timer stopped');
      },
      error: () => {
        this.processing.set(null);
        this.showScanFeedback('Could not stop timer');
      },
    });
  }

  protected cancelActions(): void {
    this.ephemeralLogout();
  }

  // ─── Receiving ───

  protected enterReceiving(): void {
    this.clearAutoLogoutTimer();
    this.phase.set('receiving');
    this.selectedPO.set(null);
    this.receivingLines.set([]);
    this.loadReceivablePOs();
    this.loadBinLocations();
  }

  private loadReceivablePOs(): void {
    const receivableStatuses = ['Submitted', 'Acknowledged', 'PartiallyReceived'];
    this.poService.getPurchaseOrders().subscribe(pos => {
      const openPos = pos.filter(po => receivableStatuses.includes(po.status));
      const details: PurchaseOrderDetail[] = [];
      if (openPos.length === 0) {
        this.receivablePOs.set([]);
        return;
      }
      openPos.forEach(po => {
        this.poService.getPurchaseOrderById(po.id).subscribe(detail => {
          if (detail.lines.some(l => l.remainingQuantity > 0)) {
            details.push(detail);
            this.receivablePOs.set([...details]);
          }
        });
      });
    });
  }

  private loadBinLocations(): void {
    this.inventoryService.getBinLocations().subscribe(bins => {
      this.binLocationOptions.set(
        bins.map(b => ({ value: b.id, label: b.locationPath ?? b.name })),
      );
    });
  }

  protected selectPOForReceiving(po: PurchaseOrderDetail): void {
    this.selectedPO.set(po);
    this.receivingLines.set(
      po.lines
        .filter(l => l.remainingQuantity > 0)
        .map(l => ({ line: l, receiveQty: l.remainingQuantity })),
    );
    this.resetAutoLogoutTimer();
  }

  protected updateReceiveQty(lineId: number, qty: number): void {
    this.receivingLines.update(lines =>
      lines.map(l => l.line.id === lineId ? { ...l, receiveQty: Math.max(0, Math.min(qty, l.line.remainingQuantity)) } : l),
    );
    this.resetAutoLogoutTimer();
  }

  protected submitReceiving(): void {
    const lines = this.receivingLines().filter(l => l.receiveQty > 0);
    if (lines.length === 0) return;
    this.receivingSubmitting.set(true);
    this.resetAutoLogoutTimer();

    let completed = 0;
    const locationId = this.receiveBinId.value ?? undefined;

    lines.forEach(({ line, receiveQty }) => {
      this.inventoryService.receiveGoods({
        purchaseOrderLineId: line.id,
        quantityReceived: receiveQty,
        locationId,
      }).subscribe({
        next: () => {
          completed++;
          if (completed === lines.length) {
            this.receivingSubmitting.set(false);
            this.showScanFeedback(`Received ${lines.length} line(s) successfully`);
            setTimeout(() => this.ephemeralLogout(), 1500);
          }
        },
        error: () => {
          completed++;
          if (completed === lines.length) {
            this.receivingSubmitting.set(false);
            this.showScanFeedback('Some lines failed to receive');
          }
        },
      });
    });
  }

  protected cancelReceiving(): void {
    this.phase.set('actions');
    this.startAutoLogoutTimer();
  }

  // ─── Shipping ───

  protected enterShipping(): void {
    this.clearAutoLogoutTimer();
    this.phase.set('shipping');
    this.selectedShipment.set(null);
    this.loadShippableShipments();
  }

  private loadShippableShipments(): void {
    this.shipmentService.getShipments(undefined, 'Pending').subscribe(pending => {
      this.shipmentService.getShipments(undefined, 'Packed').subscribe(packed => {
        this.shippableShipments.set([...pending, ...packed]);
      });
    });
  }

  protected selectShipmentForShipping(shipment: ShipmentListItem): void {
    this.shipmentService.getShipmentById(shipment.id).subscribe(detail => {
      this.selectedShipment.set(detail);
      this.resetAutoLogoutTimer();
    });
  }

  protected confirmShip(): void {
    const shipment = this.selectedShipment();
    if (!shipment || this.shippingSubmitting()) return;
    this.shippingSubmitting.set(true);
    this.resetAutoLogoutTimer();

    this.shipmentService.shipShipment(shipment.id).subscribe({
      next: () => {
        this.shippingSubmitting.set(false);
        this.showScanFeedback(`${shipment.shipmentNumber} marked as shipped`);
        setTimeout(() => this.ephemeralLogout(), 1500);
      },
      error: () => {
        this.shippingSubmitting.set(false);
        this.showScanFeedback('Failed to mark shipment as shipped');
      },
    });
  }

  protected printPackingSlip(): void {
    const shipment = this.selectedShipment();
    if (!shipment) return;
    this.resetAutoLogoutTimer();
    const url = `${environment.apiUrl}/shipments/${shipment.id}/packing-slip`;
    window.open(url, '_blank');
  }

  protected cancelShipping(): void {
    this.phase.set('actions');
    this.startAutoLogoutTimer();
  }

  // ─── Helpers ───

  protected isProcessing(workerId: number, eventType: string): boolean {
    return this.processing() === `${workerId}-${eventType}`;
  }

  protected hasFeedback(workerId: number): boolean {
    return this.actionFeedback()?.workerId === workerId;
  }

  protected feedbackSuccess(workerId: number): boolean {
    const fb = this.actionFeedback();
    return fb?.workerId === workerId && fb.success;
  }

  protected toggleUndoPanel(): void {
    this.undoPanelOpen.update(v => !v);
  }

  protected closeLocationView(): void {
    this.scannedLocationId.set(null);
    this.scannedLocationName.set(null);
  }

  protected toggleTheme(): void {
    this.theme.update(t => t === 'light' ? 'dark' : 'light');
    localStorage.setItem('sf-theme', this.theme());
  }

  protected increaseFontSize(): void {
    this.fontSizeIndex.update(i => Math.min(i + 1, FONT_SIZES.length - 1));
    this.applyFontSize();
  }

  protected decreaseFontSize(): void {
    this.fontSizeIndex.update(i => Math.max(i - 1, 0));
    this.applyFontSize();
  }

  private applyFontSize(): void {
    const el = this.elRef.nativeElement as HTMLElement;
    const scale = FONT_SIZES[this.fontSizeIndex()] / FONT_SIZES[0];
    el.style.zoom = `${scale}`;
    localStorage.setItem('sf-font-index', String(this.fontSizeIndex()));
  }

  protected priorityClass(priority: string): string {
    switch (priority) {
      case 'Urgent': return 'priority--urgent';
      case 'High': return 'priority--high';
      default: return '';
    }
  }

  protected eventTypeIcon(type: string): string {
    switch (type) {
      case 'Meeting': return 'groups';
      case 'Training': return 'school';
      case 'Safety': return 'health_and_safety';
      default: return 'event';
    }
  }

  // ─── Ephemeral Auth ───

  private ephemeralLogout(): void {
    this.clearAutoLogoutTimer();
    this.authService.clearAuth();
    this.loadData();
    this.resetToMain();
  }

  private resetToMain(): void {
    this.clearAutoLogoutTimer();
    this.clearPhaseTimeout();
    this.authService.clearAuth();
    this.selectedWorker.set(null);
    this.scannedValue.set(null);
    this.pinError.set(null);
    this.pinControl.reset();
    this.processing.set(null);
    this.phase.set('main');
  }

  private startAutoLogoutTimer(): void {
    this.clearAutoLogoutTimer();
    this.autoLogoutTimer = setTimeout(() => this.ephemeralLogout(), AUTO_LOGOUT_MS);
  }

  private resetAutoLogoutTimer(): void {
    this.startAutoLogoutTimer();
  }

  private clearAutoLogoutTimer(): void {
    if (this.autoLogoutTimer) {
      clearTimeout(this.autoLogoutTimer);
      this.autoLogoutTimer = null;
    }
  }

  private startPhaseTimeout(ms: number): void {
    this.clearPhaseTimeout();
    this.phaseTimeoutTimer = setTimeout(() => this.resetToMain(), ms);
  }

  private clearPhaseTimeout(): void {
    if (this.phaseTimeoutTimer) {
      clearTimeout(this.phaseTimeoutTimer);
      this.phaseTimeoutTimer = null;
    }
  }

  // ─── Data ───

  private loadData(): void {
    forkJoin({
      overview: this.shopFloorService.getOverview(),
      workers: this.shopFloorService.getClockStatus(),
      events: this.eventsService.getUpcomingEvents().pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ overview, workers, events }) => {
        this.overview.set(overview);
        this.workers.set(workers);
        this.upcomingEvents.set(events);
        this.error.set(null);

        // Refresh selectedWorker with updated data (timer status, assignments, etc.)
        const current = this.selectedWorker();
        if (current) {
          const updated = workers.find(w => w.userId === current.userId);
          if (updated) this.selectedWorker.set(updated);
        }
      },
      error: (err: HttpErrorResponse) => {
        // 401 = kiosk token missing/revoked — flip to the pairing gate rather
        // than showing a generic "failed to load" error.
        if (err?.status === 401) {
          localStorage.removeItem('qbe-kiosk-device-token');
          localStorage.removeItem('qbe-kiosk-terminal');
          this.isUnpaired.set(true);
          this.error.set(null);
          return;
        }
        this.error.set(this.translate.instant('shopFloor.loadFailed'));
      },
    });
  }

  protected onTerminalConfigured(): void {
    this.isUnpaired.set(false);
    this.error.set(null);
    this.clockTypes.load();
    this.loadData();
  }

  private updateClock(): void {
    this.clockDisplay.set(
      new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    );
    this.tick.update(t => t + 1);
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    if (minutes >= 1) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
  }
}

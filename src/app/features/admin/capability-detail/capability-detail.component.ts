import { CommonModule, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { CapabilityService } from '../../../shared/services/capability.service';
import { ConsultantModeService } from '../../../shared/services/consultant-mode.service';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import {
  CapabilityRelationEntry,
  CapabilityRelations,
} from '../../../shared/models/capability-relations.model';
import { CapabilityAuditEntry } from '../../../shared/models/capability-audit-entry.model';
import { CapabilityDescriptorEntry } from '../../../shared/models/capability-descriptor.model';

import { PageLayoutComponent } from '../../../shared/components/page-layout/page-layout.component';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';

interface CapabilityViolation {
  code: string;
  message: string;
  capability?: string;
  dependents?: string[];
  missing?: string[];
  conflicts?: string[];
}

/**
 * Phase 4 Phase-E — Per-capability detail page (4E §Screen 5).
 *
 * Routed at `/admin/capabilities/:id`. Shows the capability's name, code,
 * area, current enabled state with toggle, dependency graph (depends-on +
 * depended-by + mutex), config payload (read-only for now), and scoped
 * audit history (per 4E-decisions-log #8).
 *
 * Uses three of the new Phase E endpoints:
 *   • `GET /api/v1/capabilities/{id}/relations` — the dependency graph.
 *   • `GET /api/v1/capabilities/{id}/audit-log` — scoped audit history.
 *   • The existing `PUT /api/v1/capabilities/{id}/enabled` — toggle.
 */
@Component({
  selector: 'app-capability-detail',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    RouterModule,
    MatSlideToggleModule,
    MatTooltipModule,
    PageLayoutComponent,
    LoadingBlockDirective,
  ],
  templateUrl: './capability-detail.component.html',
  styleUrl: './capability-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilityDetailComponent implements OnInit {
  private readonly capabilityService = inject(CapabilityService);
  private readonly consultantMode = inject(ConsultantModeService);
  private readonly snackbar = inject(SnackbarService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly consultantModeEnabled = this.consultantMode.enabled;

  /** The capability code from the route. */
  protected readonly code = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  /** Latest descriptor entry for this capability — derives from the live snapshot. */
  protected readonly entry = computed<CapabilityDescriptorEntry | undefined>(() => {
    const code = this.code();
    if (!code) return undefined;
    return this.capabilityService.getEntry(code);
  });

  protected readonly relations = signal<CapabilityRelations | null>(null);
  protected readonly auditLog = signal<CapabilityAuditEntry[]>([]);
  protected readonly relationsLoading = signal(false);
  protected readonly auditLoading = signal(false);
  protected readonly togglePending = signal(false);

  constructor() {
    // React to code changes (deep-link navigation, internal cross-links).
    // Effects must be created in an injection context — constructor is the
    // canonical spot.
    effect(
      () => {
        const code = this.code();
        if (!code) return;
        this.loadRelations(code);
        this.loadAuditLog(code);
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    // The capability service may already be loaded; if not, kick a load so
    // `entry()` resolves. Repeated load() calls are idempotent.
    this.capabilityService.load().subscribe();
  }

  protected back(): void {
    this.router.navigate(['/admin/capabilities']);
  }

  protected refreshAll(): void {
    const code = this.code();
    if (!code) return;
    this.capabilityService.load().subscribe();
    this.loadRelations(code);
    this.loadAuditLog(code);
  }

  protected onToggle(target: boolean): void {
    const entry = this.entry();
    if (!entry || this.togglePending()) return;
    this.togglePending.set(true);
    this.capabilityService.setEnabled(entry.code, target).subscribe({
      next: () => {
        this.snackbar.success(`Capability ${target ? 'enabled' : 'disabled'}: ${entry.name}`);
        this.togglePending.set(false);
        // Refresh relations + audit so the UI reflects new state.
        this.loadRelations(entry.code);
        this.loadAuditLog(entry.code);
      },
      error: (err: HttpErrorResponse) => {
        this.togglePending.set(false);
        this.surfaceError(entry, err);
        this.capabilityService.load().subscribe();
      },
    });
  }

  protected goToCapability(peer: CapabilityRelationEntry): void {
    if (!peer.code) return;
    this.router.navigate(['/admin/capabilities', peer.code]);
  }

  protected formatAuditAction(action: string): string {
    switch (action) {
      case 'CapabilityEnabled': return 'Enabled';
      case 'CapabilityDisabled': return 'Disabled';
      case 'CapabilityConfigChanged': return 'Config changed';
      case 'PresetApplied': return 'Preset applied';
      default: return action;
    }
  }

  protected formatAuditDetails(entry: CapabilityAuditEntry): string {
    if (!entry.details) return '';
    try {
      const parsed = JSON.parse(entry.details);
      const reason = parsed.reason ? ` — "${parsed.reason}"` : '';
      if (typeof parsed.from === 'boolean' && typeof parsed.to === 'boolean') {
        return `${parsed.from ? 'on' : 'off'} → ${parsed.to ? 'on' : 'off'}${reason}`;
      }
      return reason || '';
    } catch {
      return entry.details;
    }
  }

  private loadRelations(code: string): void {
    this.relationsLoading.set(true);
    this.capabilityService.getRelations(code).subscribe({
      next: (rel) => {
        this.relations.set(rel);
        this.relationsLoading.set(false);
      },
      error: () => {
        this.relations.set(null);
        this.relationsLoading.set(false);
      },
    });
  }

  private loadAuditLog(code: string): void {
    this.auditLoading.set(true);
    this.capabilityService.getAuditLog(code, { take: 25 }).subscribe({
      next: (entries) => {
        this.auditLog.set(entries);
        this.auditLoading.set(false);
      },
      error: () => {
        this.auditLog.set([]);
        this.auditLoading.set(false);
      },
    });
  }

  private surfaceError(entry: CapabilityDescriptorEntry, err: HttpErrorResponse): void {
    const violation = this.extractFirstViolation(err);
    if (!violation) {
      this.snackbar.error(`Failed to update ${entry.name}.`);
      return;
    }
    switch (violation.code) {
      case 'capability-has-dependents':
        this.snackbar.error(
          `Cannot disable ${entry.name} — disable these dependents first: ${(violation.dependents ?? []).join(', ')}.`,
        );
        break;
      case 'capability-missing-dependencies':
        this.snackbar.error(
          `Cannot enable ${entry.name} — enable these dependencies first: ${(violation.missing ?? []).join(', ')}.`,
        );
        break;
      case 'capability-mutex-violation':
        this.snackbar.error(
          `${entry.name} conflicts with: ${(violation.conflicts ?? []).join(', ')}. Disable the peer first.`,
        );
        break;
      default:
        this.snackbar.error(violation.message ?? `Failed to update ${entry.name}.`);
        break;
    }
  }

  private extractFirstViolation(err: HttpErrorResponse): CapabilityViolation | null {
    const body = err.error;
    if (!body || typeof body !== 'object') return null;
    if (!Array.isArray(body.errors) || body.errors.length === 0) return null;
    return body.errors[0] as CapabilityViolation;
  }
}

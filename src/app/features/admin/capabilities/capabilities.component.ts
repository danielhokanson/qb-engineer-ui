import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { CapabilityService } from '../../../shared/services/capability.service';
import { CapabilityInstallStateService } from '../../../shared/services/capability-install-state.service';
import { ConsultantModeService } from '../../../shared/services/consultant-mode.service';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { CapabilityDescriptorEntry } from '../../../shared/models/capability-descriptor.model';

import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../shared/components/toggle/toggle.component';
import { PageLayoutComponent } from '../../../shared/components/page-layout/page-layout.component';
import { SpacerDirective } from '../../../shared/directives/spacer.directive';
import { LoadingBlockDirective } from '../../../shared/directives/loading-block.directive';

interface CapabilityViolation {
  code: string;
  message: string;
  capability?: string;
  dependents?: string[];
  missing?: string[];
  conflicts?: string[];
}

interface AreaGroup {
  area: string;
  totalCount: number;
  enabledCount: number;
  capabilities: CapabilityDescriptorEntry[];
}

/**
 * Phase 4 Phase-E — Polished capability admin list page (4E §Screen 1).
 *
 * Replaces the Phase C minimum admin page with the full surface:
 *   • Top bar: search, area filter, enabled-only filter, consultant-mode
 *     toggle, refresh.
 *   • Capabilities grouped by functional area (collapsible) so the 129-row
 *     dataset is scannable.
 *   • Per-row: enabled toggle (pessimistic UX per 4E-decisions-log #5),
 *     friendly name, code (consultant-mode only per 4E-decisions-log #1),
 *     dependency count, click-through to the per-capability detail page.
 *   • 409 dependency / mutex violations surface as informative snackbar
 *     messages (the WU-02 envelope is decoded into plain English).
 *
 * Phase F / G will add the discovery-flow runner and preset browser; this
 * page is the always-on admin surface for direct capability management.
 */
@Component({
  selector: 'app-capabilities',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatSlideToggleModule,
    MatTooltipModule,
    InputComponent,
    SelectComponent,
    ToggleComponent,
    PageLayoutComponent,
    SpacerDirective,
    LoadingBlockDirective,
  ],
  templateUrl: './capabilities.component.html',
  styleUrl: './capabilities.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilitiesComponent implements OnInit {
  private readonly capabilityService = inject(CapabilityService);
  private readonly consultantMode = inject(ConsultantModeService);
  private readonly installState = inject(CapabilityInstallStateService);
  private readonly snackbar = inject(SnackbarService);
  private readonly router = inject(Router);

  protected readonly loading = this.capabilityService.loading;
  protected readonly capabilities = this.capabilityService.capabilities;
  protected readonly consultantModeEnabled = this.consultantMode.enabled;
  protected readonly bannerDismissed = this.installState.dismissed;

  /** Toggled rows held by code. Phase 4E pessimistic UX (decisions-log #5). */
  protected readonly pending = signal<Set<string>>(new Set());

  /** Collapsed area headings (per session — not persisted). */
  protected readonly collapsedAreas = signal<Set<string>>(new Set());

  // ─── Filter controls (URL-binding optional; session-level for Phase E) ───

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });
  protected readonly areaControl = new FormControl<string>('', { nonNullable: true });
  protected readonly enabledOnlyControl = new FormControl<boolean>(false, { nonNullable: true });

  protected readonly searchSignal = toSignal(this.searchControl.valueChanges, { initialValue: '' });
  protected readonly areaSignal = toSignal(this.areaControl.valueChanges, { initialValue: '' });
  protected readonly enabledOnlySignal = toSignal(this.enabledOnlyControl.valueChanges, {
    initialValue: false,
  });

  // ─── Derived state ──────────────────────────────────────────────────────

  protected readonly enabledCount = computed(() => this.capabilities().filter((c) => c.enabled).length);

  /** Distinct area codes for the filter dropdown (sorted asc). */
  protected readonly areaOptions = computed<SelectOption[]>(() => {
    const areas = Array.from(new Set(this.capabilities().map((c) => c.area))).sort();
    return [
      { value: '', label: 'All areas' },
      ...areas.map((a) => ({ value: a, label: a })),
    ];
  });

  /** Filtered capability list — applies search / area / enabled-only. */
  protected readonly filtered = computed<CapabilityDescriptorEntry[]>(() => {
    const search = (this.searchSignal() ?? '').trim().toLowerCase();
    const area = this.areaSignal() ?? '';
    const enabledOnly = this.enabledOnlySignal() ?? false;
    return this.capabilities().filter((c) => {
      if (area && c.area !== area) return false;
      if (enabledOnly && !c.enabled) return false;
      if (!search) return true;
      return (
        c.code.toLowerCase().includes(search) ||
        c.name.toLowerCase().includes(search) ||
        (c.description ?? '').toLowerCase().includes(search)
      );
    });
  });

  /** Group filtered list by functional area. */
  protected readonly groupedByArea = computed<AreaGroup[]>(() => {
    const groups = new Map<string, CapabilityDescriptorEntry[]>();
    for (const cap of this.filtered()) {
      const list = groups.get(cap.area) ?? [];
      list.push(cap);
      groups.set(cap.area, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([area, caps]) => {
        const sorted = [...caps].sort((a, b) => a.name.localeCompare(b.name));
        return {
          area,
          capabilities: sorted,
          totalCount: caps.length,
          enabledCount: caps.filter((c) => c.enabled).length,
        } satisfies AreaGroup;
      });
  });

  /** Show the onboarding banner when fresh-install state hasn't been confirmed. */
  protected readonly showOnboardingBanner = computed(() => !this.bannerDismissed());

  ngOnInit(): void {
    this.capabilityService.load().subscribe();
  }

  protected refresh(): void {
    this.capabilityService.load().subscribe();
  }

  protected toggleConsultantMode(): void {
    this.consultantMode.toggle();
  }

  protected dismissBanner(): void {
    this.installState.dismiss();
  }

  /** Phase 4 Phase-F — navigate to the discovery wizard from the onboarding banner. */
  protected runDiscovery(): void {
    this.router.navigate(['/admin/discovery']);
  }

  /** Phase 4 Phase-G — navigate to the preset browser from the onboarding banner. */
  protected browsePresets(): void {
    this.router.navigate(['/admin/presets']);
  }

  protected isAreaCollapsed(area: string): boolean {
    return this.collapsedAreas().has(area);
  }

  protected toggleAreaCollapse(area: string): void {
    const next = new Set(this.collapsedAreas());
    if (next.has(area)) next.delete(area);
    else next.add(area);
    this.collapsedAreas.set(next);
  }

  protected openDetail(entry: CapabilityDescriptorEntry): void {
    this.router.navigate(['/admin/capabilities', entry.code]);
  }

  protected isPending(code: string): boolean {
    return this.pending().has(code);
  }

  /** Pessimistic toggle UX (4E-decisions-log #5). */
  protected onToggle(entry: CapabilityDescriptorEntry, target: boolean, event?: Event): void {
    event?.stopPropagation();
    if (this.pending().has(entry.code)) return;
    this.markPending(entry.code, true);

    this.capabilityService.setEnabled(entry.code, target).subscribe({
      next: () => {
        this.snackbar.success(`Capability ${target ? 'enabled' : 'disabled'}: ${entry.name}`);
        this.markPending(entry.code, false);
      },
      error: (err: HttpErrorResponse) => {
        this.markPending(entry.code, false);
        this.surfaceError(entry, err);
        this.capabilityService.load().subscribe();
      },
    });
  }

  private markPending(code: string, on: boolean): void {
    const current = new Set(this.pending());
    if (on) current.add(code);
    else current.delete(code);
    this.pending.set(current);
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
      case 'version-mismatch':
        this.snackbar.error(
          `${entry.name} was modified by another admin. The page has been refreshed; try again.`,
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

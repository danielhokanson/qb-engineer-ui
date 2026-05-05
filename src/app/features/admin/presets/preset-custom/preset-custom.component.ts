import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';

import { PageLayoutComponent } from '../../../../shared/components/page-layout/page-layout.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import {
  PresetApplyDialogComponent,
  PresetApplyDialogData,
  PresetApplyDialogResult,
} from '../../../../shared/components/preset-apply-dialog/preset-apply-dialog.component';
import { CapabilityInstallStateService } from '../../../../shared/services/capability-install-state.service';
import { CapabilityService } from '../../../../shared/services/capability.service';
import { PresetService } from '../../../../shared/services/preset.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import {
  PresetCapabilityRow,
  PresetCustomOverride,
  PresetCustomPreview,
} from '../../../../shared/models/preset.model';

interface CustomCapabilityRow extends PresetCapabilityRow {
  overridden: boolean;
}

interface CustomAreaGroup {
  area: string;
  rows: CustomCapabilityRow[];
}

/**
 * Phase 4 Phase-G — Custom preset builder.
 *
 * Catalog defaults shown as starting state. Each capability has a binary
 * toggle; user-toggled rows are tagged "Override" so it's clear what
 * differs from the default. Live constraint validation calls the
 * `previewCustom` endpoint after each toggle. "Apply Custom" opens the
 * preset-apply-dialog (preview → confirm → mutate).
 *
 * 4G decision: binary toggle (with override marker), not 3-state. Keeps
 * the UI simple — "I want X on" / "I want X off". The "default" state is
 * a derived condition (no override), not a third state.
 */
@Component({
  selector: 'app-preset-custom',
  standalone: true,
  imports: [CommonModule, RouterModule, PageLayoutComponent, LoadingBlockDirective],
  templateUrl: './preset-custom.component.html',
  styleUrl: './preset-custom.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetCustomComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly presetService = inject(PresetService);
  private readonly capabilityService = inject(CapabilityService);
  private readonly installState = inject(CapabilityInstallStateService);
  private readonly snackbar = inject(SnackbarService);

  protected readonly preview = signal<PresetCustomPreview | null>(null);
  protected readonly overrides = signal<Map<string, boolean>>(new Map());
  protected readonly loading = this.presetService.previewing;
  protected readonly applying = signal<boolean>(false);

  protected readonly violationCount = computed(() => this.preview()?.violations.length ?? 0);
  protected readonly capabilityCount = computed(() => this.preview()?.capabilityCount ?? 0);
  protected readonly deltaCount = computed(() => this.preview()?.deltaVsCurrentInstall.length ?? 0);

  protected readonly groupedCapabilities = computed<CustomAreaGroup[]>(() => {
    const p = this.preview();
    if (!p) return [];
    const overrideMap = this.overrides();
    const map = new Map<string, CustomCapabilityRow[]>();
    for (const row of p.capabilities) {
      const overridden =
        overrideMap.has(row.code) && overrideMap.get(row.code) !== row.defaultOn;
      if (!map.has(row.area)) map.set(row.area, []);
      map.get(row.area)!.push({ ...row, overridden });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([area, rows]) => ({ area, rows }));
  });

  ngOnInit(): void {
    // Initial preview with no overrides → catalog defaults.
    this.refreshPreview();
  }

  protected back(): void {
    this.router.navigate(['/admin/presets']);
  }

  protected toggle(row: PresetCapabilityRow): void {
    const next = new Map(this.overrides());
    const desired = !row.inPreset;
    if (desired === row.defaultOn) {
      // User toggled back to default — drop the override entry.
      next.delete(row.code);
    } else {
      next.set(row.code, desired);
    }
    this.overrides.set(next);
    this.refreshPreview();
  }

  protected resetOverrides(): void {
    this.overrides.set(new Map());
    this.refreshPreview();
  }

  protected applyCustom(): void {
    const p = this.preview();
    if (!p) return;
    const overrideList = this.toOverrideList();

    const data: PresetApplyDialogData = {
      presetId: 'PRESET-CUSTOM',
      presetName: 'Custom configuration',
      isCustom: true,
      deltas: p.deltaVsCurrentInstall,
      violations: p.violations,
      noOp: p.deltaVsCurrentInstall.length === 0,
    };
    this.dialog
      .open<PresetApplyDialogComponent, PresetApplyDialogData, PresetApplyDialogResult>(
        PresetApplyDialogComponent,
        { width: '720px', data },
      )
      .afterClosed()
      .subscribe((result) => {
        if (!result?.confirmed) return;
        this.commitApply(overrideList, result.reason);
      });
  }

  private commitApply(overrides: PresetCustomOverride[], reason?: string): void {
    this.applying.set(true);
    this.presetService.applyCustom(overrides, reason).subscribe({
      next: (result) => {
        this.applying.set(false);
        if (result.noOp) {
          this.snackbar.info('Custom configuration: no changes — already matches.');
        } else {
          this.snackbar.success(`Applied Custom configuration (${result.deltaCount} capabilities changed).`);
        }
        this.capabilityService.load().subscribe();
        this.installState.dismiss();
        this.router.navigate(['/admin/capabilities']);
      },
      error: (err) => {
        this.applying.set(false);
        const msg = err?.error?.message ?? 'Apply failed';
        this.snackbar.error(msg);
      },
    });
  }

  private refreshPreview(): void {
    this.presetService.previewCustom(this.toOverrideList()).subscribe({
      next: (preview) => this.preview.set(preview),
      error: () => this.snackbar.error('Failed to preview custom configuration'),
    });
  }

  private toOverrideList(): PresetCustomOverride[] {
    return Array.from(this.overrides().entries()).map(([code, enabled]) => ({ code, enabled }));
  }
}

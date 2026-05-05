import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
  PresetCompareCapabilityRow,
  PresetCompareResponse,
} from '../../../../shared/models/preset.model';

interface ComparisonAreaGroup {
  area: string;
  rows: PresetCompareCapabilityRow[];
}

/**
 * Phase 4 Phase-G — Side-by-side preset compare matrix.
 *
 * URL: /admin/presets/compare?ids=p1,p2,p3
 *
 * Layout: rows = capabilities (grouped by area), columns = selected presets.
 * Cells display ✓ when in preset, — when not. Disagreement rows are visually
 * highlighted. Each column has a "Pick this one" button that routes to the
 * apply flow for that preset.
 */
@Component({
  selector: 'app-preset-compare',
  standalone: true,
  imports: [CommonModule, RouterModule, PageLayoutComponent, LoadingBlockDirective],
  templateUrl: './preset-compare.component.html',
  styleUrl: './preset-compare.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetCompareComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly presetService = inject(PresetService);
  private readonly capabilityService = inject(CapabilityService);
  private readonly installState = inject(CapabilityInstallStateService);
  private readonly snackbar = inject(SnackbarService);

  protected readonly response = signal<PresetCompareResponse | null>(null);
  protected readonly loading = this.presetService.comparing;
  protected readonly applying = signal<boolean>(false);
  protected readonly disagreementOnly = signal<boolean>(false);

  protected readonly groupedRows = computed<ComparisonAreaGroup[]>(() => {
    const r = this.response();
    if (!r) return [];
    const filter = this.disagreementOnly()
      ? r.rows.filter((row) => row.disagreement)
      : r.rows;
    const map = new Map<string, PresetCompareCapabilityRow[]>();
    for (const row of filter) {
      if (!map.has(row.area)) map.set(row.area, []);
      map.get(row.area)!.push(row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([area, rows]) => ({ area, rows }));
  });

  protected readonly disagreementCount = computed(() =>
    this.response()?.rows.filter((r) => r.disagreement).length ?? 0,
  );

  ngOnInit(): void {
    const idsParam = this.route.snapshot.queryParamMap.get('ids') ?? '';
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length < 2 || ids.length > 4) {
      this.snackbar.error('Compare requires 2-4 preset IDs');
      this.router.navigate(['/admin/presets']);
      return;
    }
    this.presetService.compare(ids).subscribe({
      next: (res) => this.response.set(res),
      error: () => {
        this.snackbar.error('Failed to load comparison');
        this.router.navigate(['/admin/presets']);
      },
    });
  }

  protected back(): void {
    this.router.navigate(['/admin/presets']);
  }

  protected toggleDisagreementOnly(): void {
    this.disagreementOnly.update((v) => !v);
  }

  protected pickPreset(presetId: string): void {
    const preset = this.response()?.presets.find((p) => p.id === presetId);
    if (!preset) return;

    this.applying.set(true);
    this.presetService.previewApply(presetId).subscribe({
      next: (preview) => {
        this.applying.set(false);
        const data: PresetApplyDialogData = {
          presetId,
          presetName: preset.name,
          isCustom: preset.isCustom,
          deltas: preview.deltas,
          violations: preview.violations,
          noOp: preview.deltaCount === 0,
        };
        this.dialog
          .open<PresetApplyDialogComponent, PresetApplyDialogData, PresetApplyDialogResult>(
            PresetApplyDialogComponent,
            { width: '720px', data },
          )
          .afterClosed()
          .subscribe((result) => {
            if (!result?.confirmed) return;
            this.commitApply(presetId, preset.name, result.reason);
          });
      },
      error: () => {
        this.applying.set(false);
        this.snackbar.error('Failed to preview apply');
      },
    });
  }

  private commitApply(presetId: string, presetName: string, reason?: string): void {
    this.applying.set(true);
    this.presetService.apply(presetId, reason).subscribe({
      next: (result) => {
        this.applying.set(false);
        if (result.noOp) {
          this.snackbar.info(`${presetName}: no changes — already matches.`);
        } else {
          this.snackbar.success(`Applied ${presetName} (${result.deltaCount} capabilities changed).`);
        }
        this.capabilityService.load().subscribe();
        this.installState.dismiss();
        this.router.navigate(['/admin/presets', presetId]);
      },
      error: (err) => {
        this.applying.set(false);
        const msg = err?.error?.message ?? 'Apply failed';
        this.snackbar.error(msg);
      },
    });
  }
}

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { PresetCapabilityRow } from '../../../../shared/models/preset.model';

interface CapabilityAreaGroup {
  area: string;
  rows: PresetCapabilityRow[];
}

/**
 * Phase 4 Phase-G — Single-preset detail page.
 *
 * Header: name, description, target profile, recommended-for tags, Apply
 * button (the page's primary action). Body: capability set grouped by area
 * with in/out tags; delta vs catalog defaults; delta vs current install
 * state. Apply button opens the reusable preset-apply-dialog (preview →
 * confirm → mutate).
 */
@Component({
  selector: 'app-preset-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, PageLayoutComponent, LoadingBlockDirective],
  templateUrl: './preset-detail.component.html',
  styleUrl: './preset-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly presetService = inject(PresetService);
  private readonly capabilityService = inject(CapabilityService);
  private readonly installState = inject(CapabilityInstallStateService);
  private readonly snackbar = inject(SnackbarService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly preset = this.presetService.selected;
  protected readonly loading = this.presetService.detailLoading;
  protected readonly applying = signal<boolean>(false);

  protected readonly capabilityGroups = computed<CapabilityAreaGroup[]>(() => {
    const detail = this.preset();
    if (!detail) return [];
    const map = new Map<string, PresetCapabilityRow[]>();
    for (const row of detail.capabilities) {
      if (!map.has(row.area)) map.set(row.area, []);
      map.get(row.area)!.push(row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([area, rows]) => ({ area, rows }));
  });

  protected readonly deltaVsCatalogCount = computed(() => this.preset()?.deltaVsCatalogDefaults.length ?? 0);
  protected readonly deltaVsInstallCount = computed(() => this.preset()?.deltaVsCurrentInstall.length ?? 0);
  protected readonly enabledInPreset = computed(() => this.preset()?.capabilities.filter((c) => c.inPreset).length ?? 0);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/admin/presets']);
      return;
    }
    this.presetService.getPreset(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      error: () => {
        this.snackbar.error('Preset not found');
        this.router.navigate(['/admin/presets']);
      },
    });
  }

  protected back(): void {
    this.router.navigate(['/admin/presets']);
  }

  protected applyPreset(): void {
    const detail = this.preset();
    if (!detail) return;

    this.applying.set(true);
    this.presetService.previewApply(detail.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (preview) => {
        this.applying.set(false);
        const data: PresetApplyDialogData = {
          presetId: detail.id,
          presetName: detail.name,
          isCustom: detail.isCustom,
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
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result) => {
            if (!result?.confirmed) return;
            this.commitApply(detail.id, detail.name, result.reason);
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
    this.presetService.apply(presetId, reason).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.applying.set(false);
        if (result.noOp) {
          this.snackbar.info(`${presetName}: no changes — already matches.`);
        } else {
          this.snackbar.success(`Applied ${presetName} (${result.deltaCount} capabilities changed).`);
        }
        // Refresh capability descriptor + install state, dismiss banner.
        this.capabilityService.load().subscribe();
        this.installState.dismiss();
        // Reload the preset detail so its activeness + delta vs install
        // refresh.
        this.presetService.getPreset(presetId).subscribe();
      },
      error: (err) => {
        this.applying.set(false);
        const msg = err?.error?.message ?? 'Apply failed';
        this.snackbar.error(msg);
      },
    });
  }
}

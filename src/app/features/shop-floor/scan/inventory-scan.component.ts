import {
  ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit, signal,
} from '@angular/core';

import { ScannerService } from '../../../shared/services/scanner.service';
import { ScanActionService } from '../../../shared/services/scan-action.service';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { ScanContext } from '../../../shared/models/scan-action.model';
import { BarcodeScanInputComponent } from '../../../shared/components/barcode-scan-input/barcode-scan-input.component';
import { ScanActionOverlayComponent } from '../components/scan-action-overlay/scan-action-overlay.component';

@Component({
  selector: 'app-inventory-scan',
  standalone: true,
  imports: [BarcodeScanInputComponent, ScanActionOverlayComponent],
  templateUrl: './inventory-scan.component.html',
  styleUrl: './inventory-scan.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryScanComponent implements OnInit, OnDestroy {
  private readonly scanner = inject(ScannerService);
  private readonly scanAction = inject(ScanActionService);
  private readonly snackbar = inject(SnackbarService);

  protected readonly recentScans = signal<ScanContext[]>([]);
  protected readonly scanCount = signal(0);

  ngOnInit(): void {
    this.scanner.setContext('inventory');
    this.scanner.restart();
  }

  ngOnDestroy(): void {
    this.scanner.stop();
  }

  protected onManualScan(value: string): void {
    // Look up part and pass to overlay
    this.scanAction.getContext(value).subscribe({
      next: (ctx) => {
        this.recentScans.update(scans => [ctx, ...scans.slice(0, 9)]);
        this.scanCount.update(c => c + 1);
      },
      error: () => {
        this.snackbar.warn(`Part not found: ${value}`);
      },
    });
  }

  protected onOverlayDismissed(): void {
    // Overlay closed — stay on scan page
  }
}

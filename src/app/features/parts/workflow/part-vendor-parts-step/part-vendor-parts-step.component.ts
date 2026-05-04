import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { VendorSourcesPanelComponent } from '../../components/vendor-sources-panel/vendor-sources-panel.component';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';

/**
 * Vendor Sources step (formerly "Vendor Parts") — thin wrapper around
 * the shared VendorSourcesPanelComponent. The panel handles all the
 * inline group rendering, save-on-blur, tier editing, and add-vendor
 * flow; this wrapper just bridges the workflow shell's `entity` input
 * to the panel's required inputs.
 *
 * The preferred vendor (Part.preferredVendorId, set on the upstream
 * Sourcing step) is passed through so the panel can render the
 * preferred-vendor stub group when no VendorPart row exists for it
 * yet — see the panel's preferredStubVisible logic.
 */
@Component({
  selector: 'app-part-vendor-parts-step',
  standalone: true,
  imports: [TranslatePipe, VendorSourcesPanelComponent],
  templateUrl: './part-vendor-parts-step.component.html',
  styleUrl: './part-vendor-parts-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartVendorPartsStepComponent {
  private readonly partsService = inject(PartsService);

  readonly stepId = input<string>('vendorParts');
  readonly componentName = input<string>('PartVendorPartsStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly part = computed<PartDetail | null>(() => (this.entity() as PartDetail | null) ?? null);
  protected readonly partLabel = computed<string>(() => {
    const p = this.part();
    return p ? `${p.partNumber} — ${p.name}` : '';
  });

  /**
   * If the user changes the preferred vendor from the panel (via the
   * "Set as preferred" action on a non-preferred row), patch the Part
   * to keep Part.preferredVendorId in lockstep with the row's flag.
   */
  protected onPreferredVendorChanged(vendorId: number): void {
    const p = this.part();
    if (!p) return;
    this.partsService.updatePart(p.id, { preferredVendorId: vendorId }).subscribe();
  }
}

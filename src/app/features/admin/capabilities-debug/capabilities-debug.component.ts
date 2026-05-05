import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';

import { CapabilityService } from '../../../shared/services/capability.service';

/**
 * Phase 4 Phase-A — admin-only diagnostic page that renders the loaded
 * capability descriptor as a flat table. This validates the descriptor
 * end-to-end (server seed → DB → descriptor handler → UI service →
 * component render) without waiting for Phase E's full admin UI.
 *
 * Lazy-loaded under `/admin/capabilities-debug`; gated by the parent admin
 * route's role guard. Phase E replaces this with the full Browse / History /
 * Detail screens (4E §Screen 1, 4, 5).
 */
@Component({
  selector: 'app-capabilities-debug',
  standalone: true,
  imports: [],
  templateUrl: './capabilities-debug.component.html',
  styleUrl: './capabilities-debug.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilitiesDebugComponent implements OnInit {
  private readonly capabilityService = inject(CapabilityService);

  protected readonly loading = this.capabilityService.loading;
  protected readonly descriptor = this.capabilityService.descriptor;
  protected readonly capabilities = this.capabilityService.capabilities;

  protected readonly enabledCount = computed(() =>
    this.capabilities().filter((c) => c.enabled).length,
  );

  ngOnInit(): void {
    this.capabilityService.load().subscribe();
  }

  protected refresh(): void {
    this.capabilityService.load().subscribe();
  }
}

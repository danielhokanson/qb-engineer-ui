import { Injectable, inject } from '@angular/core';

import { SignalrService } from './signalr.service';
import { NotificationService } from './notification.service';
import { CapabilityService } from './capability.service';
import { AppNotification } from '../models/app-notification.model';

/**
 * Capability change broadcast payload pushed by the server when an admin
 * toggles a capability via `PUT /api/v1/capabilities/{id}/enabled`.
 * Phase 4 Phase-B per 4D §4.4 / 4D-decisions-log #3.
 */
interface CapabilityChangedEvent {
  capabilityId: string;
  enabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationHubService {
  private readonly signalr = inject(SignalrService);
  private readonly notificationService = inject(NotificationService);
  private readonly capabilityService = inject(CapabilityService);
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;

    const connection = this.signalr.getOrCreateConnection('notifications');

    connection.off('notificationReceived');
    connection.on('notificationReceived', (notification: AppNotification) => {
      this.notificationService.push(notification);
    });

    // Phase 4 Phase-B — capability toggle broadcast. Refetch the descriptor so
    // every connected client converges on the new state without a page reload.
    // The event payload is structurally informative (capabilityId + enabled)
    // but we re-fetch the full descriptor either way — keeps the snapshot
    // logic in one place and tolerant of dropped messages.
    connection.off('capabilityChanged');
    connection.on('capabilityChanged', (event: CapabilityChangedEvent) => {
      void event;
      // Subscribe — load() returns a cold HttpClient Observable; without
      // a subscriber the descriptor never re-fetches and every connected
      // client stays on the stale snapshot. Symptom: admin toggles a
      // capability in tab A, tab B's header doesn't reveal/hide the
      // matching feature button until reload.
      this.capabilityService.load().subscribe();
    });

    await this.signalr.startConnection('notifications');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    const connection = this.signalr.getOrCreateConnection('notifications');
    connection.off('notificationReceived');
    connection.off('capabilityChanged');
    await this.signalr.stopConnection('notifications');
  }
}

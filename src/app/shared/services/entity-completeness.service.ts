import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, shareReplay } from 'rxjs';

import { environment } from '../../../environments/environment';
import { EntityCompleteness } from '../models/entity-completeness.model';

/**
 * Fetches per-entity capability-completeness state from the server. Caches
 * by `{entityType}:{entityId}` so the chip rendered in a list cell + the
 * badge appended to the name cell + the chip in the detail header all
 * share one network call when they're on screen at the same time. Cache
 * is in-memory only — invalidated on explicit `invalidate(...)` after the
 * entity is edited (so the chip refreshes), or when capability snapshot
 * changes (handled by SignalR re-fetch in callers).
 *
 * Tree-shakeable singleton (`providedIn: 'root'`).
 */
@Injectable({ providedIn: 'root' })
export class EntityCompletenessService {
  private readonly http = inject(HttpClient);

  private readonly cache = new Map<string, Observable<EntityCompleteness>>();

  getCompleteness(entityType: string, entityId: number): Observable<EntityCompleteness> {
    const key = `${entityType}:${entityId}`;
    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.http
        .get<EntityCompleteness>(
          `${environment.apiUrl}/entities/${encodeURIComponent(entityType)}/${entityId}/completeness`,
        )
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.cache.set(key, cached);
    }
    return cached;
  }

  /**
   * Drop the cached entry for one entity so the next consumer fetches
   * fresh. Call after an entity edit completes (vendor saved, part
   * patched, etc.) so the chip reflects the new state on next render.
   */
  invalidate(entityType: string, entityId: number): void {
    this.cache.delete(`${entityType}:${entityId}`);
  }

  /**
   * Drop everything — useful after a capability state change (SignalR
   * `capabilityChanged` push) since previously-skipped requirements
   * may now be in scope.
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Optimistic seed — when a caller already has a fresh response, populate
   * the cache so subsequent reads skip the network. `of()` re-emits to every
   * subscriber so no shareReplay needed.
   */
  seed(entityType: string, entityId: number, value: EntityCompleteness): void {
    this.cache.set(`${entityType}:${entityId}`, of(value));
  }
}

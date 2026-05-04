import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { catchError, of } from 'rxjs';

export interface AppVersion {
  version: string;
  sha: string;
}

@Injectable({ providedIn: 'root' })
export class VersionService {
  private readonly http = inject(HttpClient);

  readonly local = signal<AppVersion | null>(null);
  readonly latestSha = signal<string | null>(null);
  readonly checking = signal(false);
  readonly upToDate = signal<boolean | null>(null);

  load(): void {
    this.http
      .get<AppVersion>('/assets/version.json')
      .pipe(catchError(() => of(null)))
      .subscribe(v => {
        // Normalize SHA to the 7-char short form so the local value matches
        // the format the GitHub API returns (and our slice below). The
        // Dockerfile bakes in $github.sha which is the full 40-char hash.
        if (v && v.sha && v.sha !== 'dev') {
          this.local.set({ ...v, sha: v.sha.slice(0, 7) });
        } else {
          this.local.set(v);
        }
        this.checkLatest();
      });
  }

  checkLatest(): void {
    this.checking.set(true);
    this.http
      .get<{ sha: string }>('https://api.github.com/repos/danielhokanson/qb-engineer-ui/commits/main', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      .pipe(catchError(() => of(null)))
      .subscribe(commit => {
        this.checking.set(false);
        if (!commit) return;
        const sha = commit.sha.slice(0, 7);
        this.latestSha.set(sha);
        const local = this.local();
        if (local && local.sha !== 'dev') {
          this.upToDate.set(local.sha === sha);
        }
      });
  }
}

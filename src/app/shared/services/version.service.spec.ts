import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AppVersion, VersionService } from './version.service';

const GITHUB_COMMITS_URL =
  'https://api.github.com/repos/danielhokanson/qb-engineer-ui/commits/main';

describe('VersionService', () => {
  let service: VersionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VersionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ── load() ──────────────────────────────────────────────────────────────────

  it('load() sets local signal on success and calls checkLatest()', () => {
    const mockVersion: AppVersion = { version: '1.2.3', sha: 'abc1234' };

    service.load();

    const versionReq = httpMock.expectOne('/assets/version.json');
    expect(versionReq.request.method).toBe('GET');
    versionReq.flush(mockVersion);

    // checkLatest() is called immediately after — satisfy its request
    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    ghReq.flush({ sha: 'abc1234xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });

    expect(service.local()).toEqual(mockVersion);
  });

  it('load() handles error gracefully (sets local to null, still calls checkLatest())', () => {
    service.load();

    const versionReq = httpMock.expectOne('/assets/version.json');
    versionReq.flush('Not found', { status: 404, statusText: 'Not Found' });

    // checkLatest() still fires after catchError
    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    ghReq.flush(null, { status: 500, statusText: 'Server Error' });

    expect(service.local()).toBeNull();
  });

  // ── checkLatest() ────────────────────────────────────────────────────────────

  it('checkLatest() sets latestSha to first 7 chars of commit sha', () => {
    const fullSha = 'abc1234xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

    service.checkLatest();

    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    expect(ghReq.request.headers.get('Accept')).toBe('application/vnd.github+json');
    ghReq.flush({ sha: fullSha });

    expect(service.latestSha()).toBe('abc1234');
  });

  it('checkLatest() sets upToDate to true when local sha matches remote', () => {
    // Prime local signal with a matching sha
    service.local.set({ version: '1.0.0', sha: 'abc1234' });

    service.checkLatest();

    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    ghReq.flush({ sha: 'abc1234xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });

    expect(service.upToDate()).toBe(true);
  });

  it('checkLatest() sets upToDate to false when local sha differs from remote', () => {
    service.local.set({ version: '1.0.0', sha: 'old0000' });

    service.checkLatest();

    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    ghReq.flush({ sha: 'new1234xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });

    expect(service.upToDate()).toBe(false);
  });

  it('checkLatest() does not set upToDate when local sha is "dev"', () => {
    service.local.set({ version: '0.0.0', sha: 'dev' });

    service.checkLatest();

    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    ghReq.flush({ sha: 'abc1234xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });

    expect(service.upToDate()).toBeNull();
  });

  it('checkLatest() handles error gracefully and resets checking to false', () => {
    service.checkLatest();

    expect(service.checking()).toBe(true);

    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    ghReq.flush('Error', { status: 503, statusText: 'Service Unavailable' });

    expect(service.checking()).toBe(false);
    expect(service.latestSha()).toBeNull();
  });

  it('checkLatest() sets checking to true while in-flight and false on completion', () => {
    service.checkLatest();
    expect(service.checking()).toBe(true);

    const ghReq = httpMock.expectOne(GITHUB_COMMITS_URL);
    ghReq.flush({ sha: 'abc1234xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });

    expect(service.checking()).toBe(false);
  });
});

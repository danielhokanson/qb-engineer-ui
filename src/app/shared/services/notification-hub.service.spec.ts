import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { NotificationHubService } from './notification-hub.service';
import { SignalrService } from './signalr.service';
import { NotificationService } from './notification.service';
import { CapabilityService } from './capability.service';

describe('NotificationHubService', () => {
  let service: NotificationHubService;
  let mockSignalrService: {
    getOrCreateConnection: ReturnType<typeof vi.fn>;
    startConnection: ReturnType<typeof vi.fn>;
    stopConnection: ReturnType<typeof vi.fn>;
  };
  let mockNotificationService: {
    push: ReturnType<typeof vi.fn>;
  };
  let mockCapabilityService: {
    load: ReturnType<typeof vi.fn>;
  };
  let mockConnection: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConnection = {
      on: vi.fn(),
      off: vi.fn(),
    };

    mockSignalrService = {
      getOrCreateConnection: vi.fn().mockReturnValue(mockConnection),
      startConnection: vi.fn().mockResolvedValue(undefined),
      stopConnection: vi.fn().mockResolvedValue(undefined),
    };

    mockNotificationService = {
      push: vi.fn(),
    };

    mockCapabilityService = {
      // load() returns a cold Observable<void>; the SignalR
      // capabilityChanged handler subscribes to it (the bug fixed in
      // PR #55: without the .subscribe() the descriptor never
      // re-fetched). Returning of(undefined) makes the mock match the
      // real shape so the subscribe() call doesn't blow up.
      load: vi.fn().mockReturnValue(of(undefined)),
    };

    TestBed.configureTestingModule({
      providers: [
        NotificationHubService,
        { provide: SignalrService, useValue: mockSignalrService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: CapabilityService, useValue: mockCapabilityService },
      ],
    });

    service = TestBed.inject(NotificationHubService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('connect', () => {
    it('should start notification hub connection', async () => {
      await service.connect();
      expect(mockSignalrService.startConnection).toHaveBeenCalledWith('notifications');
    });

    it('should get or create connection for notifications hub', async () => {
      await service.connect();
      expect(mockSignalrService.getOrCreateConnection).toHaveBeenCalledWith('notifications');
    });

    it('should register notificationReceived handler', async () => {
      await service.connect();
      expect(mockConnection.on).toHaveBeenCalledWith('notificationReceived', expect.any(Function));
    });

    it('should push received notifications to NotificationService', async () => {
      await service.connect();

      const handler = mockConnection.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'notificationReceived',
      )?.[1] as (notification: unknown) => void;

      const mockNotification = { id: 1, title: 'Test', message: 'Hello' };
      handler?.(mockNotification);

      expect(mockNotificationService.push).toHaveBeenCalledWith(mockNotification);
    });

    it('should not start connection twice', async () => {
      await service.connect();
      await service.connect();
      expect(mockSignalrService.startConnection).toHaveBeenCalledTimes(1);
    });

    it('should register capabilityChanged handler and refresh on event', async () => {
      await service.connect();

      const handler = mockConnection.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'capabilityChanged',
      )?.[1] as (event: unknown) => void;

      expect(handler).toBeDefined();

      handler?.({ capabilityId: 'CAP-EXT-CHAT', enabled: false });

      expect(mockCapabilityService.load).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should stop the notifications connection', async () => {
      await service.connect();
      await service.disconnect();
      expect(mockSignalrService.stopConnection).toHaveBeenCalledWith('notifications');
    });

    it('should allow reconnection after disconnect', async () => {
      await service.connect();
      await service.disconnect();
      await service.connect();
      expect(mockSignalrService.startConnection).toHaveBeenCalledTimes(2);
    });
  });
});

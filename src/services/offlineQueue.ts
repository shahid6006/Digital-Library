import type { OfflineAttendanceEvent, LocationData } from '../types';

const QUEUE_STORAGE_KEY = 'library_offline_attendance_queue_v2';

type QueueListener = (events: OfflineAttendanceEvent[]) => void;
type NetworkListener = (isOnline: boolean) => void;

class OfflineQueueService {
  private queueListeners: Set<QueueListener> = new Set();
  private networkListeners: Set<NetworkListener> = new Set();
  private isSyncing = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.notifyNetworkListeners(true);
        this.processQueue();
      });
      window.addEventListener('offline', () => {
        this.notifyNetworkListeners(false);
      });
    }
  }

  public isOnline(): boolean {
    if (typeof navigator !== 'undefined') {
      return navigator.onLine;
    }
    return true;
  }

  public getQueue(): OfflineAttendanceEvent[] {
    try {
      const data = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data) as OfflineAttendanceEvent[];
    } catch {
      return [];
    }
  }

  private saveQueue(events: OfflineAttendanceEvent[]) {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(events));
      this.notifyQueueListeners(events);
    } catch (err) {
      console.error('Failed to save offline attendance queue:', err);
    }
  }

  public getPendingCount(): number {
    return this.getQueue().filter((e) => e.status === 'PENDING_SYNC').length;
  }

  public enqueueEvent(
    studentId: string,
    studentName: string,
    action: 'IN' | 'OUT',
    location: LocationData | null,
    triggerType: 'MANUAL' | 'GEOFENCE_AUTO' = 'MANUAL',
    geofenceVersion?: string,
    dwellMinutes?: number
  ): OfflineAttendanceEvent {
    const queue = this.getQueue();
    const now = new Date();
    const localId = `off_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const event: OfflineAttendanceEvent = {
      localId,
      studentId,
      studentName,
      action,
      timestamp: now.toISOString(),
      timeFormatted: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      location,
      triggerType,
      geofenceVersion,
      dwellMinutes,
      status: 'PENDING_SYNC',
      queueCreatedAt: now.toISOString(),
    };

    queue.push(event);
    this.saveQueue(queue);
    return event;
  }

  public updateEventStatus(
    localId: string,
    status: 'SYNCED' | 'SYNC_REVIEW_REQUIRED',
    syncError?: string
  ) {
    const queue = this.getQueue().map((e) => {
      if (e.localId === localId) {
        return { ...e, status, syncError };
      }
      return e;
    });
    this.saveQueue(queue);
  }

  public clearSynced() {
    const queue = this.getQueue().filter((e) => e.status !== 'SYNCED');
    this.saveQueue(queue);
  }

  public subscribeQueue(listener: QueueListener): () => void {
    this.queueListeners.add(listener);
    listener(this.getQueue());
    return () => {
      this.queueListeners.delete(listener);
    };
  }

  public subscribeNetwork(listener: NetworkListener): () => void {
    this.networkListeners.add(listener);
    listener(this.isOnline());
    return () => {
      this.networkListeners.delete(listener);
    };
  }

  private notifyQueueListeners(events: OfflineAttendanceEvent[]) {
    this.queueListeners.forEach((fn) => {
      try {
        fn(events);
      } catch (err) {
        console.error('Error in queue listener:', err);
      }
    });
  }

  private notifyNetworkListeners(isOnline: boolean) {
    this.networkListeners.forEach((fn) => {
      try {
        fn(isOnline);
      } catch (err) {
        console.error('Error in network listener:', err);
      }
    });
  }

  /**
   * Automatically process pending queue when online
   */
  public async processQueue(syncFn?: (event: OfflineAttendanceEvent) => Promise<boolean>): Promise<{
    synced: number;
    failed: number;
  }> {
    if (this.isSyncing || !this.isOnline()) {
      return { synced: 0, failed: 0 };
    }

    const pending = this.getQueue().filter((e) => e.status === 'PENDING_SYNC');
    if (pending.length === 0) {
      return { synced: 0, failed: 0 };
    }

    this.isSyncing = true;
    let synced = 0;
    let failed = 0;

    try {
      for (const item of pending) {
        try {
          if (syncFn) {
            const success = await syncFn(item);
            if (success) {
              this.updateEventStatus(item.localId, 'SYNCED');
              synced++;
            } else {
              this.updateEventStatus(item.localId, 'SYNC_REVIEW_REQUIRED', 'Validation failed during upload');
              failed++;
            }
          }
        } catch (err: any) {
          this.updateEventStatus(item.localId, 'SYNC_REVIEW_REQUIRED', err?.message || 'Sync failed');
          failed++;
        }
      }
    } finally {
      this.isSyncing = false;
      // Prune synced events after 10 seconds to keep clean UI
      setTimeout(() => {
        this.clearSynced();
      }, 10000);
    }

    return { synced, failed };
  }
}

export const offlineQueue = new OfflineQueueService();

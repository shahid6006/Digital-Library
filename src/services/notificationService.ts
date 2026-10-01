import type { NotificationItem, NotificationCategory, NotificationPriority } from '../types';

class NotificationService {
  private hasSentFirstInPromptDateKey: string | null = null;
  private sentEventIds: Set<string> = new Set();
  private lastDwellNotifySeconds: number | null = null;
  private permissionRequested: boolean = false;

  public isSupported(): boolean {
    return typeof window !== 'undefined' && ('Notification' in window || 'serviceWorker' in navigator);
  }

  public getPermission(): NotificationPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
    return Notification.permission;
  }

  public hasBeenRequested(): boolean {
    return this.permissionRequested || this.getPermission() !== 'default';
  }

  public async requestPermission(): Promise<NotificationPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
    this.permissionRequested = true;
    try {
      const res = await Notification.requestPermission();
      return res;
    } catch {
      return 'denied';
    }
  }

  /**
   * Fires a native Web / PWA system notification using Service Worker registration
   * (works while app is in background/minimized) with fallback to new Notification()
   */
  public async triggerNativeNotification(title: string, options?: NotificationOptions): Promise<void> {
    if (!this.isSupported()) return;
    if (this.getPermission() !== 'granted') return;

    const notificationPayload: NotificationOptions = {
      icon: '/pwa-192x192.png',
      badge: '/icon.svg',
      tag: options?.tag || 'library_notification',
      ...options,
    };

    // Prefer Service Worker registration showNotification so it appears in OS notification shade
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration && typeof registration.showNotification === 'function') {
          await registration.showNotification(title, notificationPayload);
          return;
        }
      } catch (swErr) {
        console.warn('Service worker showNotification notice:', swErr);
      }
    }

    // Fallback to Window Notification API
    try {
      new Notification(title, notificationPayload);
    } catch (err) {
      console.warn('Window Notification failed:', err);
    }
  }

  /**
   * First manual IN notification of the day.
   * Requirement 14 & 21:
   * "Library Attendance"
   * "You are inside the attendance area. Press IN to record your first entry today."
   */
  public maybeNotifyFirstManualIn(dateKey: string, onPrompt?: () => void): boolean {
    if (this.hasSentFirstInPromptDateKey === dateKey) {
      return false; // Already notified today
    }

    this.hasSentFirstInPromptDateKey = dateKey;
    this.triggerNativeNotification('Library Attendance', {
      body: 'You are inside the attendance area. Press IN to record your first entry today.',
      tag: `first_in_${dateKey}`,
    });
    onPrompt?.();
    return true;
  }

  /**
   * Waiting for automatic return-IN dwell notification
   * Requirement 14:
   * "Entry Verification"
   * "Stay inside the attendance area for 1 minute or press IN NOW."
   */
  public notifyDwellInProgress(remainingSeconds: number) {
    // Only notify at initial entry, 30s, and 10s to avoid notification spam
    const shouldNotify =
      this.lastDwellNotifySeconds === null ||
      (this.lastDwellNotifySeconds > 30 && remainingSeconds <= 30) ||
      (this.lastDwellNotifySeconds > 10 && remainingSeconds <= 10);

    if (shouldNotify) {
      this.lastDwellNotifySeconds = remainingSeconds;
      const body =
        remainingSeconds > 0
          ? `Stay inside the attendance area for 1 minute or press IN NOW. (${remainingSeconds}s remaining)`
          : 'Inside attendance area. Verifying attendance...';

      this.triggerNativeNotification('Entry Verification', {
        body,
        tag: 'dwell_verification_progress',
        renotify: false,
      } as any);
    }
  }

  public resetDwellNotification() {
    this.lastDwellNotifySeconds = null;
  }

  /**
   * Attendance IN / OUT notification to student
   * Requirement 14:
   * For Manual IN:
   * "Library Entry Recorded" - "You have been marked IN."
   * For Automatic IN:
   * "Library Entry Recorded" - "You have been automatically marked IN after staying inside the attendance area."
   * For Manual OUT:
   * "Library Exit Recorded" - "You have been marked OUT."
   * For Automatic OUT:
   * "Library Exit Recorded" - "You have been automatically marked OUT after leaving the attendance area."
   */
  public notifyAttendanceChange(
    action: 'IN' | 'OUT',
    eventId: string,
    timeFormatted?: string,
    triggerType: 'MANUAL' | 'GEOFENCE_AUTO' = 'MANUAL'
  ) {
    if (this.sentEventIds.has(eventId)) {
      return; // Deduplicated
    }
    this.sentEventIds.add(eventId);
    this.resetDwellNotification();

    const title = action === 'IN' ? 'Library Entry Recorded' : 'Library Exit Recorded';
    const body =
      action === 'IN'
        ? 'Library Entry Recorded — You are now marked IN at the library.'
        : 'Library Exit Recorded — You have been marked OUT of the library.';

    this.triggerNativeNotification(title, {
      body,
      tag: `attendance_${eventId}`,
      renotify: true,
    } as any);
  }
}

export const notificationService = new NotificationService();

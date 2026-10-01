import type { NotificationItem, NotificationCategory, NotificationPriority } from '../types';

class NotificationService {
  private hasSentFirstInPromptDateKey: string | null = null;
  private sentEventIds: Set<string> = new Set();

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  public getPermission(): NotificationPermission {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  public async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';
    try {
      const res = await Notification.requestPermission();
      return res;
    } catch {
      return 'denied';
    }
  }

  /**
   * Fires a native Web / PWA system notification if permission is granted
   */
  public triggerNativeNotification(title: string, options?: NotificationOptions) {
    if (!this.isSupported()) return;
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          icon: '/icon.svg',
          badge: '/icon.svg',
          ...options,
        });
      } catch (err) {
        console.warn('Native notification failed:', err);
      }
    }
  }

  /**
   * First manual IN notification of the day.
   * Only prompted ONCE per attendance day when student enters the geofence before first IN.
   */
  public maybeNotifyFirstManualIn(dateKey: string, onPrompt: () => void): boolean {
    if (this.hasSentFirstInPromptDateKey === dateKey) {
      return false; // Already notified today
    }

    this.hasSentFirstInPromptDateKey = dateKey;
    this.triggerNativeNotification('Library Attendance Area', {
      body: "You're inside the library attendance area. Press IN to record your first entry today.",
      tag: `first_in_${dateKey}`,
    });
    onPrompt();
    return true;
  }

  /**
   * Attendance IN / OUT notification to student
   * Strictly prevents duplicate notifications for the same transition!
   */
  public notifyAttendanceChange(
    action: 'IN' | 'OUT',
    eventId: string,
    timeFormatted: string
  ) {
    if (this.sentEventIds.has(eventId)) {
      return; // Deduplicated
    }
    this.sentEventIds.add(eventId);

    const title = action === 'IN' ? 'Library Entry Recorded' : 'Library Exit Recorded';
    const body =
      action === 'IN'
        ? `You are now marked IN at the library at ${timeFormatted}.`
        : `You have been marked OUT of the library at ${timeFormatted}.`;

    this.triggerNativeNotification(title, {
      body,
      tag: `attendance_${eventId}`,
    });
  }
}

export const notificationService = new NotificationService();

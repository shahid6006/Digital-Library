import { useState, useEffect } from 'react';
import {
  Bell,
  X,
  CheckCheck,
  Check,
  AlertCircle,
  Clock,
  Sparkles,
  Info,
  Calendar,
  Volume2,
} from 'lucide-react';
import { api } from '../services/api';
import { notificationService } from '../services/notificationService';
import type { NotificationItem } from '../types';

interface StudentNotificationCenterModalProps {
  studentId: string;
  isOpen: boolean;
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

export function StudentNotificationCenterModal({
  studentId,
  isOpen,
  onClose,
  onUnreadCountChange,
}: StudentNotificationCenterModalProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (notificationService.isSupported()) {
      setPermissionState(notificationService.getPermission());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!studentId) return;

    const unsub = api.subscribeNotifications(studentId, false, (list) => {
      setNotifications(list);
      const unread = list.filter((n) => !n.read).length;
      onUnreadCountChange?.(unread);
    });

    return () => unsub();
  }, [studentId, onUnreadCountChange]);

  if (!isOpen) return null;

  const filtered = notifications.filter((n) => {
    if (filter === 'UNREAD') return !n.read;
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleRequestPermission = async () => {
    const res = await notificationService.requestPermission();
    setPermissionState(res);
    if (res === 'granted') {
      setFeedback('Browser notifications enabled successfully!');
      notificationService.triggerNativeNotification('Notifications Enabled', {
        body: 'You will now receive alerts for library attendance and admin announcements.',
      });
    } else if (res === 'denied') {
      setFeedback('Notifications blocked in browser settings. You can still view all messages here.');
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleMarkAsRead = async (id: string) => {
    await api.markNotificationAsRead(id);
  };

  const handleMarkAllAsRead = async () => {
    await api.markAllNotificationsAsRead('STUDENT', studentId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-800">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-stone-900 text-base">Notification Center</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-600 text-white">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-500">Attendance records &amp; library announcements</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Permission Banner (Feature 1 & 18) */}
        {permissionState !== 'granted' && notificationService.isSupported() && (
          <div className="px-4 py-2.5 bg-amber-50/80 border-b border-amber-200/80 flex items-center justify-between text-xs text-amber-900">
            <div className="flex items-center gap-2 pr-2">
              <Volume2 className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Enable browser notifications to receive entry/exit alerts when outside app.</span>
            </div>
            <button
              type="button"
              onClick={handleRequestPermission}
              className="px-2.5 py-1 font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition text-xs shrink-0 cursor-pointer"
            >
              Enable
            </button>
          </div>
        )}

        {feedback && (
          <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <Check className="w-3.5 h-3.5" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Filter and Mark All Read actions */}
        <div className="px-4 py-2.5 bg-white border-b border-stone-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1 rounded-md font-medium transition cursor-pointer ${
                filter === 'ALL' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('UNREAD')}
              className={`px-3 py-1 rounded-md font-medium transition cursor-pointer ${
                filter === 'UNREAD' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:text-amber-950 transition cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all as read</span>
            </button>
          )}
        </div>

        {/* List of Notifications */}
        <div className="overflow-y-auto flex-1 divide-y divide-stone-100 p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-stone-400">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-stone-600">No notifications yet</p>
              <p className="text-xs text-stone-400 mt-1">
                {filter === 'UNREAD'
                  ? 'All notifications have been read.'
                  : 'Attendance confirmations and library announcements will appear here.'}
              </p>
            </div>
          ) : (
            filtered.map((item) => {
              const isUnread = !item.read;
              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl transition flex gap-3 ${
                    isUnread ? 'bg-amber-50/50 border border-amber-200/60' : 'bg-white hover:bg-stone-50'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {item.category === 'ATTENDANCE' ? (
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                        <Clock className="w-4 h-4" />
                      </div>
                    ) : item.category === 'MEMBERSHIP' ? (
                      <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
                        <Calendar className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center">
                        <Info className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-900 text-xs sm:text-sm">
                          {item.title}
                        </span>
                        {item.priority === 'important' && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-red-100 text-red-700">
                            Important
                          </span>
                        )}
                      </div>
                      {isUnread && (
                        <button
                          type="button"
                          onClick={() => handleMarkAsRead(item.id)}
                          title="Mark as read"
                          className="text-[11px] font-medium text-amber-800 hover:text-amber-950 transition cursor-pointer"
                        >
                          Mark read
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-stone-600 mt-1 leading-relaxed">{item.message}</p>

                    <div className="flex items-center gap-3 mt-2 text-[10px] text-stone-400">
                      <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>•</span>
                      <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>From {item.createdBy || 'Library'}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-xs text-stone-500">
          <span>Official attendance records cannot be deleted</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-800 font-semibold rounded-lg transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

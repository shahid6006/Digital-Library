import { useState, useEffect, useMemo } from 'react';
import {
  Bell,
  Search,
  CheckCheck,
  Send,
  Calendar,
  Clock,
  User,
  Users,
  ShieldAlert,
  Radio,
  Filter,
  ExternalLink,
  Trash2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import type { NotificationItem, NotificationCategory } from '../types';
import { AdminMessageComposerModal } from './AdminMessageComposerModal';
import { AdminStudentProfileModal } from './AdminStudentProfileModal';

export function AdminNotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | NotificationCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showUnreadOnly, setShowUnreadOnly] = useState<boolean>(false);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<string | null>(null);
  const [preSelectedStudentForMessage, setPreSelectedStudentForMessage] = useState<string | null>(null);

  useEffect(() => {
    // Check monthly completions on mount
    api.checkMembershipMonthCompletions();

    const unsub = api.subscribeNotifications(null, true, (list) => {
      setNotifications(list);
    });

    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    let list = notifications;

    if (selectedCategory !== 'ALL') {
      list = list.filter((n) => n.category === selectedCategory);
    }

    if (showUnreadOnly) {
      list = list.filter((n) => !n.read);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.message.toLowerCase().includes(q) ||
          (n.recipientStudentName && n.recipientStudentName.toLowerCase().includes(q))
      );
    }

    return list;
  }, [notifications, selectedCategory, showUnreadOnly, searchQuery]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAsRead = async (id: string) => {
    await api.markNotificationAsRead(id);
  };

  const handleMarkAllAsRead = async () => {
    await api.markAllNotificationsAsRead('ADMIN');
  };

  const getCategoryBadge = (cat: NotificationCategory) => {
    switch (cat) {
      case 'ATTENDANCE':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-800">Attendance</span>;
      case 'MEMBERSHIP':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-100 text-amber-900">Membership</span>;
      case 'STUDENTS':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-100 text-blue-800">Students</span>;
      case 'SYSTEM':
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-purple-100 text-purple-800">System</span>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-stone-200 shadow-2xs">
        <div>
          <div className="text-xs uppercase font-semibold tracking-wider text-amber-700 mb-0.5">
            Admin Communications
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-2.5">
            <span>Notification Center</span>
            {unreadCount > 0 && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-600 text-white">
                {unreadCount} unread
              </span>
            )}
          </h2>
          <p className="text-xs text-stone-500 mt-1">
            Real-time audit log of student arrivals, monthly membership completions, and system events.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 rounded-xl transition cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all read</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setPreSelectedStudentForMessage(null);
              setComposerOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-xl shadow-xs transition cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Notification</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-2xs space-y-3">
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-amber-700 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            All Notifications ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('ATTENDANCE')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 cursor-pointer ${
              selectedCategory === 'ATTENDANCE'
                ? 'bg-emerald-700 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Attendance ({notifications.filter((n) => n.category === 'ATTENDANCE').length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('MEMBERSHIP')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 cursor-pointer ${
              selectedCategory === 'MEMBERSHIP'
                ? 'bg-amber-800 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Membership ({notifications.filter((n) => n.category === 'MEMBERSHIP').length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('STUDENTS')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 cursor-pointer ${
              selectedCategory === 'STUDENTS'
                ? 'bg-blue-700 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Students ({notifications.filter((n) => n.category === 'STUDENTS').length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCategory('SYSTEM')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition shrink-0 cursor-pointer ${
              selectedCategory === 'SYSTEM'
                ? 'bg-purple-700 text-white shadow-2xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            System ({notifications.filter((n) => n.category === 'SYSTEM').length})
          </button>
        </div>

        {/* Search and Unread Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search notifications by title, student name, or message..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 bg-stone-50 rounded-xl border border-stone-200 text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-stone-600 font-medium cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={showUnreadOnly}
              onChange={(e) => setShowUnreadOnly(e.target.checked)}
              className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
            />
            <span>Unread only</span>
          </label>
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs divide-y divide-stone-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-400">
            <Bell className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-semibold text-stone-700">No notifications found</p>
            <p className="text-xs text-stone-400 mt-1">
              {searchQuery
                ? 'No notifications match your search query.'
                : 'System alerts and student events will be logged here.'}
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const isUnread = !item.read;
            const targetStudentId = item.recipientStudentId || item.metadata?.studentId;

            return (
              <div
                key={item.id}
                className={`p-4 transition flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                  isUnread ? 'bg-amber-50/40' : 'hover:bg-stone-50'
                }`}
              >
                <div className="flex gap-3 items-start flex-1 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {item.category === 'MEMBERSHIP' ? (
                      <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center font-bold">
                        <Calendar className="w-4 h-4" />
                      </div>
                    ) : item.category === 'ATTENDANCE' ? (
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                        <Clock className="w-4 h-4" />
                      </div>
                    ) : item.category === 'STUDENTS' ? (
                      <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-bold">
                        <User className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-bold">
                        <Radio className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-stone-900 text-sm">{item.title}</span>
                      {getCategoryBadge(item.category)}
                      {item.priority === 'important' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-red-100 text-red-700">
                          Important
                        </span>
                      )}
                      {isUnread && (
                        <span className="w-2 h-2 rounded-full bg-amber-600 inline-block" />
                      )}
                    </div>

                    <p className="text-xs text-stone-700 mt-1 leading-relaxed">
                      {item.message}
                    </p>

                    <div className="flex items-center gap-3 mt-2 text-[11px] text-stone-400">
                      <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>•</span>
                      <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>Source: {item.createdBy}</span>
                    </div>
                  </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-2 sm:self-center shrink-0">
                  {targetStudentId && (
                    <button
                      type="button"
                      onClick={() => setSelectedStudentForProfile(targetStudentId)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-100/70 hover:bg-amber-100 rounded-lg transition cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>View Profile</span>
                    </button>
                  )}

                  {isUnread && (
                    <button
                      type="button"
                      onClick={() => handleMarkAsRead(item.id)}
                      className="px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition cursor-pointer"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Admin Message Composer Modal */}
      {composerOpen && (
        <AdminMessageComposerModal
          isOpen={composerOpen}
          onClose={() => setComposerOpen(false)}
          preSelectedStudentId={preSelectedStudentForMessage}
        />
      )}

      {/* Admin Student Profile Modal */}
      {selectedStudentForProfile && (
        <AdminStudentProfileModal
          studentId={selectedStudentForProfile}
          isOpen={!!selectedStudentForProfile}
          onClose={() => setSelectedStudentForProfile(null)}
          onOpenMessageComposer={(sid) => {
            setSelectedStudentForProfile(null);
            setPreSelectedStudentForMessage(sid);
            setComposerOpen(true);
          }}
        />
      )}
    </div>
  );
}

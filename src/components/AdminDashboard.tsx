import { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
  LogIn,
  RefreshCw,
  Eye,
  Download,
  AlertCircle,
  Radio,
  UserCheck,
  UserX,
  MapPin,
  Map,
  Bell,
} from 'lucide-react';
import { api } from '../services/api';
import type { AdminAttendanceReport, ActivityEvent } from '../types';
import { StudentHistoryModal } from './StudentHistoryModal';
import { StudentManagement } from './StudentManagement';
import { LocationModal } from './LocationModal';
import { LocationHistoryView } from './LocationHistoryView';
import { AdminLiveMapView } from './AdminLiveMapView';
import { AdminLiveDashboard } from './AdminLiveDashboard';
import { AdminGeofenceSettings } from './AdminGeofenceSettings';
import { AdminNotificationCenter } from './AdminNotificationCenter';

interface AdminDashboardProps {
  onLogout: () => void;
}

// Helpers for date calculations
function getTodayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function offsetDateKey(dateKey: string, offsetDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateKey: string): string {
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateKey;
  }
}

export function AdminDashboard({ onLogout }: AdminDashboardProps) {
  // Navigation between Daily Attendance view, Live Dashboard, Live GPS Map view, Location History view, Geofence Settings, Student Management view, and Notifications
  const [adminView, setAdminView] = useState<'attendance' | 'live_dashboard' | 'live_map' | 'location_history' | 'geofence' | 'management' | 'notifications'>('attendance');

  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateKey());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT' | 'INSIDE' | 'OUTSIDE'>('ALL');
  const [report, setReport] = useState<AdminAttendanceReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState<string | null>(null);
  const [liveSyncNotification, setLiveSyncNotification] = useState<string | null>(null);
  const [adminUnreadCount, setAdminUnreadCount] = useState<number>(0);

  // Listen to unread notifications for admin badge
  useEffect(() => {
    const unsub = api.subscribeNotifications(null, true, (list) => {
      setAdminUnreadCount(list.filter((n) => !n.read).length);
    });
    return () => unsub();
  }, []);

  // FEATURE: Location Inspection Modal State
  const [selectedStudentForLocation, setSelectedStudentForLocation] = useState<{
    studentName: string;
    events: ActivityEvent[];
    initialEventId?: string;
  } | null>(null);

  // Real-time Firestore subscription to daily attendance for selected date
  useEffect(() => {
    if (adminView === 'attendance') {
      setIsLoading(true);
      setError(null);
      const unsub = api.subscribeToDailyAttendance(selectedDate, (newReport) => {
        setReport(newReport);
        setIsLoading(false);
      });
      return () => unsub();
    }
  }, [selectedDate, adminView]);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const data = await api.getAdminAttendance(selectedDate);
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh records.');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter students based on search and status
  const filteredStudents = useMemo(() => {
    if (!report?.students) return [];

    let list = report.students;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((s) => s.fullName.toLowerCase().includes(q));
    }

    if (statusFilter === 'PRESENT') {
      list = list.filter((s) => s.isPresent);
    } else if (statusFilter === 'ABSENT') {
      list = list.filter((s) => !s.isPresent);
    } else if (statusFilter === 'INSIDE') {
      list = list.filter((s) => s.dailyStatus === 'INSIDE');
    } else if (statusFilter === 'OUTSIDE') {
      list = list.filter((s) => s.dailyStatus === 'OUTSIDE');
    }

    return list;
  }, [report, searchQuery, statusFilter]);

  const handlePrevDay = () => {
    setSelectedDate((prev) => offsetDateKey(prev, -1));
  };

  const handleNextDay = () => {
    setSelectedDate((prev) => offsetDateKey(prev, 1));
  };

  const handleToday = () => {
    setSelectedDate(getTodayDateKey());
  };

  // Export CSV for library admin records
  const handleExportCSV = () => {
    if (!report || report.students.length === 0) return;

    const headers = [
      'Student ID',
      'Student Name',
      'Status',
      'Last Action',
      'Attendance Sequence',
      'Total Visits',
      'Location Data Captured',
    ];
    const rows = report.students.map((s) => {
      const seq =
        s.events.length > 0
          ? s.events
              .map(
                (e) =>
                  `${e.action} ${e.timeFormatted}${
                    e.location ? ` [${e.location.latitude.toFixed(4)},${e.location.longitude.toFixed(4)}]` : ''
                  }`
              )
              .join(' -> ')
          : 'No attendance';
      const last = s.lastAction ? `${s.lastAction.action} (${s.lastAction.timeFormatted})` : 'N/A';
      const locCount = s.events.filter((e) => e.location != null).length;
      return [
        `"${s.studentId}"`,
        `"${s.fullName}"`,
        `"${s.dailyStatus}"`,
        `"${last}"`,
        `"${seq}"`,
        `"${s.totalVisits}"`,
        `"${locCount} of ${s.events.length} events"`,
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `library_attendance_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isToday = selectedDate === getTodayDateKey();

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Admin Section Tabs: Attendance vs Location History vs Student Management */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-stone-200 pb-4">
        <div className="flex flex-wrap items-center gap-2 p-1 bg-stone-200/80 rounded-lg">
          <button
            type="button"
            onClick={() => setAdminView('attendance')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition cursor-pointer ${
              adminView === 'attendance'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Daily Attendance Register
          </button>
          <button
            type="button"
            onClick={() => setAdminView('live_dashboard')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition cursor-pointer ${
              adminView === 'live_dashboard'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <span>Live Dashboard</span>
          </button>
          <button
            type="button"
            onClick={() => setAdminView('live_map')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition cursor-pointer ${
              adminView === 'live_map'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Map className="w-3.5 h-3.5 text-amber-600" />
            <span>Live GPS Map</span>
          </button>
          <button
            type="button"
            onClick={() => setAdminView('location_history')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition cursor-pointer ${
              adminView === 'location_history'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Map className="w-3.5 h-3.5 text-amber-600" />
            <span>Location History Map</span>
          </button>
          <button
            type="button"
            onClick={() => setAdminView('geofence')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition cursor-pointer ${
              adminView === 'geofence'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-amber-700" />
            <span>Attendance Location &amp; Geofence</span>
          </button>
          <button
            type="button"
            onClick={() => setAdminView('management')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition cursor-pointer ${
              adminView === 'management'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Student Management
          </button>
          <button
            type="button"
            onClick={() => setAdminView('notifications')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition cursor-pointer ${
              adminView === 'notifications'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Bell className="w-3.5 h-3.5 text-amber-700" />
            <span>Notification Center</span>
            {adminUnreadCount > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-600 text-white rounded-full text-[10px] font-bold">
                {adminUnreadCount}
              </span>
            )}
          </button>
        </div>

        {adminView === 'attendance' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!report || report.students.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg shadow-2xs transition disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg shadow-2xs transition cursor-pointer"
              title="Refresh records"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        )}
      </div>

      {/* Render Selected View */}
      {adminView === 'notifications' ? (
        <AdminNotificationCenter />
      ) : adminView === 'management' ? (
        <StudentManagement />
      ) : adminView === 'geofence' ? (
        <AdminGeofenceSettings />
      ) : adminView === 'live_dashboard' ? (
        <AdminLiveDashboard onSelectStudentLocation={setSelectedStudentForLocation} />
      ) : adminView === 'live_map' ? (
        <AdminLiveMapView />
      ) : adminView === 'location_history' ? (
        <LocationHistoryView />
      ) : (
        /* Render Daily Attendance View */
        <>
          {/* Header & Live Alert */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="text-xs uppercase font-semibold tracking-wider text-amber-700 mb-0.5">
                Attendance Tracking
              </div>
              <h2 className="text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-3">
                <span>LIBRARY ADMIN</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Sync
                </span>
              </h2>
            </div>
          </div>

          {/* Live sync banner notification */}
          {liveSyncNotification && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-center justify-between animate-fade-in">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-amber-600 animate-pulse" />
                <span className="font-medium">{liveSyncNotification}</span>
              </div>
              <span className="text-[11px] text-amber-700">Updated automatically</span>
            </div>
          )}

          {/* Date Navigation Bar */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-700 border border-stone-200">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-stone-500 font-medium">Selected Date</div>
                  <div className="text-lg font-bold text-stone-900">
                    [ {formatDateDisplay(selectedDate)} ]
                  </div>
                </div>
              </div>

              {/* Date controls */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevDay}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous Day</span>
                </button>

                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-stone-800 bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                />

                <button
                  type="button"
                  onClick={handleNextDay}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
                >
                  <span>Next Day</span>
                  <ChevronRight className="w-4 h-4" />
                </button>

                {!isToday && (
                  <button
                    type="button"
                    onClick={handleToday}
                    className="px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition cursor-pointer"
                  >
                    Today
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Summary Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
                  Registered Students
                </p>
                <p className="text-2xl sm:text-3xl font-extrabold text-stone-900 mt-1">
                  {report?.summary.totalRegistered ?? 0}
                </p>
                <p className="text-[11px] text-stone-400 mt-0.5">Total registered</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-4 sm:p-5 flex items-center justify-between bg-gradient-to-br from-white to-emerald-50/20">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-emerald-800">
                  Present Today
                </p>
                <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700 mt-1">
                  {report?.summary.presentToday ?? 0}
                </p>
                <p className="text-[11px] text-emerald-600/80 mt-0.5">Marked &ge; 1 IN action</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
                  Absent Today
                </p>
                <p className="text-2xl sm:text-3xl font-extrabold text-stone-700 mt-1">
                  {report?.summary.absentToday ?? 0}
                </p>
                <p className="text-[11px] text-stone-400 mt-0.5">No attendance marked</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-stone-100 text-stone-500 flex items-center justify-center shrink-0">
                <UserX className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-4 sm:p-5 flex items-center justify-between bg-gradient-to-br from-white to-emerald-50/30">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-emerald-800">
                  Currently Inside
                </p>
                <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700 mt-1 flex items-center gap-1.5">
                  <span>{report?.summary.currentlyInside ?? 0}</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                </p>
                <p className="text-[11px] text-emerald-600/80 mt-0.5">Inside library now</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <LogIn className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search registered student by name..."
                className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 hover:text-stone-700 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 bg-stone-100 rounded-lg border border-stone-200">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                All Registered ({report?.students.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('PRESENT')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'PRESENT'
                    ? 'bg-white text-emerald-800 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Present ({report?.summary.presentToday ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ABSENT')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'ABSENT'
                    ? 'bg-white text-stone-800 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-stone-400" />
                Absent ({report?.summary.absentToday ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('INSIDE')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'INSIDE'
                    ? 'bg-white text-emerald-800 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Inside ({report?.students.filter((s) => s.dailyStatus === 'INSIDE').length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('OUTSIDE')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'OUTSIDE'
                    ? 'bg-white text-rose-800 shadow-2xs font-semibold'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Outside ({report?.students.filter((s) => s.dailyStatus === 'OUTSIDE').length ?? 0})
              </button>
            </div>
          </div>

          {/* Main Daily Attendance Table */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-stone-900 tracking-tight">
                  Daily Attendance Register &bull; {formatDateDisplay(selectedDate)}
                </h3>
                <p className="text-xs text-stone-500">
                  One row per student with chronological sequence, GPS coordinates, and interactive map triggers
                </p>
              </div>
              <div className="text-xs text-stone-500 font-mono">
                Showing {filteredStudents.length} of {report?.students.length ?? 0} students
              </div>
            </div>

            {isLoading ? (
              <div className="py-16 text-center text-stone-400 flex flex-col items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin mb-3 text-stone-500" />
                <p className="text-sm font-medium">Loading daily attendance records...</p>
              </div>
            ) : error ? (
              <div className="p-8 text-center">
                <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                <p className="text-sm text-rose-700 font-medium">{error}</p>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="py-16 text-center px-4">
                <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3 text-stone-400">
                  <Users className="w-6 h-6" />
                </div>
                <p className="text-base font-semibold text-stone-800">
                  {searchQuery
                    ? `No students matching "${searchQuery}" on this date.`
                    : `No registered students found for ${formatDateDisplay(selectedDate)}.`}
                </p>
                <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto">
                  {searchQuery
                    ? 'Try searching with a different name or clear the search query.'
                    : 'Use the Student Management tab to add registered students.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50/70 text-[11px] font-semibold uppercase tracking-wider text-stone-600">
                      <th className="py-3.5 px-6">Student</th>
                      <th className="py-3.5 px-6">Status</th>
                      <th className="py-3.5 px-6">Today&apos;s Activity &amp; GPS Map</th>
                      <th className="py-3.5 px-6 text-center">Visits</th>
                      <th className="py-3.5 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredStudents.map((student) => {
                      const initials = `${student.firstName[0] || ''}${student.lastName[0] || ''}`.toUpperCase();
                      const eventsWithLocation = student.events.filter((e) => e.location != null);

                      return (
                        <tr
                          key={student.studentId}
                          className="hover:bg-stone-50/80 transition-colors group"
                        >
                          {/* Student info */}
                          <td className="py-4 px-6 align-middle">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-stone-100 border border-stone-300 flex items-center justify-center text-xs font-bold text-stone-800 shrink-0">
                                {initials}
                              </div>
                              <div>
                                <div className="font-semibold text-stone-900 group-hover:text-amber-800 transition-colors flex items-center gap-1.5">
                                  <span>{student.fullName}</span>
                                  {student.studentStatus === 'inactive' && (
                                    <span className="text-[10px] bg-stone-200 text-stone-600 px-1.5 py-0.2 rounded font-normal">
                                      Inactive
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-stone-400 font-mono">
                                  ID: {student.studentId.substring(0, 10)}...
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Status & Last Recorded Location */}
                          <td className="py-4 px-6 align-middle">
                            {student.dailyStatus === 'INSIDE' ? (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                                  INSIDE
                                </span>
                                {student.lastAction && (
                                  <div className="text-[11px] text-stone-600 font-mono">
                                    IN {student.lastAction.timeFormatted}
                                  </div>
                                )}
                                {student.lastAction?.location && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedStudentForLocation({
                                        studentName: student.fullName,
                                        events: student.events,
                                        initialEventId: student.events[student.events.length - 1]?.id,
                                      })
                                    }
                                    className="flex items-center gap-1 text-[10px] text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                                    title="View last recorded location"
                                  >
                                    <MapPin className="w-3 h-3 text-amber-600" />
                                    <span>Last recorded location</span>
                                  </button>
                                )}
                              </div>
                            ) : student.dailyStatus === 'OUTSIDE' ? (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                  OUTSIDE
                                </span>
                                {student.lastAction && (
                                  <div className="text-[11px] text-stone-600 font-mono">
                                    OUT {student.lastAction.timeFormatted}
                                  </div>
                                )}
                                {student.lastAction?.location && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedStudentForLocation({
                                        studentName: student.fullName,
                                        events: student.events,
                                        initialEventId: student.events[student.events.length - 1]?.id,
                                      })
                                    }
                                    className="flex items-center gap-1 text-[10px] text-amber-700 hover:text-amber-800 font-medium cursor-pointer"
                                    title="View last recorded location"
                                  >
                                    <MapPin className="w-3 h-3 text-amber-600" />
                                    <span>Last recorded location</span>
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-600 border border-stone-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                                  ABSENT
                                </span>
                                <div className="text-[11px] text-stone-400 mt-0.5">
                                  No attendance
                                </div>
                              </div>
                            )}
                          </td>

                          {/* Today's Activity & Location view trigger (Section 9) */}
                          <td className="py-4 px-6 align-middle">
                            {student.events.length === 0 ? (
                              <span className="text-xs text-stone-400 italic">
                                No attendance
                              </span>
                            ) : (
                              <div className="space-y-2 py-1">
                                {/* Chronological events sequence */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {student.events.map((evt, idx) => (
                                    <div key={evt.id || idx} className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setSelectedStudentForLocation({
                                            studentName: student.fullName,
                                            events: student.events,
                                            initialEventId: evt.id,
                                          })
                                        }
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition cursor-pointer ${
                                          evt.action === 'IN'
                                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                                            : 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-200'
                                        }`}
                                        title={
                                          evt.location
                                            ? `Click to view map (${evt.action} ${evt.timeFormatted} &bull; accuracy &plusmn;${Math.round(evt.location.accuracy || 10)}m)`
                                            : `No location recorded (${evt.action} ${evt.timeFormatted})`
                                        }
                                      >
                                        {evt.action === 'IN' ? (
                                          <span className="text-emerald-600 font-bold">🟢 IN</span>
                                        ) : (
                                          <span className="text-rose-600 font-bold">🔴 OUT</span>
                                        )}
                                        <span>{evt.timeFormatted}</span>
                                        {evt.triggerType === 'GEOFENCE_AUTO' ? (
                                          <span
                                            className="text-[9px] bg-purple-100 text-purple-800 border border-purple-200 px-1.5 py-0.5 rounded font-mono font-bold"
                                            title="Triggered automatically by geofence"
                                          >
                                            ⚡ GEOFENCE_AUTO
                                          </span>
                                        ) : (
                                          <span
                                            className="text-[9px] bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded font-mono font-bold"
                                            title="Manually initiated attendance"
                                          >
                                            MANUAL
                                          </span>
                                        )}
                                        {evt.location && (
                                          <MapPin className="w-3 h-3 text-amber-700 ml-0.5" />
                                        )}
                                      </button>

                                      {idx < student.events.length - 1 && (
                                        <span className="text-stone-300 font-bold select-none text-xs">
                                          →
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>

                                {/* View Map trigger showing all location events (Requirement 9) */}
                                <div className="flex items-center gap-2 pt-0.5">
                                  <span className="text-[11px] font-medium text-stone-500 flex items-center gap-1">
                                    <MapPin className="w-3 h-3 text-stone-400" />
                                    <span>
                                      {eventsWithLocation.length}{' '}
                                      {eventsWithLocation.length === 1 ? 'Location' : 'Locations'}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedStudentForLocation({
                                        studentName: student.fullName,
                                        events: student.events,
                                      })
                                    }
                                    className="px-2.5 py-0.5 text-[11px] font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-md transition cursor-pointer shadow-2xs"
                                  >
                                    [VIEW MAP]
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>

                          {/* Total Visits & Duration */}
                          <td className="py-4 px-6 align-middle text-center">
                            {student.totalVisits > 0 ? (
                              <>
                                <div className="font-semibold text-stone-900 text-xs">
                                  {student.totalVisits} {student.totalVisits === 1 ? 'visit' : 'visits'}
                                </div>
                                {student.totalMinutesInside > 0 && (
                                  <div className="text-[11px] text-stone-400 font-mono mt-0.5">
                                    {Math.floor(student.totalMinutesInside / 60)}h{' '}
                                    {student.totalMinutesInside % 60}m
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-stone-400">—</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-4 px-6 align-middle text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedStudentForHistory(student.studentId)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 hover:text-stone-900 rounded-md transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>History</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Historical Student History Modal */}
      {selectedStudentForHistory && (
        <StudentHistoryModal
          studentId={selectedStudentForHistory}
          onClose={() => setSelectedStudentForHistory(null)}
        />
      )}

      {/* Interactive Location & Map Modal */}
      {selectedStudentForLocation && (
        <LocationModal
          studentName={selectedStudentForLocation.studentName}
          dateStr={formatDateDisplay(selectedDate)}
          events={selectedStudentForLocation.events}
          initialSelectedEventId={selectedStudentForLocation.initialEventId}
          onClose={() => setSelectedStudentForLocation(null)}
        />
      )}
    </div>
  );
}

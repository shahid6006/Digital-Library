import { useState, useEffect } from 'react';
import {
  Radio,
  Search,
  Users,
  Clock,
  MapPin,
  CheckCircle2,
  Timer,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { api } from '../services/api';
import { getTodayDateKey, formatLocalTime } from '../utils/dateUtils';
import type {
  AdminAttendanceReport,
  AttendanceSession,
  PendingGeofenceEntry,
  RegisteredStudentItem,
  ActivityEvent,
} from '../types';

interface AdminLiveDashboardProps {
  onSelectStudentLocation?: (info: {
    studentName: string;
    events: ActivityEvent[];
    initialEventId?: string;
  }) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function AdminLiveDashboard({ onSelectStudentLocation }: AdminLiveDashboardProps) {
  const todayKey = getTodayDateKey();

  const [report, setReport] = useState<AdminAttendanceReport | null>(null);
  const [activeSessions, setActiveSessions] = useState<AttendanceSession[]>([]);
  const [pendingEntries, setPendingEntries] = useState<PendingGeofenceEntry[]>([]);
  const [registeredStudents, setRegisteredStudents] = useState<RegisteredStudentItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'INSIDE' | 'OUTSIDE' | 'PENDING'>('ALL');
  const [, setTick] = useState<number>(0);

  // 1-second interval to tick countdown timers smoothly
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to live data streams
  useEffect(() => {
    setIsLoading(true);

    const unsubAttendance = api.subscribeToDailyAttendance(todayKey, (newReport) => {
      setReport(newReport);
      setIsLoading(false);
    });

    const unsubActive = api.subscribeToActiveLiveSessions((sessions) => {
      setActiveSessions(sessions);
    });

    const unsubPending = api.subscribeToAllPendingGeofenceEntries((entries) => {
      setPendingEntries(entries);
    });

    const unsubStudents = api.subscribeToRegisteredStudents((students) => {
      setRegisteredStudents(students);
    });

    return () => {
      unsubAttendance();
      unsubActive();
      unsubPending();
      unsubStudents();
    };
  }, [todayKey]);

  // Combine data per student
  const activeSessionMap = new Map<string, AttendanceSession>();
  activeSessions.forEach((s) => activeSessionMap.set(s.studentId, s));

  const pendingEntryMap = new Map<string, PendingGeofenceEntry>();
  pendingEntries.forEach((p) => {
    if (p.status === 'WAITING_FOR_DWELL') {
      pendingEntryMap.set(p.studentId, p);
    }
  });

  const studentReportMap = new Map<string, any>();
  report?.students.forEach((s) => studentReportMap.set(s.studentId, s));

  // Build live dashboard rows
  const allStudentIds = new Set<string>();
  registeredStudents.forEach((s) => allStudentIds.add(s.id));
  report?.students.forEach((s) => allStudentIds.add(s.studentId));
  activeSessions.forEach((s) => allStudentIds.add(s.studentId));
  pendingEntries.forEach((p) => allStudentIds.add(p.studentId));

  const studentRows = Array.from(allStudentIds).map((id) => {
    const registered = registeredStudents.find((s) => s.id === id);
    const reportItem = studentReportMap.get(id);
    const activeSess = activeSessionMap.get(id);
    const pending = pendingEntryMap.get(id);

    const fullName =
      registered?.fullName ||
      reportItem?.fullName ||
      activeSess?.studentName ||
      pending?.studentName ||
      'Unknown Student';

    const isInside = Boolean(activeSess || reportItem?.dailyStatus === 'INSIDE');
    const status: 'INSIDE' | 'OUTSIDE' = isInside ? 'INSIDE' : 'OUTSIDE';

    // Last known location
    let lastLoc = activeSess?.lastLocation || activeSess?.inLocation || reportItem?.lastAction?.location || null;
    if (pending?.latestLatitude && pending?.latestLongitude) {
      lastLoc = {
        latitude: pending.latestLatitude,
        longitude: pending.latestLongitude,
        accuracy: pending.latestAccuracy ?? null,
      };
    }

    // Last Location Update time
    let lastLocationUpdate = '—';
    if (activeSess?.lastLocation?.timestamp) {
      lastLocationUpdate = formatLocalTime(activeSess.lastLocation.timestamp);
    } else if (pending?.lastLocationTimestamp) {
      lastLocationUpdate = formatLocalTime(pending.lastLocationTimestamp);
    } else if (reportItem?.lastAction?.timestamp) {
      lastLocationUpdate = formatLocalTime(reportItem.lastAction.timestamp);
    }

    // Current Attendance Trigger
    let triggerDisplay = '—';
    const lastAction = reportItem?.lastAction;
    if (lastAction) {
      const act = lastAction.action;
      const trig = lastAction.triggerType === 'GEOFENCE_AUTO' ? 'Automatic' : 'Manual';
      triggerDisplay = `${trig} ${act}`;
    } else if (activeSess) {
      triggerDisplay = activeSess.triggerType === 'GEOFENCE_AUTO' ? 'Automatic IN' : 'Manual IN';
    }

    // Pending Verification & Time Remaining (Requirement 17)
    let pendingVerification = '—';
    let timeRemaining = '—';
    let remainingSeconds = 0;

    if (pending && status === 'OUTSIDE') {
      pendingVerification = 'Waiting for Entry';
      const startMs = new Date(pending.dwellStartTimestamp).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const required = pending.requiredDwellSeconds || 60;
      remainingSeconds = Math.max(0, required - elapsed);
      timeRemaining = `Automatic IN in ${formatDuration(remainingSeconds)}`;
    }

    return {
      studentId: id,
      fullName,
      status,
      lastLocation: lastLoc,
      lastLocationUpdate,
      triggerDisplay,
      pendingVerification,
      timeRemaining,
      remainingSeconds,
      events: reportItem?.events || [],
      isRegisteredActive: registered?.active ?? true,
    };
  });

  // Filter rows
  const filteredRows = studentRows.filter((row) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      if (!row.fullName.toLowerCase().includes(q) && !row.studentId.toLowerCase().includes(q)) {
        return false;
      }
    }

    if (statusFilter === 'INSIDE') return row.status === 'INSIDE';
    if (statusFilter === 'OUTSIDE') return row.status === 'OUTSIDE';
    if (statusFilter === 'PENDING') return row.pendingVerification !== '—';

    return true;
  });

  const insideCount = studentRows.filter((r) => r.status === 'INSIDE').length;
  const outsideCount = studentRows.filter((r) => r.status === 'OUTSIDE').length;
  const pendingCount = studentRows.filter((r) => r.pendingVerification !== '—').length;

  return (
    <div className="space-y-6">
      {/* Top Banner & Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-semibold tracking-wider text-amber-700 mb-0.5">
            Real-Time Monitor
          </div>
          <h2 className="text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-2.5">
            <span>LIVE ATTENDANCE DASHBOARD</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live Stream
            </span>
          </h2>
          <p className="text-xs text-stone-500 mt-1">
            Real-time verification states, live GPS updates, and dwell countdowns
          </p>
        </div>

        {/* Live Metrics */}
        <div className="flex items-center gap-3">
          <div className="bg-white border border-emerald-200 rounded-xl px-3.5 py-2 text-center shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              Inside Now
            </div>
            <div className="text-xl font-extrabold text-emerald-700">{insideCount}</div>
          </div>
          <div className="bg-white border border-stone-200 rounded-xl px-3.5 py-2 text-center shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
              Outside
            </div>
            <div className="text-xl font-extrabold text-stone-700">{outsideCount}</div>
          </div>
          <div className="bg-white border border-amber-300 rounded-xl px-3.5 py-2 text-center shadow-2xs bg-amber-50/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
              Pending Dwell
            </div>
            <div className="text-xl font-extrabold text-amber-700">{pendingCount}</div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search student by name or ID..."
            className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-stone-100 rounded-lg border border-stone-200 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            All Students ({studentRows.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('INSIDE')}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer flex items-center gap-1 ${
              statusFilter === 'INSIDE'
                ? 'bg-white text-emerald-800 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Inside ({insideCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('OUTSIDE')}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer flex items-center gap-1 ${
              statusFilter === 'OUTSIDE'
                ? 'bg-white text-stone-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-stone-400" />
            Outside ({outsideCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PENDING')}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer flex items-center gap-1 ${
              statusFilter === 'PENDING'
                ? 'bg-white text-amber-900 shadow-2xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            Pending Verification ({pendingCount})
          </button>
        </div>
      </div>

      {/* Main Table: Requirement 17 Columns */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
            <h3 className="text-sm font-bold text-stone-900">
              Live Attendance Sessions &amp; Dwell Verification Status
            </h3>
          </div>
          <span className="text-xs font-mono text-stone-500">
            Showing {filteredRows.length} of {studentRows.length} students
          </span>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-stone-400 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-stone-500" />
            <p className="text-sm font-medium">Connecting to live student streams...</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3 text-stone-400">
              <Users className="w-6 h-6" />
            </div>
            <p className="text-base font-semibold text-stone-800">No matching student activity.</p>
            <p className="text-xs text-stone-500 mt-1">
              Active sessions and pending verifications will populate automatically in real time.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/70 text-[11px] font-semibold uppercase tracking-wider text-stone-600">
                  <th className="py-3.5 px-6">Student</th>
                  <th className="py-3.5 px-6">Current Status</th>
                  <th className="py-3.5 px-6">Current Location</th>
                  <th className="py-3.5 px-6">Last Location Update</th>
                  <th className="py-3.5 px-6">Current Attendance Trigger</th>
                  <th className="py-3.5 px-6">Pending Verification</th>
                  <th className="py-3.5 px-6">Time Remaining</th>
                  <th className="py-3.5 px-6 text-right">Map</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredRows.map((row) => (
                  <tr
                    key={row.studentId}
                    className={`hover:bg-stone-50/80 transition-colors ${
                      row.pendingVerification !== '—' ? 'bg-amber-50/20' : ''
                    }`}
                  >
                    {/* Student */}
                    <td className="py-4 px-6 align-middle font-medium text-stone-900">
                      <div>
                        <div className="font-bold flex items-center gap-1.5 text-stone-900">
                          <span>{row.fullName}</span>
                          {!row.isRegisteredActive && (
                            <span className="text-[10px] bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded font-normal">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-stone-400 font-mono">
                          {row.studentId.substring(0, 12)}...
                        </div>
                      </div>
                    </td>

                    {/* Current Status */}
                    <td className="py-4 px-6 align-middle">
                      {row.status === 'INSIDE' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          INSIDE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-stone-100 text-stone-600 border border-stone-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                          OUTSIDE
                        </span>
                      )}
                    </td>

                    {/* Current Location */}
                    <td className="py-4 px-6 align-middle">
                      {row.lastLocation ? (
                        <div className="space-y-0.5 font-mono text-xs text-stone-700">
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>
                              {row.lastLocation.latitude.toFixed(4)},{' '}
                              {row.lastLocation.longitude.toFixed(4)}
                            </span>
                          </div>
                          {row.lastLocation.accuracy && (
                            <div className="text-[10px] text-stone-400 pl-4">
                              &plusmn;{Math.round(row.lastLocation.accuracy)}m accuracy
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-stone-400 italic">No GPS fix yet</span>
                      )}
                    </td>

                    {/* Last Location Update */}
                    <td className="py-4 px-6 align-middle font-mono text-xs text-stone-600">
                      {row.lastLocationUpdate !== '—' ? (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-stone-400" />
                          <span>Last GPS: {row.lastLocationUpdate}</span>
                        </div>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>

                    {/* Current Attendance Trigger */}
                    <td className="py-4 px-6 align-middle">
                      {row.triggerDisplay !== '—' ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono font-bold border ${
                            row.triggerDisplay.includes('Automatic')
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : 'bg-stone-100 text-stone-700 border-stone-300'
                          }`}
                        >
                          {row.triggerDisplay.includes('Automatic') ? '⚡' : '👤'} {row.triggerDisplay}
                        </span>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>

                    {/* Pending Verification */}
                    <td className="py-4 px-6 align-middle">
                      {row.pendingVerification !== '—' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 animate-pulse">
                          <Timer className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                          <span>{row.pendingVerification}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>

                    {/* Time Remaining */}
                    <td className="py-4 px-6 align-middle">
                      {row.timeRemaining !== '—' ? (
                        <span className="font-mono text-xs font-extrabold text-amber-900 bg-amber-100/70 px-2 py-1 rounded border border-amber-200 shadow-2xs">
                          {row.timeRemaining}
                        </span>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>

                    {/* Map Action */}
                    <td className="py-4 px-6 align-middle text-right">
                      {row.events.length > 0 && onSelectStudentLocation && (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectStudentLocation({
                              studentName: row.fullName,
                              events: row.events,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition cursor-pointer"
                          title="View location map"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Map</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

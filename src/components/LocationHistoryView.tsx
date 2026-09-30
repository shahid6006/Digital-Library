import { useState, useEffect } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  User,
  MapPin,
  RefreshCw,
  Navigation,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../services/api';
import { firebaseService } from '../services/firebaseService';
import type { RegisteredStudentItem, ActivityEvent } from '../types';
import { AttendanceLocationMap } from './AttendanceLocationMap';

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

export function LocationHistoryView() {
  const [students, setStudents] = useState<RegisteredStudentItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateKey());
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to students list in real-time
  useEffect(() => {
    const unsub = api.subscribeToRegisteredStudents((stuList) => {
      setStudents(stuList);
      if (stuList.length > 0 && !selectedStudentId) {
        setSelectedStudentId(stuList[0].id);
      }
    });
    return () => unsub();
  }, [selectedStudentId]);

  // Load attendance events for selected student and date
  const loadEventsForDate = async () => {
    if (!selectedStudentId) {
      setEvents([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const dayEvents = await firebaseService.getStudentTodayEvents(selectedStudentId, selectedDate);
      setEvents(dayEvents);
      const withLoc = dayEvents.filter((e) => e.location != null);
      if (withLoc.length > 0) {
        setSelectedEventId(withLoc[0].id);
      } else {
        setSelectedEventId(dayEvents[0]?.id || '');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load location history for this date.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEventsForDate();
  }, [selectedStudentId, selectedDate]);

  const selectedStudent = students.find((s) => s.id === selectedStudentId);
  const selectedEvent = events.find((e) => e.id === selectedEventId) || events[0];
  const eventsWithLoc = events.filter((e) => e.location != null);
  const isToday = selectedDate === getTodayDateKey();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-semibold tracking-wider text-amber-700 mb-0.5">
            Admin Panel
          </div>
          <h2 className="text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-2">
            <span>Location History Map</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
              Leaflet + OpenStreetMap
            </span>
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Inspect all IN/OUT GPS coordinates and accuracy bounds for any student and date.
          </p>
        </div>

        <button
          type="button"
          onClick={loadEventsForDate}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg shadow-2xs transition cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Selectors Toolbar (Student + Date) */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Student Selector */}
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-700 border border-stone-200 shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <label
              htmlFor="locationStudentSelect"
              className="block text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-1"
            >
              Select Student
            </label>
            <select
              id="locationStudentSelect"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="w-full px-3 py-1.5 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedDate((prev) => offsetDateKey(prev, -1))}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          <div className="flex items-center gap-2 bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200">
            <Calendar className="w-4 h-4 text-stone-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              className="text-xs font-semibold text-stone-900 bg-transparent focus:outline-none cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={() => setSelectedDate((prev) => offsetDateKey(prev, 1))}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>

          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate(getTodayDateKey())}
              className="px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition cursor-pointer"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-stone-100 pb-4 mb-5 gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Viewing Location History
            </div>
            <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <span>{selectedStudent?.fullName || 'Student'}</span>
              <span className="text-xs font-mono font-normal text-stone-500">
                &bull; {formatDateDisplay(selectedDate)}
              </span>
            </h3>
          </div>

          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span className="px-2.5 py-1 bg-stone-100 rounded-md font-mono">
              {events.length} {events.length === 1 ? 'action' : 'actions'}
            </span>
            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-mono font-semibold">
              {eventsWithLoc.length} GPS captured
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center text-stone-400">
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-stone-500" />
            <p className="text-sm font-medium">Loading GPS locations for {formatDateDisplay(selectedDate)}...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-700 text-sm font-medium">
            {error}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Timeline List on the left */}
            <div className="lg:col-span-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-600 flex items-center justify-between">
                <span>Daily IN / OUT Sequence</span>
                <span className="text-[11px] font-normal text-stone-400">Click marker to focus</span>
              </div>

              {events.length === 0 ? (
                <div className="p-8 text-center rounded-xl border border-dashed border-stone-200 bg-stone-50 text-stone-400 text-xs">
                  No attendance events recorded on this date.
                </div>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {events.map((evt, idx) => {
                    const isSelected = evt.id === selectedEventId;
                    const hasLoc = evt.location != null;
                    const isLatest = idx === events.length - 1;

                    return (
                      <div
                        key={evt.id || idx}
                        onClick={() => setSelectedEventId(evt.id)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                          isSelected
                            ? 'bg-amber-50/80 border-amber-400 shadow-xs ring-1 ring-amber-400/50'
                            : 'bg-white hover:bg-stone-50 border-stone-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold ${
                                evt.action === 'IN'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              <span>{evt.action === 'IN' ? '🟢 IN' : '🔴 OUT'}</span>
                            </span>
                            <span className="text-xs font-mono font-semibold text-stone-800">
                              {evt.timeFormatted}
                            </span>
                          </div>

                          {hasLoc ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <Navigation className="w-3 h-3 text-emerald-600" />
                              <span>GPS</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-stone-400 italic">
                              No location
                            </span>
                          )}
                        </div>

                        {isLatest && hasLoc && (
                          <div className="mt-1 text-[10px] uppercase font-bold tracking-wider text-amber-700">
                            Last recorded location
                          </div>
                        )}

                        {hasLoc ? (
                          <div className="mt-2 text-[11px] text-stone-600 space-y-0.5 font-mono">
                            <div>
                              GPS location &mdash; accuracy &plusmn;{Math.round(evt.location!.accuracy || 10)} meters
                            </div>
                            <div className="text-[10px] text-stone-400">
                              Lat: {evt.location!.latitude.toFixed(6)}, Lng: {evt.location!.longitude.toFixed(6)}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1.5 text-[11px] text-stone-400">
                            Location not available
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Map on the right */}
            <div className="lg:col-span-8 flex flex-col space-y-3">
              {selectedEvent && selectedEvent.location && (
                <div className="flex items-center justify-between bg-stone-50 p-2.5 px-3.5 rounded-xl border border-stone-200 text-xs">
                  <div>
                    <span className="text-stone-500">Selected:</span>{' '}
                    <span className="font-bold text-stone-900">
                      {selectedEvent.action === 'IN' ? '🟢 IN' : '🔴 OUT'} &bull;{' '}
                      {selectedEvent.timeFormatted}
                    </span>
                    <span className="text-stone-500 ml-2 font-mono text-[11px]">
                      (accuracy &plusmn;{Math.round(selectedEvent.location.accuracy || 10)}m)
                    </span>
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${selectedEvent.location.latitude},${selectedEvent.location.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 font-medium"
                  >
                    <span>Open External Map</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              <AttendanceLocationMap
                events={events}
                selectedEventId={selectedEventId}
                onSelectEvent={(id) => setSelectedEventId(id)}
                studentName={selectedStudent?.fullName}
                className="h-[380px] sm:h-[480px] lg:h-[520px]"
                showPolyline={true}
              />

              <div className="flex items-center justify-between text-xs text-stone-500 px-1 pt-1">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Event-based location capture &bull; Not continuous background tracking</span>
                </div>
                <div className="flex items-center gap-1 font-mono text-stone-400 text-[11px]">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>OpenStreetMap / Leaflet</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

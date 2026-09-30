import { useState, useEffect } from 'react';
import {
  LogIn,
  LogOut,
  Clock,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  MapPin,
  Navigation,
} from 'lucide-react';
import { api } from '../services/api';
import type { StudentInfo, ActivityEvent, LocationData } from '../types';
import { LocationModal } from './LocationModal';

interface StudentPortalProps {
  student: StudentInfo;
  onLogout: () => void;
  onStatusChange?: (status: 'INSIDE' | 'OUTSIDE') => void;
}

function obtainDeviceLocation(): Promise<LocationData> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return reject(
        new Error(
          'Geolocation is not supported by your browser. Location permission is required to record attendance.'
        )
      );
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(
              new Error(
                'Location permission was denied. Location permission is required to record library attendance. Please allow location access in your browser settings.'
              )
            );
            break;
          case err.POSITION_UNAVAILABLE:
            reject(
              new Error(
                'Device location is currently unavailable. Please verify GPS or network location settings.'
              )
            );
            break;
          case err.TIMEOUT:
            reject(
              new Error(
                'Location request timed out. Please check your connection and try again.'
              )
            );
            break;
          default:
            reject(
              new Error(
                'Unable to retrieve device location coordinates. Location permission is required.'
              )
            );
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}

export function StudentPortal({ student, onLogout, onStatusChange }: StudentPortalProps) {
  const [currentStatus, setCurrentStatus] = useState<'INSIDE' | 'OUTSIDE'>('OUTSIDE');
  const [lastActionTime, setLastActionTime] = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState<LocationData | null>(null);
  const [todayEvents, setTodayEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingStep, setSubmittingStep] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  );

  // Student own location view modal
  const [viewingLocationModal, setViewingLocationModal] = useState<boolean>(false);

  // Load student status and today's activity
  const loadStudentData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await api.getStudentMe();
      setCurrentStatus(data.currentStatus);
      onStatusChange?.(data.currentStatus);
      setLastActionTime(data.lastEvent ? data.lastEvent.timeFormatted : null);
      setLastLocation(data.lastEvent?.location || null);
      setTodayEvents(data.todayEvents);
    } catch (err: any) {
      if (err.message && err.message.includes('expired')) {
        onLogout();
      } else {
        setFeedback({
          type: 'error',
          message: err.message || 'Unable to load attendance data. Please retry.',
        });
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStudentData();
  }, [student.id]);

  // Handle Mark IN or Mark OUT with required Location Capture
  const handleAttendanceAction = async (actionToTake: 'IN' | 'OUT') => {
    // Client-side guard against invalid sequence
    if (actionToTake === 'IN' && currentStatus === 'INSIDE') {
      setFeedback({ type: 'error', message: 'You are already marked INSIDE the library.' });
      return;
    }
    if (actionToTake === 'OUT' && currentStatus === 'OUTSIDE') {
      setFeedback({ type: 'error', message: 'You are already marked OUTSIDE the library.' });
      return;
    }

    if (isSubmitting) return; // Prevent double clicks
    setIsSubmitting(true);
    setFeedback({
      type: 'info',
      message: 'Location permission is required to record attendance. Requesting location...',
    });
    setSubmittingStep('Requesting device location...');

    let capturedLoc: LocationData | null = null;
    try {
      capturedLoc = await obtainDeviceLocation();
    } catch (locErr: any) {
      setIsSubmitting(false);
      setSubmittingStep(null);
      // Strictly do not silently fake location or proceed without location
      setFeedback({
        type: 'error',
        message:
          locErr.message ||
          'Location permission is required to record attendance. Please allow location access to continue.',
      });
      return;
    }

    setSubmittingStep(`Location captured (±${Math.round(capturedLoc.accuracy || 0)}m). Recording attendance...`);

    try {
      const res = await api.markAttendance(actionToTake, capturedLoc);
      setCurrentStatus(res.currentStatus);
      onStatusChange?.(res.currentStatus);
      setLastActionTime(res.event.timeFormatted);
      setLastLocation(res.event.location || null);
      setTodayEvents(res.todayEvents);

      const accStr = capturedLoc.accuracy ? ` (accuracy ±${Math.round(capturedLoc.accuracy)}m)` : '';
      setFeedback({
        type: 'success',
        message:
          actionToTake === 'IN'
            ? `Successfully marked IN at ${res.event.timeFormatted}${accStr}. Welcome to the library!`
            : `Successfully marked OUT at ${res.event.timeFormatted}${accStr}. Have a safe journey!`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Unable to save attendance. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
      setSubmittingStep(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Top Banner / Welcome */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-stone-100 pb-5">
          <div>
            <div className="text-xs uppercase font-semibold tracking-wider text-amber-700 mb-1">
              Library Attendance
            </div>
            <h2 className="text-2xl font-bold text-stone-900 tracking-tight">
              Welcome, {student.fullName}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadStudentData(true)}
              className="p-2 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded-lg transition cursor-pointer"
              title="Refresh status"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Exit Terminal</span>
            </button>
          </div>
        </div>

        {/* Current Status Display */}
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-stone-50 border border-stone-200">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">
              Current Status
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-block w-3.5 h-3.5 rounded-full ${
                  currentStatus === 'INSIDE'
                    ? 'bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                    : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                }`}
              />
              <span className="text-2xl font-extrabold tracking-tight text-stone-900">
                {currentStatus}
              </span>
            </div>
            {lastActionTime && (
              <div className="flex items-center gap-1 text-xs text-stone-500 mt-1 font-mono">
                <Clock className="w-3 h-3" />
                <span>Last action: {lastActionTime}</span>
              </div>
            )}
          </div>

          <div className="text-right">
            <span
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                currentStatus === 'INSIDE'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-100 text-rose-800 border border-rose-200'
              }`}
            >
              {currentStatus === 'INSIDE' ? 'Inside Library' : 'Outside Library'}
            </span>

            {lastLocation && (
              <div className="mt-1.5 flex flex-col items-end gap-0.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-700">
                  Last recorded location
                </span>
                <button
                  type="button"
                  onClick={() => setViewingLocationModal(true)}
                  className="inline-flex items-center gap-1 text-[11px] text-stone-700 hover:text-amber-800 font-medium cursor-pointer"
                >
                  <MapPin className="w-3 h-3 text-amber-600" />
                  <span>GPS location &mdash; accuracy &plusmn;{Math.round(lastLocation.accuracy || 10)}m</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-5 p-3.5 rounded-lg border text-sm flex items-start gap-2.5 transition animate-fade-in ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : feedback.type === 'info'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : feedback.type === 'info' ? (
              <Navigation className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="leading-snug font-medium">{feedback.message}</div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 pt-2">
          {currentStatus === 'OUTSIDE' ? (
            <button
              type="button"
              onClick={() => handleAttendanceAction('IN')}
              disabled={isSubmitting || isLoading}
              className="w-full flex items-center justify-center gap-2.5 py-4 px-6 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all duration-150 disabled:opacity-50 text-base cursor-pointer"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{submittingStep || 'Processing IN...'}</span>
                </div>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  <span>MARK IN — ENTER LIBRARY</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleAttendanceAction('OUT')}
              disabled={isSubmitting || isLoading}
              className="w-full flex items-center justify-center gap-2.5 py-4 px-6 bg-rose-700 hover:bg-rose-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all duration-150 disabled:opacity-50 text-base cursor-pointer"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{submittingStep || 'Processing OUT...'}</span>
                </div>
              ) : (
                <>
                  <LogOut className="w-5 h-5" />
                  <span>MARK OUT — LEAVE LIBRARY</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Security & Location Notice */}
        <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Strict alternating sequence enforced</span>
          </div>
          <div className="flex items-center gap-1 font-mono text-stone-400">
            <MapPin className="w-3.5 h-3.5 text-stone-400" />
            <span>Event-based location capture</span>
          </div>
        </div>
      </div>

      {/* Today's Activity Log */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-stone-700">
            Today&apos;s Attendance Activity
          </h3>
          <span className="text-xs text-stone-500 font-mono">
            {todayEvents.length} {todayEvents.length === 1 ? 'event' : 'events'}
          </span>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-stone-400">
            Loading activity log...
          </div>
        ) : todayEvents.length === 0 ? (
          <div className="py-8 text-center px-4 rounded-lg bg-stone-50 border border-stone-200/60">
            <Clock className="w-8 h-8 text-stone-400 mx-auto mb-2" />
            <p className="text-xs text-stone-600 font-medium">
              No attendance activity recorded for today yet.
            </p>
            <p className="text-[11px] text-stone-400 mt-0.5">
              Click &quot;MARK IN&quot; above to record your entry.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {todayEvents.map((evt, idx) => (
              <div
                key={evt.id || idx}
                className="flex items-center justify-between p-3 rounded-lg border border-stone-100 bg-stone-50/60"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold ${
                      evt.action === 'IN'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {evt.action}
                  </span>
                  <div>
                    <span className="text-xs font-semibold text-stone-800">
                      {evt.action === 'IN' ? 'Entered Library' : 'Exited Library'}
                    </span>
                    <span className="text-xs text-stone-500 font-mono ml-2">
                      {evt.timeFormatted}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {evt.location ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-mono bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <MapPin className="w-3 h-3 text-emerald-600" />
                      <span>Captured</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-stone-400 italic">
                      No location
                    </span>
                  )}
                </div>
              </div>
            ))}

            {todayEvents.length > 0 && todayEvents.some((e) => e.location != null) && (
              <div className="pt-2 text-right">
                <button
                  type="button"
                  onClick={() => setViewingLocationModal(true)}
                  className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-800 font-semibold cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Inspect All Today&apos;s Locations on Map</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Student Location Modal (Restricted to their own events) */}
      {viewingLocationModal && (
        <LocationModal
          studentName={student.fullName}
          dateStr="Today"
          events={todayEvents}
          onClose={() => setViewingLocationModal(false)}
        />
      )}
    </div>
  );
}

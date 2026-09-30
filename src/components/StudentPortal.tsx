import { useState, useEffect, useRef } from 'react';
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
  Radio,
  Compass,
} from 'lucide-react';
import { api } from '../services/api';
import type {
  StudentInfo,
  ActivityEvent,
  LocationData,
  AttendanceSession,
  SessionLocationPoint,
} from '../types';
import { LocationModal } from './LocationModal';
import { LiveTrackingMap } from './LiveTrackingMap';
import { PWAInstallButton } from './PWAInstallButton';

interface StudentPortalProps {
  student: StudentInfo;
  onLogout: () => void;
  onStatusChange?: (status: 'INSIDE' | 'OUTSIDE') => void;
}

// Haversine formula to compute distance in meters between two coordinates
function computeDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Request fresh high-accuracy device location (no fake coordinates)
function obtainDeviceLocation(): Promise<LocationData> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return reject(
        new Error(
          'Geolocation is not supported by your browser. Location access is required to record attendance.'
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
                'Location permission was denied. Location access is required to mark library attendance. Please allow location access in your device settings.'
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
                'Location request timed out. Please check your GPS signal and try again.'
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
        timeout: 12000,
        maximumAge: 0,
      }
    );
  });
}

// Configurable tracking thresholds
const LOCATION_MIN_INTERVAL = 4000; // minimum 4 seconds between Firestore writes
const LOCATION_MIN_DISTANCE = 3; // minimum 3 meters movement to record a waypoint
const LOCATION_MAX_ACCEPTABLE_ACCURACY = 120; // reject inaccurate points (>120m)

export function StudentPortal({ student, onLogout, onStatusChange }: StudentPortalProps) {
  const [currentStatus, setCurrentStatus] = useState<'INSIDE' | 'OUTSIDE'>('OUTSIDE');
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [activeRoute, setActiveRoute] = useState<SessionLocationPoint[]>([]);
  const [currentLiveLocation, setCurrentLiveLocation] = useState<LocationData | null>(null);
  const [isGpsWatching, setIsGpsWatching] = useState<boolean>(false);
  const [gpsWatchError, setGpsWatchError] = useState<string | null>(null);

  const [lastActionTime, setLastActionTime] = useState<string | null>(null);
  const [todayEvents, setTodayEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingStep, setSubmittingStep] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Student own location view modal
  const [viewingLocationModal, setViewingLocationModal] = useState<boolean>(false);

  // Refs for tracking
  const watchIdRef = useRef<number | null>(null);
  const lastWriteTimeRef = useRef<number>(0);
  const lastWrittenLocRef = useRef<LocationData | null>(null);
  const sequenceNumRef = useRef<number>(0);
  const activeSessionRef = useRef<AttendanceSession | null>(null);
  activeSessionRef.current = activeSession;

  // Stop active GPS watch
  const stopLiveTracking = () => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsGpsWatching(false);
  };

  // Start continuous GPS watch for active session
  const startLiveTracking = (session: AttendanceSession) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsWatchError('Geolocation is not supported by your browser.');
      return;
    }

    // Stop previous watch if exists
    stopLiveTracking();

    setIsGpsWatching(true);
    setGpsWatchError(null);

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;

        // Coordinate boundary validation
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          return;
        }

        const freshLoc: LocationData = {
          latitude,
          longitude,
          accuracy: accuracy ?? null,
        };

        // Update live moving marker on map immediately
        setCurrentLiveLocation(freshLoc);

        // Accuracy filter: ignore points that are too inaccurate
        if (accuracy && accuracy > LOCATION_MAX_ACCEPTABLE_ACCURACY) {
          return;
        }

        const now = Date.now();
        const timeSinceLastWrite = now - lastWriteTimeRef.current;

        // Distance check from last recorded point
        let distanceMoved = 999;
        if (lastWrittenLocRef.current) {
          distanceMoved = computeDistanceMeters(
            lastWrittenLocRef.current.latitude,
            lastWrittenLocRef.current.longitude,
            freshLoc.latitude,
            freshLoc.longitude
          );
        }

        // Only save point if threshold conditions met
        const shouldSave =
          timeSinceLastWrite >= LOCATION_MIN_INTERVAL &&
          (distanceMoved >= LOCATION_MIN_DISTANCE || timeSinceLastWrite >= 25000);

        if (shouldSave && activeSessionRef.current) {
          lastWriteTimeRef.current = now;
          lastWrittenLocRef.current = freshLoc;
          sequenceNumRef.current += 1;
          const seq = sequenceNumRef.current;

          try {
            const savedPoint = await api.recordLocationWaypoint(
              activeSessionRef.current.id,
              student.id,
              freshLoc,
              seq
            );

            // Extend local route polyline smoothly
            setActiveRoute((prev) => [...prev, savedPoint]);
          } catch (err) {
            console.warn('Live location waypoint write warning:', err);
          }
        }
      },
      (err) => {
        console.warn('Geolocation watchPosition error:', err);
        setGpsWatchError(err.message || 'Unable to receive GPS updates.');
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );

    watchIdRef.current = watchId;
  };

  // Clean up GPS watcher on component unmount
  useEffect(() => {
    return () => {
      stopLiveTracking();
    };
  }, []);

  // Load student data & restore active session on boot / refresh
  const loadStudentData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await api.getStudentMe();
      setCurrentStatus(data.currentStatus);
      onStatusChange?.(data.currentStatus);
      setActiveSession(data.activeSession);
      setActiveRoute(data.activeRoute || []);
      setLastActionTime(data.lastEvent ? data.lastEvent.timeFormatted : null);
      setTodayEvents(data.todayEvents);

      if (data.activeSession && data.currentStatus === 'INSIDE') {
        const initialLoc =
          data.activeSession.lastLocation || data.activeSession.inLocation || null;
        if (initialLoc) {
          setCurrentLiveLocation({
            latitude: initialLoc.latitude,
            longitude: initialLoc.longitude,
            accuracy: initialLoc.accuracy ?? null,
          });
          lastWrittenLocRef.current = initialLoc;
        }
        sequenceNumRef.current = (data.activeRoute || []).length;
        // Resume continuous GPS watch
        startLiveTracking(data.activeSession);
      } else {
        stopLiveTracking();
      }
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

  // Handle Mark IN or Mark OUT
  const handleAttendanceAction = async (actionToTake: 'IN' | 'OUT') => {
    if (actionToTake === 'IN' && currentStatus === 'INSIDE') {
      setFeedback({ type: 'error', message: 'You are already marked INSIDE the library.' });
      return;
    }
    if (actionToTake === 'OUT' && currentStatus === 'OUTSIDE') {
      setFeedback({ type: 'error', message: 'You are already marked OUTSIDE the library.' });
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    setFeedback({
      type: 'info',
      message: 'Requesting fresh device GPS position...',
    });
    setSubmittingStep('Requesting fresh device GPS location...');

    let capturedLoc: LocationData | null = null;
    try {
      capturedLoc = await obtainDeviceLocation();
    } catch (locErr: any) {
      setIsSubmitting(false);
      setSubmittingStep(null);
      setFeedback({
        type: 'error',
        message:
          locErr.message ||
          'Location access is required to record attendance. Please allow location access to proceed.',
      });
      return;
    }

    setSubmittingStep(
      `Location locked (±${Math.round(capturedLoc.accuracy || 0)}m). Recording ${actionToTake}...`
    );

    try {
      const res = await api.markAttendance(actionToTake, capturedLoc, student.id, student.fullName);
      setCurrentStatus(res.currentStatus);
      onStatusChange?.(res.currentStatus);
      setLastActionTime(res.event.timeFormatted);
      setTodayEvents(res.todayEvents);

      if (actionToTake === 'IN') {
        const newSession = res.session || null;
        setActiveSession(newSession);
        setCurrentLiveLocation(capturedLoc);
        lastWrittenLocRef.current = capturedLoc;
        lastWriteTimeRef.current = Date.now();
        sequenceNumRef.current = 1;

        // Initialize active route with the IN location point
        const initialPoint: SessionLocationPoint = {
          id: 'loc_0',
          sessionId: newSession?.id || '',
          studentId: student.id,
          latitude: capturedLoc.latitude,
          longitude: capturedLoc.longitude,
          accuracy: capturedLoc.accuracy,
          timestamp: res.event.timestamp,
          sequenceNumber: 0,
        };
        setActiveRoute([initialPoint]);

        // Start continuous live GPS watch
        if (newSession) {
          startLiveTracking(newSession);
        }

        const accStr = capturedLoc.accuracy
          ? ` (accuracy ±${Math.round(capturedLoc.accuracy)}m)`
          : '';
        setFeedback({
          type: 'success',
          message: `Successfully marked IN at ${res.event.timeFormatted}${accStr}. Live GPS tracking is active!`,
        });
      } else {
        // action === 'OUT'
        // Stop active GPS watch immediately
        stopLiveTracking();
        setActiveSession(null);
        setCurrentLiveLocation(null);

        const accStr = capturedLoc.accuracy
          ? ` (accuracy ±${Math.round(capturedLoc.accuracy)}m)`
          : '';
        setFeedback({
          type: 'success',
          message: `Successfully marked OUT at ${res.event.timeFormatted}${accStr}. Live tracking stopped. Have a great day!`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Unable to record attendance. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
      setSubmittingStep(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Install PWA Prompt Banner */}
      <PWAInstallButton variant="banner" />

      {/* Main Terminal Card */}
      <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-stone-100 pb-5">
          <div>
            <div className="text-xs uppercase font-bold tracking-wider text-amber-700 mb-1 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5" />
              <span>Digital Library Terminal</span>
            </div>
            <h2 className="text-2xl font-extrabold text-stone-900 tracking-tight">
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Exit Terminal</span>
            </button>
          </div>
        </div>

        {/* Current Status Display */}
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-stone-50 border border-stone-200/80">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">
              Current Status
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-block w-3.5 h-3.5 rounded-full ${
                  currentStatus === 'INSIDE'
                    ? 'bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.6)]'
                    : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                }`}
              />
              <span className="text-2xl font-black tracking-tight text-stone-900">
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
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                currentStatus === 'INSIDE'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-100 text-rose-800 border border-rose-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  currentStatus === 'INSIDE' ? 'bg-emerald-600 animate-ping' : 'bg-rose-600'
                }`}
              />
              {currentStatus === 'INSIDE' ? 'Inside Library' : 'Outside Library'}
            </span>

            {currentStatus === 'INSIDE' && isGpsWatching && (
              <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-emerald-700 font-semibold">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>Continuous GPS Watch Active</span>
              </div>
            )}
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-5 p-3.5 rounded-xl border text-sm flex items-start gap-2.5 transition animate-fade-in ${
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

        {/* GPS Warning if any */}
        {gpsWatchError && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>GPS Update Notice: {gpsWatchError}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 pt-1">
          {currentStatus === 'OUTSIDE' ? (
            <button
              type="button"
              onClick={() => handleAttendanceAction('IN')}
              disabled={isSubmitting || isLoading}
              className="w-full flex items-center justify-center gap-2.5 py-4 px-6 bg-emerald-700 hover:bg-emerald-600 active:scale-99 text-white font-extrabold rounded-xl shadow-md hover:shadow-lg transition-all duration-150 disabled:opacity-50 text-base cursor-pointer"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{submittingStep || 'Processing IN...'}</span>
                </div>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  <span>MARK IN &mdash; ENTER LIBRARY &amp; START TRACKING</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleAttendanceAction('OUT')}
              disabled={isSubmitting || isLoading}
              className="w-full flex items-center justify-center gap-2.5 py-4 px-6 bg-rose-700 hover:bg-rose-600 active:scale-99 text-white font-extrabold rounded-xl shadow-md hover:shadow-lg transition-all duration-150 disabled:opacity-50 text-base cursor-pointer"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{submittingStep || 'Processing OUT...'}</span>
                </div>
              ) : (
                <>
                  <LogOut className="w-5 h-5" />
                  <span>MARK OUT &mdash; LEAVE LIBRARY &amp; STOP TRACKING</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Security & Strict Privacy Notice */}
        <div className="mt-6 pt-4 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-stone-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Tracking active strictly between IN and OUT</span>
          </div>
          <div className="flex items-center gap-1 font-mono text-stone-400">
            <Radio className="w-3.5 h-3.5 text-stone-400" />
            <span>Device Geolocation API (No fake locations)</span>
          </div>
        </div>
      </div>

      {/* Live Map Section (Only active when INSIDE) */}
      {currentStatus === 'INSIDE' && (
        <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-stone-800">
                Live Movement Route &amp; GPS Dot
              </h3>
            </div>
            <span className="text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full font-semibold border border-amber-200">
              Active Session
            </span>
          </div>

          <p className="text-xs text-stone-600 leading-relaxed">
            Your real-time GPS coordinate is being tracked during this active session. The moving
            dot and polyline update dynamically as you move within the library campus.
          </p>

          <LiveTrackingMap
            currentLocation={currentLiveLocation}
            route={activeRoute}
            studentName={student.fullName}
            sessionStartTime={lastActionTime || undefined}
            isTrackingActive={isGpsWatching}
          />
        </div>
      )}

      {/* Today's Activity Log */}
      <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-stone-700 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-700" />
            <span>Today&apos;s Attendance Activity</span>
          </h3>
          <span className="text-xs text-stone-500 font-mono">
            {todayEvents.length} {todayEvents.length === 1 ? 'event' : 'events'}
          </span>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-stone-400">
            Loading attendance history...
          </div>
        ) : todayEvents.length === 0 ? (
          <div className="py-8 text-center px-4 rounded-xl bg-stone-50 border border-stone-200/60">
            <Clock className="w-8 h-8 text-stone-400 mx-auto mb-2" />
            <p className="text-xs text-stone-600 font-medium">
              No attendance activity recorded for today yet.
            </p>
            <p className="text-[11px] text-stone-400 mt-0.5">
              Press &quot;MARK IN&quot; above to start your attendance session.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {todayEvents.map((evt, idx) => (
              <div
                key={evt.id || idx}
                className="flex items-center justify-between p-3 rounded-xl border border-stone-100 bg-stone-50/70"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black ${
                      evt.action === 'IN'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {evt.action}
                  </span>
                  <div>
                    <span className="text-xs font-semibold text-stone-800">
                      {evt.action === 'IN' ? 'Entered Library (IN)' : 'Exited Library (OUT)'}
                    </span>
                    <span className="text-xs text-stone-500 font-mono ml-2">
                      {evt.timeFormatted}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {evt.location ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-mono bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
                      <MapPin className="w-3 h-3 text-emerald-600" />
                      <span>GPS &plusmn;{Math.round(evt.location.accuracy || 10)}m</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-stone-400 italic">No GPS</span>
                  )}
                </div>
              </div>
            ))}

            {todayEvents.length > 0 && todayEvents.some((e) => e.location != null) && (
              <div className="pt-2 text-right">
                <button
                  type="button"
                  onClick={() => setViewingLocationModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-800 font-semibold cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Inspect All Today&apos;s Waypoints on Map</span>
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

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
  Shield,
  Zap,
  Timer,
  Check,
  AlertTriangle,
  Sliders,
  Info,
  Bell,
  User,
  Wifi,
  WifiOff,
  Volume2,
} from 'lucide-react';
import { api } from '../services/api';
import { notificationService } from '../services/notificationService';
import { offlineQueue } from '../services/offlineQueue';
import type {
  StudentInfo,
  ActivityEvent,
  LocationData,
  AttendanceSession,
  SessionLocationPoint,
  GeofenceSettings,
  GeofenceStudentState,
} from '../types';
import { LocationModal } from './LocationModal';
import { LiveTrackingMap } from './LiveTrackingMap';
import { PWAInstallButton } from './PWAInstallButton';
import { StudentNotificationCenterModal } from './StudentNotificationCenterModal';
import { StudentProfileModal } from './StudentProfileModal';

interface StudentPortalProps {
  student: StudentInfo;
  onLogout: () => void;
  onStatusChange?: (status: 'INSIDE' | 'OUTSIDE') => void;
}

// Configurable constants
const DEFAULT_GEOFENCE_DWELL_SECONDS = 600; // 10 minutes requirement
const EXIT_CONFIRMATION_MIN_COUNT = 3; // 3 consecutive outside fixes
const EXIT_CONFIRMATION_MIN_MS = 15000; // 15 seconds outside
const LOCATION_MIN_INTERVAL = 4000; // minimum 4 seconds between Firestore writes
const LOCATION_MIN_DISTANCE = 3; // minimum 3 meters movement to record a waypoint
const LOCATION_MAX_ACCEPTABLE_ACCURACY = 120; // reject inaccurate points (>120m)

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

// Format seconds into MM:SS
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
              new Error('Location request timed out. Please check your GPS signal and try again.')
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

export function StudentPortal({ student, onLogout, onStatusChange }: StudentPortalProps) {
  const [currentStatus, setCurrentStatus] = useState<'INSIDE' | 'OUTSIDE'>('OUTSIDE');
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [activeRoute, setActiveRoute] = useState<SessionLocationPoint[]>([]);
  const [currentLiveLocation, setCurrentLiveLocation] = useState<LocationData | null>(null);
  const [isGpsWatching, setIsGpsWatching] = useState<boolean>(false);
  const [gpsWatchError, setGpsWatchError] = useState<string | null>(null);
  const [lastGpsAccuracy, setLastGpsAccuracy] = useState<number | null>(null);

  // Geofence & Automation States
  const [geofenceSettings, setGeofenceSettings] = useState<GeofenceSettings | null>(null);
  const [isFirstManualInDoneToday, setIsFirstManualInDoneToday] = useState<boolean>(false);
  const [geofenceStudentState, setGeofenceStudentState] =
    useState<GeofenceStudentState>('WAITING_FOR_LOCATION');
  const [distanceToGeofence, setDistanceToGeofence] = useState<number | null>(null);

  // 10-Minute Dwell State
  const [dwellRemainingSeconds, setDwellRemainingSeconds] = useState<number>(DEFAULT_GEOFENCE_DWELL_SECONDS);
  const [dwellActive, setDwellActive] = useState<boolean>(false);
  const [useFastTestDwell, setUseFastTestDwell] = useState<boolean>(false);

  // Feedback & Loading
  const [lastActionTime, setLastActionTime] = useState<string | null>(null);
  const [todayEvents, setTodayEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingStep, setSubmittingStep] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Modal
  const [viewingLocationModal, setViewingLocationModal] = useState<boolean>(false);
  const [notificationModalOpen, setNotificationModalOpen] = useState<boolean>(false);
  const [profileModalOpen, setProfileModalOpen] = useState<boolean>(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);

  // Offline Engine & Network Detection
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(offlineQueue.isOnline());
  const [pendingOfflineEventsCount, setPendingOfflineEventsCount] = useState<number>(offlineQueue.getPendingCount());
  const [syncStatusText, setSyncStatusText] = useState<string | null>(null);

  // Refs for tracking and timers
  const watchIdRef = useRef<number | null>(null);
  const lastWriteTimeRef = useRef<number>(0);
  const lastWrittenLocRef = useRef<LocationData | null>(null);
  const sequenceNumRef = useRef<number>(0);
  const activeSessionRef = useRef<AttendanceSession | null>(null);
  activeSessionRef.current = activeSession;

  const currentStatusRef = useRef<'INSIDE' | 'OUTSIDE'>(currentStatus);
  currentStatusRef.current = currentStatus;

  const isFirstManualInDoneTodayRef = useRef<boolean>(isFirstManualInDoneToday);
  isFirstManualInDoneTodayRef.current = isFirstManualInDoneToday;

  const geofenceSettingsRef = useRef<GeofenceSettings | null>(geofenceSettings);
  geofenceSettingsRef.current = geofenceSettings;

  const isSubmittingRef = useRef<boolean>(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  const dwellStartTimeRef = useRef<number | null>(null);
  const exitConfirmCountRef = useRef<number>(0);
  const exitStartTimeRef = useRef<number | null>(null);

  const dwellTargetSeconds = useFastTestDwell ? 15 : DEFAULT_GEOFENCE_DWELL_SECONDS;

  // 1. Subscribe to Geofence Settings updates
  useEffect(() => {
    const unsub = api.subscribeToGeofenceSettings((settings) => {
      setGeofenceSettings(settings);
    });
    return () => unsub();
  }, []);

  // Subscribe to student notifications count
  useEffect(() => {
    if (!student.id) return;
    const unsub = api.subscribeNotifications(student.id, false, (list) => {
      setUnreadNotificationCount(list.filter((n) => !n.read).length);
    });
    return () => unsub();
  }, [student.id]);

  // Network & Offline Queue Sync Listener (Features 8, 9, 10, 11)
  useEffect(() => {
    const unsubNet = offlineQueue.subscribeNetwork((online) => {
      setIsNetworkOnline(online);
      if (online) {
        const count = offlineQueue.getPendingCount();
        if (count > 0) {
          setSyncStatusText(`Syncing ${count} offline event${count > 1 ? 's' : ''}...`);
          offlineQueue
            .processQueue(async (evt) => {
              return api.syncOfflineEvent(evt);
            })
            .then(({ synced, failed }) => {
              if (synced > 0) {
                setSyncStatusText('Sync complete ✓');
                loadStudentData(true);
                setTimeout(() => setSyncStatusText(null), 4000);
              } else if (failed > 0) {
                setSyncStatusText('Sync requires review');
                setTimeout(() => setSyncStatusText(null), 5000);
              }
            });
        }
      }
    });

    const unsubQueue = offlineQueue.subscribeQueue((queue) => {
      setPendingOfflineEventsCount(queue.filter((e) => e.status === 'PENDING_SYNC').length);
    });

    return () => {
      unsubNet();
      unsubQueue();
    };
  }, []);

  // 2. Load student data & restore active session on boot / refresh
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

      if (data.geofenceSettings) {
        setGeofenceSettings(data.geofenceSettings);
      }

      // Check if student has already done first manual IN today
      const hasDoneFirstIn =
        typeof data.isFirstManualInDoneToday === 'boolean'
          ? data.isFirstManualInDoneToday
          : data.todayEvents.some((e) => e.action === 'IN');
      setIsFirstManualInDoneToday(hasDoneFirstIn);

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

  // 3. Stop active GPS watch
  const stopLiveTracking = () => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsGpsWatching(false);
  };

  // 4. Continuous GPS Watcher for Geofence & Route Tracking
  const startContinuousGpsWatch = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsWatchError('Geolocation is not supported by your browser.');
      return;
    }

    if (watchIdRef.current !== null) {
      return; // Already watching
    }

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

        setCurrentLiveLocation(freshLoc);
        setLastGpsAccuracy(accuracy ?? null);

        // Accuracy filter: reject inaccurate points (>120m) to prevent GPS noise
        if (accuracy && accuracy > LOCATION_MAX_ACCEPTABLE_ACCURACY) {
          setGpsWatchError(`Low GPS accuracy (±${Math.round(accuracy)}m). Waiting for better signal...`);
          return;
        }
        setGpsWatchError(null);

        // Geofence Distance Calculation
        const geo = geofenceSettingsRef.current;
        let isInsideGeofence = false;
        if (geo) {
          const dist = computeDistanceMeters(latitude, longitude, geo.latitude, geo.longitude);
          setDistanceToGeofence(Math.round(dist));
          isInsideGeofence = dist <= geo.radiusMeters;
        }

        // Automatic Geofence Engine Decision Matrix
        const status = currentStatusRef.current;
        const hasDoneFirstIn = isFirstManualInDoneTodayRef.current;

        if (!geo || !geo.enabled) {
          // If geofence is disabled by Admin, open access
          setGeofenceStudentState(status === 'INSIDE' ? 'INSIDE' : 'OUTSIDE');
        } else if (!hasDoneFirstIn) {
          // -------------------------------------------------------------
          // PHASE 1: BEFORE FIRST MANUAL IN OF THE DAY
          // -------------------------------------------------------------
          // Student must manually press IN. Update state so UI indicates whether inside.
          setGeofenceStudentState(isInsideGeofence ? 'INSIDE' : 'OUTSIDE');

          // Feature 1: First entry notification when student enters geofence before first IN
          if (isInsideGeofence) {
            const todayKey = new Date().toISOString().split('T')[0];
            notificationService.maybeNotifyFirstManualIn(todayKey, () => {
              setFeedback({
                type: 'info',
                message: "You're inside the library attendance area. Press IN to record your first entry today.",
              });
              api.sendNotification({
                recipientType: 'STUDENT',
                recipientStudentId: student.id,
                recipientStudentName: student.fullName,
                title: 'Library Attendance Area',
                message: "You're inside the library attendance area. Press IN to record your first entry today.",
                category: 'ATTENDANCE',
                priority: 'normal',
                createdBy: 'Library Geofence',
              }).catch(() => {});
            });
          }
        } else {
          // -------------------------------------------------------------
          // PHASE 2: AFTER FIRST MANUAL IN OF THE DAY (AUTOMATIC IN/OUT)
          // -------------------------------------------------------------
          if (status === 'INSIDE') {
            // Student is currently INSIDE
            if (isInsideGeofence) {
              // Resets exit confirmation counters
              exitConfirmCountRef.current = 0;
              exitStartTimeRef.current = null;
              setGeofenceStudentState('INSIDE');
            } else {
              // Potential EXIT detected — Anti-GPS-flapping exit validation
              setGeofenceStudentState('VERIFYING_EXIT');
              exitConfirmCountRef.current++;
              if (exitStartTimeRef.current === null) {
                exitStartTimeRef.current = Date.now();
              }

              const timeOutside = Date.now() - exitStartTimeRef.current;

              // Confirm genuine exit if multiple readings outside over confirmation window
              if (
                exitConfirmCountRef.current >= EXIT_CONFIRMATION_MIN_COUNT &&
                (timeOutside >= EXIT_CONFIRMATION_MIN_MS || exitConfirmCountRef.current >= 4)
              ) {
                if (!isSubmittingRef.current) {
                  exitConfirmCountRef.current = 0;
                  exitStartTimeRef.current = null;
                  handleAutomaticAction('OUT', freshLoc, 'Left library geofence boundary');
                }
              }
            }
          } else {
            // Student is currently OUTSIDE
            if (!isInsideGeofence) {
              // Outside geofence
              if (dwellStartTimeRef.current !== null) {
                // Cancelled dwell if student was waiting and left!
                dwellStartTimeRef.current = null;
                setDwellActive(false);
                setDwellRemainingSeconds(dwellTargetSeconds);
                setFeedback({
                  type: 'info',
                  message: 'Entry verification cancelled because you left the attendance area.',
                });
              }
              setGeofenceStudentState('OUTSIDE');
            } else {
              // Student returned inside geofence! 10-Minute Dwell Requirement
              setGeofenceStudentState('VERIFYING_ENTRY');
              if (dwellStartTimeRef.current === null) {
                dwellStartTimeRef.current = Date.now();
                setDwellActive(true);
              }

              const elapsedSec = Math.floor((Date.now() - dwellStartTimeRef.current) / 1000);
              const remaining = Math.max(0, dwellTargetSeconds - elapsedSec);
              setDwellRemainingSeconds(remaining);

              // If full 10-minute continuous dwell is satisfied, trigger automatic IN!
              if (remaining <= 0) {
                if (!isSubmittingRef.current) {
                  dwellStartTimeRef.current = null;
                  setDwellActive(false);
                  handleAutomaticAction(
                    'IN',
                    freshLoc,
                    `Automatic entry confirmed after ${useFastTestDwell ? '15-second' : '10-minute'} continuous dwell in library`
                  );
                }
              }
            }
          }
        }

        // If currently INSIDE and tracking active, record route waypoints to Firestore
        if (status === 'INSIDE' && activeSessionRef.current) {
          const now = Date.now();
          const timeSinceLastWrite = now - lastWriteTimeRef.current;

          let distanceMoved = 999;
          if (lastWrittenLocRef.current) {
            distanceMoved = computeDistanceMeters(
              lastWrittenLocRef.current.latitude,
              lastWrittenLocRef.current.longitude,
              freshLoc.latitude,
              freshLoc.longitude
            );
          }

          const shouldSave =
            timeSinceLastWrite >= LOCATION_MIN_INTERVAL &&
            (distanceMoved >= LOCATION_MIN_DISTANCE || timeSinceLastWrite >= 25000);

          if (shouldSave) {
            lastWriteTimeRef.current = now;
            lastWrittenLocRef.current = freshLoc;
            const currentSeq = sequenceNumRef.current++;

            try {
              api.recordLocationWaypoint(
                activeSessionRef.current.id,
                student.id,
                freshLoc,
                currentSeq
              );

              setActiveRoute((prev) => [
                ...prev,
                {
                  id: `loc_${now}_${currentSeq}`,
                  sessionId: activeSessionRef.current!.id,
                  studentId: student.id,
                  latitude: freshLoc.latitude,
                  longitude: freshLoc.longitude,
                  accuracy: freshLoc.accuracy,
                  timestamp: new Date(now).toISOString(),
                  sequenceNumber: currentSeq,
                },
              ]);
            } catch (err) {
              console.warn('Waypoint write warning:', err);
            }
          }
        }
      },
      (err) => {
        setGpsWatchError(err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 2000,
      }
    );

    watchIdRef.current = watchId;
  };

  // Start continuous watch on mount, cleanup on unmount
  useEffect(() => {
    startContinuousGpsWatch();
    return () => {
      stopLiveTracking();
    };
  }, []);

  // Timer interval to tick countdown seconds smoothly during dwell verification
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (dwellActive && dwellStartTimeRef.current !== null) {
      interval = setInterval(() => {
        if (dwellStartTimeRef.current === null) return;
        const elapsedSec = Math.floor((Date.now() - dwellStartTimeRef.current) / 1000);
        const remaining = Math.max(0, dwellTargetSeconds - elapsedSec);
        setDwellRemainingSeconds(remaining);

        if (remaining <= 0 && currentLiveLocation && !isSubmittingRef.current) {
          dwellStartTimeRef.current = null;
          setDwellActive(false);
          handleAutomaticAction(
            'IN',
            currentLiveLocation,
            `Automatic entry confirmed after ${useFastTestDwell ? '15-second' : '10-minute'} continuous dwell in library`
          );
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [dwellActive, useFastTestDwell, currentLiveLocation]);

  // Handle Automatic Action (Automatic IN after dwell or Automatic OUT after exit confirmation)
  const handleAutomaticAction = async (
    action: 'IN' | 'OUT',
    location: LocationData,
    reasonMsg: string
  ) => {
    if (isSubmittingRef.current) return;
    setIsSubmitting(true);

    const geo = geofenceSettingsRef.current;

    // Feature 9 & 12: Offline detection during automatic geofence action
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      offlineQueue.enqueueEvent(
        student.id,
        student.fullName,
        action,
        location,
        'GEOFENCE_AUTO',
        geo?.version,
        action === 'IN' ? (useFastTestDwell ? 1 : 10) : undefined
      );

      setCurrentStatus(action === 'IN' ? 'INSIDE' : 'OUTSIDE');
      onStatusChange?.(action === 'IN' ? 'INSIDE' : 'OUTSIDE');
      setGeofenceStudentState(action === 'IN' ? 'INSIDE' : 'OUTSIDE');
      setIsSubmitting(false);

      setFeedback({
        type: 'info',
        message: `Offline mode: Automatic ${action} queued locally (PENDING_SYNC). Will sync when connection returns.`,
      });
      return;
    }

    try {
      const res = await api.markAttendance(
        action,
        location,
        student.id,
        student.fullName,
        'GEOFENCE_AUTO',
        geo?.version,
        action === 'IN' ? (useFastTestDwell ? 1 : 10) : undefined
      );

      setCurrentStatus(res.currentStatus);
      onStatusChange?.(res.currentStatus);
      setLastActionTime(res.event.timeFormatted);
      setTodayEvents(res.todayEvents);

      // Feature 1: Smart notifications on automatic transitions
      notificationService.notifyAttendanceChange(action, res.event.id, res.event.timeFormatted);
      api.sendNotification({
        recipientType: 'STUDENT',
        recipientStudentId: student.id,
        recipientStudentName: student.fullName,
        title: action === 'IN' ? 'Library Entry Recorded' : 'Library Exit Recorded',
        message:
          action === 'IN'
            ? 'Library Entry Recorded — You are now marked IN at the library.'
            : 'Library Exit Recorded — You have been marked OUT of the library.',
        category: 'ATTENDANCE',
        priority: 'normal',
        createdBy: 'System (Automatic Geofence)',
      }).catch(() => {});

      if (action === 'IN') {
        const newSession = res.session || null;
        setActiveSession(newSession);
        lastWrittenLocRef.current = location;
        lastWriteTimeRef.current = Date.now();
        sequenceNumRef.current = 1;
        setGeofenceStudentState('INSIDE');

        setFeedback({
          type: 'success',
          message: `🟢 ${reasonMsg}! Marked IN at ${res.event.timeFormatted}.`,
        });
      } else {
        setActiveSession(null);
        setGeofenceStudentState('OUTSIDE');
        setFeedback({
          type: 'info',
          message: `🔴 ${reasonMsg}! Automatically marked OUT at ${res.event.timeFormatted}.`,
        });
      }
    } catch (err: any) {
      console.warn('Auto geofence action error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Manual Action (First manual IN of the day or manual OUT)
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
      message: 'Acquiring fresh high-precision GPS position...',
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

    // Geofence Validation for First Manual IN
    const geo = geofenceSettingsRef.current;
    if (actionToTake === 'IN' && geo && geo.enabled) {
      const dist = computeDistanceMeters(
        capturedLoc.latitude,
        capturedLoc.longitude,
        geo.latitude,
        geo.longitude
      );
      setDistanceToGeofence(Math.round(dist));

      if (dist > geo.radiusMeters) {
        setIsSubmitting(false);
        setSubmittingStep(null);
        setFeedback({
          type: 'error',
          message: `Cannot mark IN: You are outside the library attendance boundary (~${Math.round(
            dist
          )}m from center, allowed: ${geo.radiusMeters}m). You must be physically inside the library.`,
        });
        return;
      }
    }

    setSubmittingStep(
      `Location locked (±${Math.round(capturedLoc.accuracy || 0)}m). Recording ${actionToTake}...`
    );

    // Feature 9 & 11: Offline support if internet is disconnected
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const queued = offlineQueue.enqueueEvent(
        student.id,
        student.fullName,
        actionToTake,
        capturedLoc,
        'MANUAL',
        geo?.version
      );

      setCurrentStatus(actionToTake === 'IN' ? 'INSIDE' : 'OUTSIDE');
      onStatusChange?.(actionToTake === 'IN' ? 'INSIDE' : 'OUTSIDE');
      if (actionToTake === 'IN') {
        setIsFirstManualInDoneToday(true);
        setGeofenceStudentState('INSIDE');
      } else {
        setGeofenceStudentState('OUTSIDE');
      }

      notificationService.notifyAttendanceChange(actionToTake, queued.localId, queued.timeFormatted);

      setFeedback({
        type: 'info',
        message: `Offline mode: ${actionToTake} queued locally (PENDING_SYNC). Attendance will sync when connection returns.`,
      });
      setIsSubmitting(false);
      setSubmittingStep(null);
      return;
    }

    try {
      const res = await api.markAttendance(
        actionToTake,
        capturedLoc,
        student.id,
        student.fullName,
        'MANUAL',
        geo?.version
      );

      setCurrentStatus(res.currentStatus);
      onStatusChange?.(res.currentStatus);
      setLastActionTime(res.event.timeFormatted);
      setTodayEvents(res.todayEvents);

      // Feature 1: Attendance notification
      notificationService.notifyAttendanceChange(actionToTake, res.event.id, res.event.timeFormatted);
      api.sendNotification({
        recipientType: 'STUDENT',
        recipientStudentId: student.id,
        recipientStudentName: student.fullName,
        title: actionToTake === 'IN' ? 'Library Entry Recorded' : 'Library Exit Recorded',
        message:
          actionToTake === 'IN'
            ? 'Library Entry Recorded — You are now marked IN at the library.'
            : 'Library Exit Recorded — You have been marked OUT of the library.',
        category: 'ATTENDANCE',
        priority: 'normal',
        createdBy: 'Manual Action',
      }).catch(() => {});

      if (actionToTake === 'IN') {
        setIsFirstManualInDoneToday(true);
        const newSession = res.session || null;
        setActiveSession(newSession);
        setCurrentLiveLocation(capturedLoc);
        lastWrittenLocRef.current = capturedLoc;
        lastWriteTimeRef.current = Date.now();
        sequenceNumRef.current = 1;
        setGeofenceStudentState('INSIDE');

        // Initialize active route
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

        const accStr = capturedLoc.accuracy
          ? ` (accuracy ±${Math.round(capturedLoc.accuracy)}m)`
          : '';
        setFeedback({
          type: 'success',
          message: `First IN marked successfully at ${res.event.timeFormatted}${accStr}! Automatic geofence monitoring is now active for today.`,
        });
      } else {
        // Manual OUT
        setActiveSession(null);
        setGeofenceStudentState('OUTSIDE');
        const accStr = capturedLoc.accuracy
          ? ` (accuracy ±${Math.round(capturedLoc.accuracy)}m)`
          : '';
        setFeedback({
          type: 'success',
          message: `Successfully marked OUT at ${res.event.timeFormatted}${accStr}. When you return to the library, automatic 10-minute entry verification will begin.`,
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

  const isInsideRadius =
    geofenceSettings && distanceToGeofence !== null
      ? distanceToGeofence <= geofenceSettings.radiusMeters
      : false;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Install PWA Prompt Banner */}
      <PWAInstallButton variant="banner" />

      {/* Main Terminal Card */}
      <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-stone-100 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs uppercase font-bold tracking-wider text-amber-700 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5" />
                <span>Digital Library Terminal</span>
              </span>

              {/* Feature 8 & 10: Offline Status Indicator */}
              {!isNetworkOnline ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-stone-200 text-stone-800 border border-stone-300">
                  <WifiOff className="w-3 h-3 text-stone-600" />
                  <span>Offline — Attendance will sync when connection returns</span>
                </span>
              ) : syncStatusText ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                  <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
                  <span>{syncStatusText}</span>
                </span>
              ) : pendingOfflineEventsCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                  <Clock className="w-3 h-3 text-amber-700" />
                  <span>{pendingOfflineEventsCount} attendance event{pendingOfflineEventsCount > 1 ? 's' : ''} waiting to sync</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Online ✓</span>
                </span>
              )}
            </div>
            <h2 className="text-2xl font-extrabold text-stone-900 tracking-tight">
              Welcome, {student.fullName}
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Feature 4: Student Notifications */}
            <button
              type="button"
              onClick={() => setNotificationModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer relative"
              title="Notifications"
            >
              <Bell className="w-3.5 h-3.5 text-amber-700" />
              <span>Notifications</span>
              {unreadNotificationCount > 0 && (
                <span className="px-1.5 py-0.2 bg-amber-600 text-white rounded-full text-[10px] font-bold">
                  {unreadNotificationCount}
                </span>
              )}
            </button>

            {/* Feature 7: Student Profile */}
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
              title="My Profile"
            >
              <User className="w-3.5 h-3.5 text-amber-700" />
              <span>My Profile</span>
            </button>

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
                    : geofenceStudentState === 'VERIFYING_ENTRY'
                    ? 'bg-amber-500 animate-ping'
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
                  : geofenceStudentState === 'VERIFYING_ENTRY'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-rose-100 text-rose-800 border border-rose-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  currentStatus === 'INSIDE'
                    ? 'bg-emerald-600 animate-ping'
                    : geofenceStudentState === 'VERIFYING_ENTRY'
                    ? 'bg-amber-600 animate-pulse'
                    : 'bg-rose-600'
                }`}
              />
              {currentStatus === 'INSIDE'
                ? 'Inside Library'
                : geofenceStudentState === 'VERIFYING_ENTRY'
                ? 'Verifying Entry (Dwell)'
                : 'Outside Library'}
            </span>

            {/* Live GPS Watch Indicator */}
            {isGpsWatching && (
              <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-emerald-700 font-semibold">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>
                  GPS Watch Active {lastGpsAccuracy ? `(±${Math.round(lastGpsAccuracy)}m)` : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* AUTOMATION & GEOFENCE STATUS SECTION */}
        <div className="mt-4 p-4 rounded-xl border border-stone-200 bg-stone-50/50 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-700" />
              <span className="text-xs font-bold uppercase tracking-wider text-stone-800">
                Automatic Geofence Tracking
              </span>
            </div>

            {/* Fast test toggle */}
            <div className="flex items-center gap-1.5 text-[11px] text-stone-500 font-medium">
              <Sliders className="w-3 h-3 text-stone-400" />
              <span>Dwell: {useFastTestDwell ? '15s Demo' : '10 min'}</span>
              <button
                type="button"
                onClick={() => setUseFastTestDwell((p) => !p)}
                className="text-amber-700 underline ml-1 hover:text-amber-800 text-[10px] cursor-pointer"
                title="Toggle fast 15s demo dwell for testing"
              >
                {useFastTestDwell ? 'Reset 10m' : 'Fast 15s'}
              </button>
            </div>
          </div>

          {/* Distance Indicator */}
          {geofenceSettings && geofenceSettings.enabled ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white rounded-lg border border-stone-200 text-xs">
              <div className="flex items-center gap-2">
                <MapPin
                  className={`w-4 h-4 ${isInsideRadius ? 'text-emerald-600' : 'text-rose-600'}`}
                />
                <div>
                  <span className="font-semibold text-stone-800">Distance to Library: </span>
                  <span className="font-mono font-bold text-stone-900">
                    {distanceToGeofence !== null ? `${distanceToGeofence}m` : 'Calculating...'}
                  </span>
                  <span className="text-stone-400 text-[11px] ml-1">
                    (Boundary radius: {geofenceSettings.radiusMeters}m)
                  </span>
                </div>
              </div>

              <span
                className={`px-2 py-0.5 rounded-full font-bold text-[11px] self-start sm:self-auto ${
                  isInsideRadius
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {isInsideRadius ? '🟢 Inside Allowed Area' : '🔴 Outside Allowed Area'}
              </span>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-stone-100 text-stone-600 text-xs font-medium">
              Geofence is currently disabled by Administrator (Open campus access).
            </div>
          )}

          {/* State Specific Prompt */}
          {!isFirstManualInDoneToday ? (
            /* First Manual IN Instruction */
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong>First Entry of the Day:</strong> You must physically enter the library and
                manually press <strong>&quot;MARK IN&quot;</strong> once. After this first entry, all
                subsequent IN/OUT events today will happen automatically based on your location.
              </div>
            </div>
          ) : (
            /* Automatic Mode Active Banner */
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-900 flex items-start gap-2">
              <Zap className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong>Automatic Attendance Monitoring Active:</strong> Your first IN of the day is
                complete! The system will automatically mark you OUT when you leave, and automatically
                mark you IN when you return and stay for 10 continuous minutes.
              </div>
            </div>
          )}

          {/* 10-Minute Dwell Countdown Card (Only when student is verifying entry on return) */}
          {geofenceStudentState === 'VERIFYING_ENTRY' && currentStatus === 'OUTSIDE' && (
            <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl text-amber-950 space-y-2 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xs">
                  <Timer className="w-4 h-4 text-amber-700 animate-spin" />
                  <span>Stay Verification in Progress</span>
                </div>
                <span className="font-mono text-base font-extrabold text-amber-900 bg-white px-2 py-0.5 rounded-md border border-amber-200 shadow-2xs">
                  {formatDuration(dwellRemainingSeconds)} remaining
                </span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                Inside attendance area. Stay here for{' '}
                <strong>{useFastTestDwell ? '15 seconds' : '10 continuous minutes'}</strong> to be
                automatically marked IN. If you leave early, verification will cancel.
              </p>
            </div>
          )}

          {/* Exit Verification Warning */}
          {geofenceStudentState === 'VERIFYING_EXIT' && currentStatus === 'INSIDE' && (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />
              <span>
                Detected movement outside library. Confirming exit via GPS before marking OUT...
              </span>
            </div>
          )}
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-4 p-3.5 rounded-xl border text-sm flex items-start gap-2.5 transition animate-fade-in ${
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

        {/* Action Buttons Section */}
        <div className="mt-6 pt-1">
          {!isFirstManualInDoneToday ? (
            /* First Manual IN of the Day Button */
            <button
              type="button"
              onClick={() => handleAttendanceAction('IN')}
              disabled={isSubmitting || isLoading || (geofenceSettings?.enabled && !isInsideRadius)}
              className={`w-full flex items-center justify-center gap-2.5 py-4 px-6 font-extrabold rounded-xl shadow-md transition-all duration-150 text-base cursor-pointer ${
                geofenceSettings?.enabled && !isInsideRadius
                  ? 'bg-stone-300 text-stone-500 cursor-not-allowed'
                  : 'bg-emerald-700 hover:bg-emerald-600 active:scale-99 text-white hover:shadow-lg'
              }`}
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{submittingStep || 'Processing First IN...'}</span>
                </div>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  <span>
                    {geofenceSettings?.enabled && !isInsideRadius
                      ? 'MOVE INSIDE LIBRARY TO MARK FIRST IN'
                      : 'MARK FIRST IN & START TODAY’S ATTENDANCE'}
                  </span>
                </>
              )}
            </button>
          ) : currentStatus === 'INSIDE' ? (
            /* Option to mark OUT manually if student wants early immediate departure */
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleAttendanceAction('OUT')}
                disabled={isSubmitting || isLoading}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-rose-700 hover:bg-rose-600 active:scale-99 text-white font-extrabold rounded-xl shadow-md transition-all text-sm cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Processing OUT...</span>
                  </div>
                ) : (
                  <>
                    <LogOut className="w-4 h-4" />
                    <span>MARK OUT (EARLY DEPARTURE)</span>
                  </>
                )}
              </button>
              <p className="text-[11px] text-center text-stone-500">
                You can also simply leave the library — the system will automatically mark you OUT
                upon exiting.
              </p>
            </div>
          ) : (
            /* When OUTSIDE after first IN: automatic mode active */
            <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 text-center space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-purple-900">
                <Check className="w-4 h-4 text-purple-700" />
                <span>Automatic Mode Active — No Manual Press Needed</span>
              </div>
              <p className="text-xs text-purple-700">
                When you re-enter the library, stay for 10 minutes to be automatically marked IN.
              </p>
            </div>
          )}
        </div>

        {/* Security & Strict Privacy Notice */}
        <div className="mt-6 pt-4 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-stone-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Anti-GPS-flapping verification &amp; 10-minute continuous dwell rule</span>
          </div>
          <div className="flex items-center gap-1 font-mono text-stone-400">
            <Radio className="w-3.5 h-3.5 text-stone-400" />
            <span>Device Geolocation API (No fake coordinates)</span>
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
            Your real-time GPS coordinate is being tracked during this active session. The moving dot
            and polyline update dynamically as you move within the library campus.
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
              Enter the library area and press &quot;MARK FIRST IN&quot; to begin.
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
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-stone-800">
                        {evt.action === 'IN' ? 'Entered Library (IN)' : 'Exited Library (OUT)'}
                      </span>
                      {evt.triggerType === 'GEOFENCE_AUTO' ? (
                        <span className="text-[9px] bg-purple-100 text-purple-800 border border-purple-200 px-1.5 py-0.2 rounded font-extrabold">
                          ⚡ Auto Geofence {evt.dwellMinutes ? `(${evt.dwellMinutes}m dwell)` : ''}
                        </span>
                      ) : (
                        <span className="text-[9px] bg-stone-200 text-stone-700 px-1.5 py-0.2 rounded font-semibold">
                          Manual
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-stone-500 font-mono">{evt.timeFormatted}</span>
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

      {/* Feature 4: Student Notification Center Modal */}
      {notificationModalOpen && (
        <StudentNotificationCenterModal
          studentId={student.id}
          isOpen={notificationModalOpen}
          onClose={() => setNotificationModalOpen(false)}
          onUnreadCountChange={(cnt) => setUnreadNotificationCount(cnt)}
        />
      )}

      {/* Feature 7: Student Profile Modal */}
      {profileModalOpen && (
        <StudentProfileModal
          student={student}
          isOpen={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
        />
      )}
    </div>
  );
}

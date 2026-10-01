import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';
import { db, auth } from '../firebase';
import { hashPassword, verifyPassword } from './crypto';
import type {
  StudentInfo,
  RegisteredStudentItem,
  ActivityEvent,
  AdminAttendanceReport,
  StudentDayRow,
  LocationData,
  StudentHistoryResponse,
  AttendanceSession,
  SessionLocationPoint,
  GeofenceSettings,
  NotificationItem,
  NotificationCategory,
  NotificationPriority,
  MembershipPeriod,
  OfflineAttendanceEvent,
} from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(error instanceof Error ? error.message : JSON.stringify(errInfo));
}

export function computeDateKey(isoString: string): string {
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLocalTime(isoString: string): string {
  const d = new Date(isoString);
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

export function computeDistanceMeters(
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

export function normalizeStudentName(firstNameRaw: string, lastNameRaw: string) {
  const cleanFirst = (firstNameRaw || '').trim().replace(/\s+/g, ' ');
  const cleanLast = (lastNameRaw || '').trim().replace(/\s+/g, ' ');

  if (!cleanFirst || !cleanLast) {
    throw new Error('Both First Name and Last Name are required.');
  }

  const normalized = `${cleanFirst.toLowerCase()} ${cleanLast.toLowerCase()}`;
  const formatWord = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const formattedFirst = cleanFirst.split(' ').map(formatWord).join(' ');
  const formattedLast = cleanLast.split(' ').map(formatWord).join(' ');
  const fullName = `${formattedFirst} ${formattedLast}`;

  return {
    firstName: formattedFirst,
    lastName: formattedLast,
    fullName,
    normalizedName: normalized,
  };
}

const AUTH_STUDENT_ID_KEY = 'lib_auth_student_id';
const ADMIN_AUTH_KEY = 'lib_admin_authenticated';

export const firebaseService = {
  // Ensure auth state ready with persistent session if supported
  async ensureAuthReady(): Promise<User | null> {
    if (auth.currentUser) {
      return auth.currentUser;
    }
    return new Promise((resolve) => {
      let resolved = false;
      const unsub = onAuthStateChanged(
        auth,
        (user) => {
          if (!resolved) {
            resolved = true;
            unsub();
            resolve(user);
          }
        },
        () => {
          if (!resolved) {
            resolved = true;
            unsub();
            resolve(null);
          }
        }
      );

      // Attempt anonymous sign-in gracefully, but never throw if disallowed on the project
      setTimeout(async () => {
        if (!resolved) {
          try {
            const cred = await signInAnonymously(auth);
            if (!resolved) {
              resolved = true;
              unsub();
              resolve(cred.user);
            }
          } catch {
            if (!resolved) {
              resolved = true;
              unsub();
              resolve(null);
            }
          }
        }
      }, 200);
    });
  },

  // --------------------------------------------------------------------------
  // ADMIN AUTHENTICATION
  // --------------------------------------------------------------------------
  isAdminLoggedIn(): boolean {
    return localStorage.getItem(ADMIN_AUTH_KEY) === 'true';
  },

  adminLogin(code: string): boolean {
    const validCode = 'Retype@77#';
    if (!code || code.trim() !== validCode) {
      throw new Error('Invalid admin code.');
    }
    localStorage.setItem(ADMIN_AUTH_KEY, 'true');
    return true;
  },

  adminLogout() {
    localStorage.removeItem(ADMIN_AUTH_KEY);
  },

  // --------------------------------------------------------------------------
  // STUDENT AUTHENTICATION & SESSION PERSISTENCE (Requirement 1 & 7)
  // --------------------------------------------------------------------------
  getSavedStudentId(): string | null {
    return localStorage.getItem(AUTH_STUDENT_ID_KEY);
  },

  /**
   * Restores authenticated student on website open / page reload.
   * Checks Firebase Auth and Firestore to ensure student is still active & not deleted.
   * Student stays logged in across days, refreshes, tab closures!
   */
  async restoreStudentSession(): Promise<StudentInfo | null> {
    try {
      const user = await this.ensureAuthReady();
      let targetStudentId = this.getSavedStudentId();

      if (!targetStudentId && user) {
        // Query student by authUid if available
        try {
          const q = query(collection(db, 'students'), where('authUid', '==', user.uid), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) {
            targetStudentId = snap.docs[0].id;
            localStorage.setItem(AUTH_STUDENT_ID_KEY, targetStudentId);
          }
        } catch {
          // ignore lookup error
        }
      }

      if (!targetStudentId) return null;

      const stuRef = doc(db, 'students', targetStudentId);
      const snap = await getDoc(stuRef);
      if (!snap.exists()) {
        localStorage.removeItem(AUTH_STUDENT_ID_KEY);
        return null;
      }
      const data = snap.data();
      if (!data.active) {
        localStorage.removeItem(AUTH_STUDENT_ID_KEY);
        return null;
      }

      return {
        id: snap.id,
        firstName: data.firstName,
        lastName: data.lastName,
        fullName: data.fullName,
        status: data.active ? 'active' : 'inactive',
        createdAt: data.createdAt,
        dateOfJoining: data.dateOfJoining || data.createdAt?.split('T')[0] || '',
      };
    } catch (err) {
      console.warn('Student session check notice:', err);
      return null;
    }
  },

  /**
   * Student Login using First Name + Last Name + Password
   * Automatically establishes persistent Firebase Authentication session.
   */
  async studentLogin(firstName: string, lastName: string, passwordRaw: string): Promise<StudentInfo> {
    const user = await this.ensureAuthReady();

    if (!passwordRaw || passwordRaw.trim().length === 0) {
      throw new Error('Please enter your password.');
    }

    const { normalizedName } = normalizeStudentName(firstName, lastName);

    const q = query(collection(db, 'students'), where('normalizedName', '==', normalizedName), limit(1));
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'students');
    }

    if (snap.empty) {
      throw new Error('Student account not found. Please contact the administrator.');
    }

    const docSnap = snap.docs[0];
    const data = docSnap.data();

    if (!data.active) {
      throw new Error('Your library registration is currently inactive. Please contact the administrator.');
    }

    const isMatch = await verifyPassword(passwordRaw, data.passwordHash);
    if (!isMatch) {
      throw new Error('Incorrect password. Please verify and try again.');
    }

    // Link student record to persistent Firebase Auth UID if user exists
    if (user) {
      try {
        await updateDoc(docSnap.ref, {
          authUid: user.uid,
          lastLoginAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Failed to update student authUid:', err);
      }
    }

    // Persist student session ID
    localStorage.setItem(AUTH_STUDENT_ID_KEY, docSnap.id);

    return {
      id: docSnap.id,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: data.fullName,
      status: 'active',
      createdAt: data.createdAt,
      dateOfJoining: data.dateOfJoining || data.createdAt?.split('T')[0] || '',
    };
  },

  async studentLogout(): Promise<void> {
    localStorage.removeItem(AUTH_STUDENT_ID_KEY);
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  },

  // --------------------------------------------------------------------------
  // LIVE GPS & ATTENDANCE SESSION MANAGEMENT (Requirement 2, 3, 4, 7, 8, 9)
  // --------------------------------------------------------------------------

  /**
   * Checks if student currently has an active attendance session (status: 'INSIDE')
   */
  async getActiveSession(studentId: string): Promise<AttendanceSession | null> {
    await this.ensureAuthReady();
    try {
      const q = query(
        collection(db, 'attendanceSessions'),
        where('studentId', '==', studentId),
        where('status', '==', 'INSIDE'),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;

      const docSnap = snap.docs[0];
      const data = docSnap.data();
      return {
        id: docSnap.id,
        studentId: data.studentId,
        studentName: data.studentName,
        dateKey: data.dateKey,
        inTimestamp: data.inTimestamp,
        outTimestamp: data.outTimestamp || null,
        inLocation: data.inLocation || null,
        outLocation: data.outLocation || null,
        lastLocation: data.lastLocation || null,
        status: data.status,
        totalMinutesInside: data.totalMinutesInside || null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'attendanceSessions');
    }
  },

  /**
   * Fallback direct single attendance event recording
   */
  async recordAttendance(
    studentId: string,
    studentName: string,
    requestedAction: 'IN' | 'OUT',
    location?: LocationData | null,
    triggerType: 'MANUAL' | 'GEOFENCE_AUTO' = 'MANUAL',
    geofenceVersion?: string,
    dwellMinutes?: number
  ): Promise<{
    event: ActivityEvent;
    newStatus: 'INSIDE' | 'OUTSIDE';
  }> {
    await this.ensureAuthReady();

    const stuRef = doc(db, 'students', studentId);
    const stuSnap = await getDoc(stuRef);
    if (!stuSnap.exists() || !stuSnap.data().active) {
      throw new Error('Your library registration is currently inactive. Please contact the administrator.');
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = computeDateKey(timestamp);
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const eventPayload: any = {
      id: eventId,
      studentId,
      studentName,
      action: requestedAction,
      triggerType,
      geofenceVersion: geofenceVersion || null,
      dwellMinutes: dwellMinutes ?? (triggerType === 'GEOFENCE_AUTO' && requestedAction === 'IN' ? 10 : null),
      timestamp,
      dateKey,
      location:
        location && typeof location.latitude === 'number' && typeof location.longitude === 'number'
          ? {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy != null ? Number(location.accuracy) : null,
            }
          : null,
      createdAt: timestamp,
    };

    try {
      await setDoc(doc(db, 'attendanceEvents', eventId), eventPayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'attendanceEvents');
    }

    const event: ActivityEvent = {
      id: eventId,
      studentId,
      studentName,
      action: requestedAction,
      triggerType,
      geofenceVersion,
      dwellMinutes: eventPayload.dwellMinutes,
      timestamp,
      timeFormatted: formatLocalTime(timestamp),
      location: eventPayload.location,
    };

    return {
      event,
      newStatus: requestedAction === 'IN' ? 'INSIDE' : 'OUTSIDE',
    };
  },

  /**
   * Starts an attendance session when student presses IN or automatic geofence triggers IN.
   * Real GPS tracking is initiated.
   */
  async startAttendanceSession(
    studentId: string,
    studentName: string,
    inLocation: LocationData,
    triggerType: 'MANUAL' | 'GEOFENCE_AUTO' = 'MANUAL',
    geofenceVersion?: string,
    dwellMinutes?: number
  ): Promise<{
    session: AttendanceSession;
    event: ActivityEvent;
  }> {
    await this.ensureAuthReady();

    // Verify student is active in Firestore
    const stuRef = doc(db, 'students', studentId);
    const stuSnap = await getDoc(stuRef);
    if (!stuSnap.exists() || !stuSnap.data().active) {
      throw new Error('Your library registration is currently inactive. Please contact the administrator.');
    }

    // Check if an active session already exists
    const existing = await this.getActiveSession(studentId);
    if (existing) {
      throw new Error('Invalid action: You are already marked INSIDE with an active attendance session.');
    }

    const now = new Date();
    const inTimestamp = now.toISOString();
    const dateKey = computeDateKey(inTimestamp);
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const sessionPayload: AttendanceSession = {
      id: sessionId,
      studentId,
      studentName,
      dateKey,
      inTimestamp,
      outTimestamp: null,
      triggerType,
      geofenceVersion: geofenceVersion || undefined,
      inLocation: {
        latitude: inLocation.latitude,
        longitude: inLocation.longitude,
        accuracy: inLocation.accuracy,
      },
      outLocation: null,
      lastLocation: {
        latitude: inLocation.latitude,
        longitude: inLocation.longitude,
        accuracy: inLocation.accuracy,
        timestamp: inTimestamp,
      },
      status: 'INSIDE',
      totalMinutesInside: null,
      createdAt: inTimestamp,
      updatedAt: inTimestamp,
    };

    // 1. Create session document in Firestore
    try {
      await setDoc(doc(db, 'attendanceSessions', sessionId), sessionPayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `attendanceSessions/${sessionId}`);
    }

    // 2. Save initial waypoint in locations subcollection
    const initialLocationPoint: SessionLocationPoint = {
      id: 'loc_0',
      sessionId,
      studentId,
      latitude: inLocation.latitude,
      longitude: inLocation.longitude,
      accuracy: inLocation.accuracy,
      timestamp: inTimestamp,
      sequenceNumber: 0,
    };

    try {
      await setDoc(
        doc(db, 'attendanceSessions', sessionId, 'locations', 'loc_0'),
        initialLocationPoint
      );
    } catch (err) {
      console.warn('Initial location point save warning:', err);
    }

    // 3. Record attendance event for legacy and date-wise summary reporting
    const eventPayload: any = {
      id: eventId,
      studentId,
      studentName,
      action: 'IN',
      triggerType,
      geofenceVersion: geofenceVersion || null,
      dwellMinutes: dwellMinutes ?? (triggerType === 'GEOFENCE_AUTO' ? 10 : null),
      timestamp: inTimestamp,
      dateKey,
      location: sessionPayload.inLocation,
      createdAt: inTimestamp,
    };
    try {
      await setDoc(doc(db, 'attendanceEvents', eventId), eventPayload);
    } catch (err) {
      console.warn('AttendanceEvent write warning:', err);
    }

    const event: ActivityEvent = {
      id: eventId,
      studentId,
      studentName,
      action: 'IN',
      triggerType,
      geofenceVersion,
      dwellMinutes: eventPayload.dwellMinutes,
      timestamp: inTimestamp,
      timeFormatted: formatLocalTime(inTimestamp),
      location: sessionPayload.inLocation,
    };

    return {
      session: sessionPayload,
      event,
    };
  },

  /**
   * Saves a valid live GPS waypoint to the active session's locations subcollection
   * and updates lastLocation on the session document for real-time monitoring.
   */
  async recordSessionLocationPoint(
    sessionId: string,
    studentId: string,
    location: LocationData,
    sequenceNumber: number
  ): Promise<SessionLocationPoint> {
    await this.ensureAuthReady();

    const timestamp = new Date().toISOString();
    const pointId = `loc_${Date.now()}_${sequenceNumber}`;

    const point: SessionLocationPoint = {
      id: pointId,
      sessionId,
      studentId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      timestamp,
      sequenceNumber,
    };

    try {
      // Write subcollection point
      await setDoc(doc(db, 'attendanceSessions', sessionId, 'locations', pointId), point);

      // Update session lastLocation
      await updateDoc(doc(db, 'attendanceSessions', sessionId), {
        lastLocation: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          timestamp,
        },
        updatedAt: timestamp,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `attendanceSessions/${sessionId}/locations`);
    }

    return point;
  },

  /**
   * Completes attendance session when student presses OUT or automatic geofence triggers OUT.
   * Stops live tracking and preserves historical route.
   */
  async endAttendanceSession(
    studentId: string,
    sessionId: string,
    outLocation?: LocationData | null,
    triggerType: 'MANUAL' | 'GEOFENCE_AUTO' = 'MANUAL',
    geofenceVersion?: string
  ): Promise<{
    session: AttendanceSession;
    event: ActivityEvent;
  }> {
    await this.ensureAuthReady();

    const sessRef = doc(db, 'attendanceSessions', sessionId);
    const sessSnap = await getDoc(sessRef);
    if (!sessSnap.exists()) {
      throw new Error('Active session not found.');
    }
    const currentData = sessSnap.data() as AttendanceSession;

    if (currentData.status === 'OUTSIDE') {
      throw new Error('Invalid action: This session is already closed.');
    }

    const now = new Date();
    const outTimestamp = now.toISOString();
    const inTime = new Date(currentData.inTimestamp).getTime();
    const outTime = now.getTime();
    const totalMinutesInside = Math.max(0, Math.round((outTime - inTime) / (1000 * 60)));

    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const outLocObj =
      outLocation && typeof outLocation.latitude === 'number'
        ? {
            latitude: outLocation.latitude,
            longitude: outLocation.longitude,
            accuracy: outLocation.accuracy,
          }
        : currentData.lastLocation
        ? {
            latitude: currentData.lastLocation.latitude,
            longitude: currentData.lastLocation.longitude,
            accuracy: currentData.lastLocation.accuracy,
          }
        : null;

    // Save final waypoint if location available
    if (outLocObj) {
      try {
        const finalLocId = `loc_final_${Date.now()}`;
        await setDoc(doc(db, 'attendanceSessions', sessionId, 'locations', finalLocId), {
          id: finalLocId,
          sessionId,
          studentId,
          latitude: outLocObj.latitude,
          longitude: outLocObj.longitude,
          accuracy: outLocObj.accuracy,
          timestamp: outTimestamp,
          sequenceNumber: 999999,
        });
      } catch (err) {
        console.warn('Final location point write warning:', err);
      }
    }

    // Update session document
    const updatePayload: any = {
      status: 'OUTSIDE',
      outTimestamp,
      outLocation: outLocObj,
      triggerType,
      geofenceVersion: geofenceVersion || currentData.geofenceVersion || null,
      lastLocation: outLocObj
        ? {
            ...outLocObj,
            timestamp: outTimestamp,
          }
        : currentData.lastLocation,
      totalMinutesInside,
      updatedAt: outTimestamp,
    };

    try {
      await updateDoc(sessRef, updatePayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `attendanceSessions/${sessionId}`);
    }

    // Record OUT event in attendanceEvents
    const eventPayload: any = {
      id: eventId,
      studentId,
      studentName: currentData.studentName,
      action: 'OUT',
      triggerType,
      geofenceVersion: geofenceVersion || currentData.geofenceVersion || null,
      timestamp: outTimestamp,
      dateKey: currentData.dateKey,
      location: outLocObj,
      createdAt: outTimestamp,
    };
    try {
      await setDoc(doc(db, 'attendanceEvents', eventId), eventPayload);
    } catch (err) {
      console.warn('AttendanceEvents write warning:', err);
    }

    const event: ActivityEvent = {
      id: eventId,
      studentId,
      studentName: currentData.studentName,
      action: 'OUT',
      triggerType,
      geofenceVersion: eventPayload.geofenceVersion,
      timestamp: outTimestamp,
      timeFormatted: formatLocalTime(outTimestamp),
      location: outLocObj,
    };

    return {
      session: {
        ...currentData,
        ...updatePayload,
      } as AttendanceSession,
      event,
    };
  },

  /**
   * Real-time subscription to route waypoints of an attendance session
   */
  subscribeToSessionRoute(
    sessionId: string,
    callback: (points: SessionLocationPoint[]) => void
  ): () => void {
    const q = query(
      collection(db, 'attendanceSessions', sessionId, 'locations'),
      orderBy('sequenceNumber', 'asc')
    );
    return onSnapshot(
      q,
      (snap) => {
        const points = snap.docs.map((d) => d.data() as SessionLocationPoint);
        callback(points);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `attendanceSessions/${sessionId}/locations`);
      }
    );
  },

  /**
   * Fetches all route waypoints for a specific session
   */
  async getSessionLocations(sessionId: string): Promise<SessionLocationPoint[]> {
    await this.ensureAuthReady();
    try {
      const q = query(
        collection(db, 'attendanceSessions', sessionId, 'locations'),
        orderBy('sequenceNumber', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as SessionLocationPoint);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `attendanceSessions/${sessionId}/locations`);
    }
  },

  /**
   * Real-time subscription to all currently active sessions (INSIDE) for Admin Live Map
   */
  subscribeToActiveLiveSessions(
    callback: (sessions: AttendanceSession[]) => void
  ): () => void {
    const q = query(
      collection(db, 'attendanceSessions'),
      where('status', '==', 'INSIDE'),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as AttendanceSession);
        callback(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'attendanceSessions');
      }
    );
  },

  /**
   * Fetches all attendance sessions for a specific student and date
   */
  async getStudentSessionsForDate(
    studentId: string,
    dateKey: string
  ): Promise<AttendanceSession[]> {
    await this.ensureAuthReady();
    try {
      const q = query(
        collection(db, 'attendanceSessions'),
        where('studentId', '==', studentId),
        where('dateKey', '==', dateKey),
        orderBy('inTimestamp', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as AttendanceSession);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'attendanceSessions');
    }
  },

  /**
   * Queries Firestore for student's true current status ('INSIDE' vs 'OUTSIDE')
   * Checks both active attendance sessions and latest attendance events.
   */
  async getStudentCurrentStatus(studentId: string): Promise<{
    status: 'INSIDE' | 'OUTSIDE';
    lastEvent: ActivityEvent | null;
    activeSession: AttendanceSession | null;
  }> {
    await this.ensureAuthReady();

    const activeSession = await this.getActiveSession(studentId);
    if (activeSession) {
      const lastEvent: ActivityEvent = {
        id: activeSession.id,
        action: 'IN',
        timestamp: activeSession.inTimestamp,
        timeFormatted: formatLocalTime(activeSession.inTimestamp),
        location: activeSession.lastLocation || activeSession.inLocation || null,
      };
      return {
        status: 'INSIDE',
        lastEvent,
        activeSession,
      };
    }

    try {
      const q = query(
        collection(db, 'attendanceEvents'),
        where('studentId', '==', studentId),
        orderBy('timestamp', 'desc'),
        limit(1)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        return { status: 'OUTSIDE', lastEvent: null, activeSession: null };
      }

      const docSnap = snap.docs[0];
      const data = docSnap.data();
      const lastEvent: ActivityEvent = {
        id: docSnap.id,
        action: data.action,
        timestamp: data.timestamp,
        timeFormatted: formatLocalTime(data.timestamp),
        location: data.location || null,
      };

      return {
        status: data.action === 'IN' ? 'INSIDE' : 'OUTSIDE',
        lastEvent,
        activeSession: null,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'attendanceEvents');
    }
  },

  /**
   * Fetches today's events for a specific student
   */
  async getStudentTodayEvents(studentId: string, dateKey: string): Promise<ActivityEvent[]> {
    await this.ensureAuthReady();

    try {
      const q = query(
        collection(db, 'attendanceEvents'),
        where('studentId', '==', studentId),
        where('dateKey', '==', dateKey),
        orderBy('timestamp', 'asc')
      );
      const snap = await getDocs(q);

      return snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          action: d.action,
          timestamp: d.timestamp,
          timeFormatted: formatLocalTime(d.timestamp),
          location: d.location || null,
        };
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'attendanceEvents');
    }
  },

  // --------------------------------------------------------------------------
  // ADMIN STUDENT MANAGEMENT (Requirements 1, 2, 3, 4, 5, 12)
  // --------------------------------------------------------------------------

  /**
   * Real-time subscription to students collection.
   * Starts with 0 students when database is empty.
   */
  subscribeToStudents(callback: (students: RegisteredStudentItem[]) => void): () => void {
    const q = query(collection(db, 'students'));
    return onSnapshot(
      q,
      async (snap) => {
        const studentDocs = snap.docs;
        if (studentDocs.length === 0) {
          callback([]);
          return;
        }

        const list: RegisteredStudentItem[] = await Promise.all(
          studentDocs.map(async (docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;

            let totalEvents = 0;
            let lastAction = null;

            try {
              const evQ = query(
                collection(db, 'attendanceEvents'),
                where('studentId', '==', id),
                orderBy('timestamp', 'desc'),
                limit(1)
              );
              const evSnap = await getDocs(evQ);
              if (!evSnap.empty) {
                const latest = evSnap.docs[0].data();
                lastAction = {
                  action: latest.action as 'IN' | 'OUT',
                  timestamp: latest.timestamp,
                  location: latest.location || null,
                };
              }
            } catch {
              // ignore
            }

            return {
              id,
              firstName: data.firstName,
              lastName: data.lastName,
              fullName: data.fullName,
              status: data.active ? 'active' : 'inactive',
              createdAt: data.createdAt,
              dateOfJoining: data.dateOfJoining || data.createdAt?.split('T')[0] || '',
              totalEvents,
              lastAction,
            };
          })
        );

        list.sort((a, b) => a.fullName.localeCompare(b.fullName));
        callback(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'students');
      }
    );
  },

  /**
   * Adds a new student into Firestore with duplicate detection and Date of Joining
   */
  async addStudent(
    firstNameRaw: string,
    lastNameRaw: string,
    passwordRaw: string,
    dateOfJoiningRaw?: string
  ): Promise<StudentInfo> {
    await this.ensureAuthReady();

    const { firstName, lastName, fullName, normalizedName } = normalizeStudentName(firstNameRaw, lastNameRaw);

    if (!passwordRaw || passwordRaw.trim().length < 4) {
      throw new Error('Password must be at least 4 characters long.');
    }

    if (!dateOfJoiningRaw || !dateOfJoiningRaw.trim()) {
      throw new Error('Date of Joining is required.');
    }

    const dateOfJoining = dateOfJoiningRaw.trim();

    // Check for existing student with same normalized name
    const q = query(collection(db, 'students'), where('normalizedName', '==', normalizedName), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const existing = snap.docs[0].data();
      throw new Error(
        existing.active
          ? `A student with name "${existing.fullName}" is already registered.`
          : `A student with name "${existing.fullName}" is already registered but currently inactive. You can reactivate them.`
      );
    }

    const passwordHash = await hashPassword(passwordRaw);
    const studentId = `stu_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    const newStudentDoc = {
      id: studentId,
      firstName,
      lastName,
      fullName,
      normalizedName,
      active: true,
      passwordHash,
      dateOfJoining,
      createdAt: now,
    };

    try {
      await setDoc(doc(db, 'students', studentId), newStudentDoc);

      // Create Admin system notification
      this.createNotification({
        recipientType: 'ADMIN',
        title: 'New Student Added',
        message: `New student registered: ${fullName} (Date of Joining: ${dateOfJoining}).`,
        category: 'STUDENTS',
        priority: 'normal',
        createdBy: 'Admin',
        metadata: { studentId, fullName, dateOfJoining },
      }).catch(() => {});
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'students');
    }

    return {
      id: studentId,
      firstName,
      lastName,
      fullName,
      status: 'active',
      createdAt: now,
      dateOfJoining,
    };
  },

  /**
   * Permanently deletes a student and all associated attendance events and sessions
   */
  async deleteStudent(studentId: string): Promise<void> {
    await this.ensureAuthReady();

    try {
      // 1. Delete all attendance events belonging to this student
      const evQ = query(collection(db, 'attendanceEvents'), where('studentId', '==', studentId));
      const evSnap = await getDocs(evQ);
      if (!evSnap.empty) {
        const batch = writeBatch(db);
        evSnap.docs.forEach((d) => {
          batch.delete(d.ref);
        });
        await batch.commit();
      }

      // 2. Delete all attendance sessions
      const sessQ = query(collection(db, 'attendanceSessions'), where('studentId', '==', studentId));
      const sessSnap = await getDocs(sessQ);
      if (!sessSnap.empty) {
        const batch = writeBatch(db);
        sessSnap.docs.forEach((d) => {
          batch.delete(d.ref);
        });
        await batch.commit();
      }

      // 3. Delete the student document
      await deleteDoc(doc(db, 'students', studentId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `students/${studentId}`);
    }
  },

  /**
   * Deactivates / activates a student (preserves historical records)
   */
  async updateStudentStatus(studentId: string, status: 'active' | 'inactive'): Promise<void> {
    await this.ensureAuthReady();

    try {
      const stuRef = doc(db, 'students', studentId);
      await updateDoc(stuRef, {
        active: status === 'active',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${studentId}`);
    }
  },

  /**
   * Resets student password
   */
  async resetStudentPassword(studentId: string, newPasswordRaw: string): Promise<void> {
    await this.ensureAuthReady();

    if (!newPasswordRaw || newPasswordRaw.trim().length < 4) {
      throw new Error('New password must be at least 4 characters long.');
    }

    const newHash = await hashPassword(newPasswordRaw);

    try {
      const stuRef = doc(db, 'students', studentId);
      await updateDoc(stuRef, {
        passwordHash: newHash,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${studentId}`);
    }
  },

  // --------------------------------------------------------------------------
  // ADMIN DAILY ATTENDANCE & SUMMARY (Requirements 9, 10, 13)
  // --------------------------------------------------------------------------

  /**
   * Real-time subscription to daily attendance for a selected dateKey.
   * Directly computes summary statistics from Firestore.
   */
  subscribeToDailyAttendance(
    dateKey: string,
    callback: (report: AdminAttendanceReport) => void
  ): () => void {
    const studentsQ = query(collection(db, 'students'));
    const eventsQ = query(collection(db, 'attendanceEvents'), where('dateKey', '==', dateKey));
    const activeSessionsQ = query(
      collection(db, 'attendanceSessions'),
      where('dateKey', '==', dateKey),
      where('status', '==', 'INSIDE')
    );

    let unsubEvents: (() => void) | null = null;
    let unsubSessions: (() => void) | null = null;

    const unsubStudents = onSnapshot(
      studentsQ,
      (studentsSnap) => {
        const allStudents = studentsSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as any[];

        if (unsubEvents) unsubEvents();
        if (unsubSessions) unsubSessions();

        let activeSessionsMap = new Map<string, AttendanceSession>();

        unsubSessions = onSnapshot(activeSessionsQ, (sessSnap) => {
          activeSessionsMap = new Map<string, AttendanceSession>();
          sessSnap.docs.forEach((d) => {
            const sess = d.data() as AttendanceSession;
            activeSessionsMap.set(sess.studentId, sess);
          });
        });

        unsubEvents = onSnapshot(
          eventsQ,
          async (eventsSnap) => {
            const dateEvents = eventsSnap.docs.map((d) => ({
              id: d.id,
              ...d.data(),
            })) as any[];

            dateEvents.sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            // Group events by student
            const eventsByStudent = new Map<string, any[]>();
            for (const ev of dateEvents) {
              if (!eventsByStudent.has(ev.studentId)) {
                eventsByStudent.set(ev.studentId, []);
              }
              eventsByStudent.get(ev.studentId)!.push(ev);
            }

            let presentCount = 0;
            let currentlyInsideCount = 0;

            const studentRows: StudentDayRow[] = [];

            for (const s of allStudents) {
              const stuEvents = eventsByStudent.get(s.id) || [];
              const hasInAction = stuEvents.some((e) => e.action === 'IN');
              const hasActiveSession = activeSessionsMap.has(s.id);
              const isPresent = hasInAction || hasActiveSession;

              if (isPresent) {
                presentCount++;
              }

              let dailyStatus: 'INSIDE' | 'OUTSIDE' | 'ABSENT' = 'ABSENT';
              if (hasActiveSession) {
                dailyStatus = 'INSIDE';
              } else if (isPresent) {
                const lastDayEvent = stuEvents[stuEvents.length - 1];
                dailyStatus = lastDayEvent?.action === 'IN' ? 'INSIDE' : 'OUTSIDE';
              }

              let lastAction = null;
              if (stuEvents.length > 0) {
                const lastEvt = stuEvents[stuEvents.length - 1];
                lastAction = {
                  action: lastEvt.action as 'IN' | 'OUT',
                  timestamp: lastEvt.timestamp,
                  timeFormatted: formatLocalTime(lastEvt.timestamp),
                  location: lastEvt.location || null,
                  triggerType: lastEvt.triggerType || 'MANUAL',
                  geofenceVersion: lastEvt.geofenceVersion,
                };
              }

              if (dailyStatus === 'INSIDE') {
                currentlyInsideCount++;
              }

              let totalMinutesInside = 0;
              let visits = 0;
              let inTime: number | null = null;

              const formattedEvents: ActivityEvent[] = stuEvents.map((ev) => {
                if (ev.action === 'IN') {
                  visits++;
                  inTime = new Date(ev.timestamp).getTime();
                } else if (ev.action === 'OUT' && inTime !== null) {
                  const outTime = new Date(ev.timestamp).getTime();
                  const diffMinutes = Math.max(0, Math.round((outTime - inTime) / (1000 * 60)));
                  totalMinutesInside += diffMinutes;
                  inTime = null;
                }

                return {
                  id: ev.id,
                  studentId: ev.studentId,
                  studentName: ev.studentName,
                  action: ev.action,
                  triggerType: ev.triggerType || 'MANUAL',
                  geofenceVersion: ev.geofenceVersion,
                  dwellMinutes: ev.dwellMinutes,
                  timestamp: ev.timestamp,
                  timeFormatted: formatLocalTime(ev.timestamp),
                  location: ev.location || null,
                };
              });

              // If currently inside, add elapsed minutes
              const activeSess = activeSessionsMap.get(s.id);
              if (activeSess) {
                const elapsedNow = Math.max(
                  0,
                  Math.round((Date.now() - new Date(activeSess.inTimestamp).getTime()) / (1000 * 60))
                );
                totalMinutesInside += elapsedNow;
              }

              studentRows.push({
                studentId: s.id,
                firstName: s.firstName,
                lastName: s.lastName,
                fullName: s.fullName,
                studentStatus: s.active ? 'active' : 'inactive',
                dailyStatus,
                isPresent,
                lastAction,
                events: formattedEvents,
                totalVisits: Math.max(visits, hasActiveSession ? 1 : 0),
                totalMinutesInside,
                activeSessionId: activeSess?.id || null,
                lastLocation: activeSess?.lastLocation || null,
              });
            }

            studentRows.sort((a, b) => {
              if (a.dailyStatus === 'INSIDE' && b.dailyStatus !== 'INSIDE') return -1;
              if (b.dailyStatus === 'INSIDE' && a.dailyStatus !== 'INSIDE') return 1;
              if (a.dailyStatus === 'OUTSIDE' && b.dailyStatus === 'ABSENT') return -1;
              if (b.dailyStatus === 'OUTSIDE' && a.dailyStatus === 'ABSENT') return 1;
              return a.fullName.localeCompare(b.fullName);
            });

            const activeStudents = allStudents.filter((s) => s.active);
            const totalRegistered = activeStudents.length;
            const absentCount = Math.max(0, totalRegistered - presentCount);

            callback({
              date: dateKey,
              summary: {
                totalRegistered,
                presentToday: presentCount,
                absentToday: absentCount,
                currentlyInside: currentlyInsideCount,
                totalActions: dateEvents.length,
              },
              students: studentRows,
            });
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, 'attendanceEvents');
          }
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'students');
      }
    );

    return () => {
      unsubStudents();
      if (unsubEvents) unsubEvents();
      if (unsubSessions) unsubSessions();
    };
  },

  /**
   * Fetches full historical attendance across all days for a specific student,
   * including independent sessions and route summaries
   */
  async getStudentFullHistory(studentId: string): Promise<StudentHistoryResponse> {
    await this.ensureAuthReady();

    const stuRef = doc(db, 'students', studentId);
    const stuSnap = await getDoc(stuRef);
    if (!stuSnap.exists()) {
      throw new Error('Student not found.');
    }
    const studentData = stuSnap.data();

    // Fetch all events
    const qEvents = query(
      collection(db, 'attendanceEvents'),
      where('studentId', '==', studentId),
      orderBy('timestamp', 'desc')
    );
    const eventsSnap = await getDocs(qEvents);

    // Fetch all sessions
    const qSessions = query(
      collection(db, 'attendanceSessions'),
      where('studentId', '==', studentId),
      orderBy('createdAt', 'desc')
    );
    const sessionsSnap = await getDocs(qSessions);

    const dateGroups: Record<string, ActivityEvent[]> = {};
    const sessionGroups: Record<string, AttendanceSession[]> = {};

    eventsSnap.docs.forEach((docSnap) => {
      const e = docSnap.data();
      if (!dateGroups[e.dateKey]) {
        dateGroups[e.dateKey] = [];
      }
      dateGroups[e.dateKey].push({
        id: docSnap.id,
        action: e.action,
        timestamp: e.timestamp,
        timeFormatted: formatLocalTime(e.timestamp),
        location: e.location || null,
      });
    });

    sessionsSnap.docs.forEach((docSnap) => {
      const s = docSnap.data() as AttendanceSession;
      if (!sessionGroups[s.dateKey]) {
        sessionGroups[s.dateKey] = [];
      }
      sessionGroups[s.dateKey].push(s);
    });

    const allDates = Array.from(
      new Set([...Object.keys(dateGroups), ...Object.keys(sessionGroups)])
    ).sort((a, b) => b.localeCompare(a));

    const groupedList = allDates.map((dateKey) => ({
      dateKey,
      events: (dateGroups[dateKey] || []).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ),
      sessions: (sessionGroups[dateKey] || []).sort(
        (a, b) => new Date(a.inTimestamp).getTime() - new Date(b.inTimestamp).getTime()
      ),
    }));

    const { status, lastEvent } = await this.getStudentCurrentStatus(studentId);

    return {
      student: {
        id: studentId,
        firstName: studentData.firstName,
        lastName: studentData.lastName,
        fullName: studentData.fullName,
        status: studentData.active ? 'active' : 'inactive',
        createdAt: studentData.createdAt,
      },
      currentStatus: status,
      lastAction: lastEvent,
      history: groupedList,
    };
  },

  // --------------------------------------------------------------------------
  // GEOFENCE SETTINGS & AUTOMATIC ATTENDANCE (Requirements 1, 2, 3, 10, 16, 17, 18)
  // --------------------------------------------------------------------------
  async getGeofenceSettings(): Promise<GeofenceSettings> {
    await this.ensureAuthReady();
    const docRef = doc(db, 'geofenceSettings', 'library');
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          id: snap.id,
          latitude: Number(data.latitude),
          longitude: Number(data.longitude),
          radiusMeters: Number(data.radiusMeters) || 100,
          enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
          version: data.version || 'v1',
          address: data.address || 'Digital Library Campus, Main Block',
          updatedAt: data.updatedAt || new Date().toISOString(),
          updatedBy: data.updatedBy || 'Admin',
        };
      }

      // Default geofence configuration
      const defaultSettings: GeofenceSettings = {
        id: 'library',
        latitude: 33.7782,
        longitude: 75.1495,
        radiusMeters: 100,
        enabled: true,
        version: 'v1',
        address: 'Digital Library Campus, Main Block',
        updatedAt: new Date().toISOString(),
        updatedBy: 'Admin',
      };

      try {
        await setDoc(docRef, defaultSettings);
      } catch {
        // Ignore if read-only
      }
      return defaultSettings;
    } catch (err) {
      console.warn('Geofence settings fetch notice, returning fallback:', err);
      return {
        id: 'library',
        latitude: 33.7782,
        longitude: 75.1495,
        radiusMeters: 100,
        enabled: true,
        version: 'v1',
        address: 'Digital Library Campus, Main Block',
        updatedAt: new Date().toISOString(),
        updatedBy: 'Admin',
      };
    }
  },

  async saveGeofenceSettings(
    settings: {
      latitude: number;
      longitude: number;
      radiusMeters: number;
      enabled: boolean;
      address?: string;
    }
  ): Promise<GeofenceSettings> {
    await this.ensureAuthReady();
    const version = `v_${Date.now()}`;
    const updatedAt = new Date().toISOString();
    const payload: GeofenceSettings = {
      id: 'library',
      latitude: Number(settings.latitude),
      longitude: Number(settings.longitude),
      radiusMeters: Math.max(10, Math.min(5000, Number(settings.radiusMeters))),
      enabled: Boolean(settings.enabled),
      version,
      address: settings.address || 'Digital Library Campus',
      updatedAt,
      updatedBy: 'Admin',
    };

    try {
      const docRef = doc(db, 'geofenceSettings', 'library');
      await setDoc(docRef, payload);
      return payload;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'geofenceSettings/library');
    }
  },

  subscribeToGeofenceSettings(callback: (settings: GeofenceSettings) => void): () => void {
    const docRef = doc(db, 'geofenceSettings', 'library');
    return onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          callback({
            id: snap.id,
            latitude: Number(data.latitude),
            longitude: Number(data.longitude),
            radiusMeters: Number(data.radiusMeters) || 100,
            enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
            version: data.version || 'v1',
            address: data.address || '',
            updatedAt: data.updatedAt || new Date().toISOString(),
            updatedBy: data.updatedBy || 'Admin',
          });
        } else {
          callback({
            id: 'library',
            latitude: 33.7782,
            longitude: 75.1495,
            radiusMeters: 100,
            enabled: true,
            version: 'v1',
            address: 'Digital Library Campus, Main Block',
            updatedAt: new Date().toISOString(),
            updatedBy: 'Admin',
          });
        }
      },
      (error) => {
        console.warn('Geofence settings snapshot warning:', error);
      }
    );
  },

  /**
   * Checks whether student has performed at least one manual IN for the given dateKey
   */
  async checkFirstManualInDoneToday(studentId: string, dateKey: string): Promise<boolean> {
    await this.ensureAuthReady();
    try {
      const q = query(
        collection(db, 'attendanceEvents'),
        where('studentId', '==', studentId),
        where('dateKey', '==', dateKey),
        where('action', '==', 'IN')
      );
      const snap = await getDocs(q);
      return !snap.empty;
    } catch {
      return false;
    }
  },

  // --------------------------------------------------------------------------
  // NOTIFICATIONS SYSTEM (Features 1, 2, 3, 4, 14, 15)
  // --------------------------------------------------------------------------

  async createNotification(params: {
    recipientType: 'ALL' | 'STUDENT' | 'ADMIN';
    recipientStudentId?: string | null;
    recipientStudentName?: string | null;
    title: string;
    message: string;
    category: NotificationCategory;
    priority?: NotificationPriority;
    createdBy?: string;
    dedupKey?: string;
    metadata?: Record<string, any>;
  }): Promise<NotificationItem> {
    await this.ensureAuthReady();

    if (params.dedupKey) {
      try {
        const q = query(
          collection(db, 'notifications'),
          where('dedupKey', '==', params.dedupKey),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          return snap.docs[0].data() as NotificationItem;
        }
      } catch (err) {
        console.warn('Dedup check query notice:', err);
      }
    }

    const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const nowIso = new Date().toISOString();

    const notifData: NotificationItem = {
      id: notifId,
      recipientType: params.recipientType,
      recipientStudentId: params.recipientStudentId || null,
      recipientStudentName: params.recipientStudentName || null,
      title: params.title,
      message: params.message,
      category: params.category,
      priority: params.priority || 'normal',
      read: false,
      createdAt: nowIso,
      createdBy: params.createdBy || 'System',
      dedupKey: params.dedupKey || '',
      metadata: params.metadata || {},
    };

    try {
      await setDoc(doc(db, 'notifications', notifId), notifData);
    } catch (err) {
      console.warn('Failed to save notification doc:', err);
    }

    return notifData;
  },

  subscribeNotifications(
    studentId: string | null,
    isAdmin: boolean,
    callback: (notifications: NotificationItem[]) => void
  ): () => void {
    const q = query(
      collection(db, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    return onSnapshot(
      q,
      (snap) => {
        let list = snap.docs.map((d) => d.data() as NotificationItem);
        if (isAdmin) {
          list = list.filter(
            (n) =>
              n.recipientType === 'ADMIN' ||
              n.recipientType === 'ALL' ||
              n.category === 'SYSTEM' ||
              n.category === 'MEMBERSHIP' ||
              n.category === 'ATTENDANCE' ||
              n.category === 'STUDENTS'
          );
        } else if (studentId) {
          list = list.filter(
            (n) =>
              n.recipientType === 'ALL' ||
              (n.recipientType === 'STUDENT' && n.recipientStudentId === studentId)
          );
        }
        callback(list);
      },
      (err) => {
        console.warn('Notifications snapshot warning:', err);
      }
    );
  },

  async markNotificationAsRead(id: string): Promise<void> {
    await this.ensureAuthReady();
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      console.warn('Mark notification read notice:', err);
    }
  },

  async markAllNotificationsAsRead(
    recipientType: 'ADMIN' | 'STUDENT',
    studentId?: string
  ): Promise<void> {
    await this.ensureAuthReady();
    try {
      const q = query(
        collection(db, 'notifications'),
        where('read', '==', false),
        limit(100)
      );
      const snap = await getDocs(q);
      const batch = writeBatch(db);
      let count = 0;
      snap.docs.forEach((d) => {
        const data = d.data() as NotificationItem;
        if (recipientType === 'ADMIN') {
          if (
            data.recipientType === 'ADMIN' ||
            data.recipientType === 'ALL' ||
            data.category === 'SYSTEM' ||
            data.category === 'MEMBERSHIP'
          ) {
            batch.update(d.ref, { read: true });
            count++;
          }
        } else if (studentId) {
          if (
            data.recipientType === 'ALL' ||
            (data.recipientType === 'STUDENT' && data.recipientStudentId === studentId)
          ) {
            batch.update(d.ref, { read: true });
            count++;
          }
        }
      });
      if (count > 0) {
        await batch.commit();
      }
    } catch (err) {
      console.warn('Mark all read notice:', err);
    }
  },

  async pruneOldNotifications(): Promise<void> {
    await this.ensureAuthReady();
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const q = query(
        collection(db, 'notifications'),
        where('createdAt', '<', cutoff),
        limit(50)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.warn('Prune old notifications notice:', err);
    }
  },

  // --------------------------------------------------------------------------
  // MEMBERSHIP MONTH COMPLETIONS (Features 5, 19)
  // --------------------------------------------------------------------------

  async checkMembershipMonthCompletions(): Promise<void> {
    await this.ensureAuthReady();
    try {
      const snap = await getDocs(query(collection(db, 'students'), where('active', '==', true)));
      const today = new Date();

      for (const docSnap of snap.docs) {
        const student = docSnap.data();
        const dateOfJoining = student.dateOfJoining || student.createdAt?.split('T')[0];
        if (!dateOfJoining) continue;

        const [y, m, d] = dateOfJoining.split('-').map(Number);
        if (!y || !m || !d) continue;

        let cycleStart = new Date(y, m - 1, d);

        while (true) {
          const cycleEnd = new Date(cycleStart);
          cycleEnd.setMonth(cycleEnd.getMonth() + 1);
          cycleEnd.setDate(cycleEnd.getDate() - 1);

          if (today >= cycleEnd) {
            const startStr = cycleStart.toISOString().split('T')[0];
            const endStr = cycleEnd.toISOString().split('T')[0];
            const dedupKey = `membership_${docSnap.id}_${startStr}_${endStr}`;

            await this.createNotification({
              recipientType: 'ADMIN',
              recipientStudentId: docSnap.id,
              recipientStudentName: student.fullName,
              title: 'Membership Period Completed',
              message: `Membership period completed: ${student.fullName}. Period: ${startStr} → ${endStr}. Please contact student for renewal.`,
              category: 'MEMBERSHIP',
              priority: 'important',
              createdBy: 'System',
              dedupKey,
              metadata: {
                studentId: docSnap.id,
                studentName: student.fullName,
                startDate: startStr,
                endDate: endStr,
              },
            });

            cycleStart = new Date(cycleEnd);
            cycleStart.setDate(cycleStart.getDate() + 1);
            if (cycleStart > today) break;
          } else {
            break;
          }
        }
      }
    } catch (err) {
      console.warn('Membership month completion check notice:', err);
    }
  },

  // --------------------------------------------------------------------------
  // OFFLINE ATTENDANCE SYNC (Features 9, 10, 11, 12, 13)
  // --------------------------------------------------------------------------

  async syncOfflineEvent(event: OfflineAttendanceEvent): Promise<boolean> {
    await this.ensureAuthReady();
    try {
      // 1. Deduplication check
      const q = query(
        collection(db, 'attendanceEvents'),
        where('studentId', '==', event.studentId),
        where('timestamp', '==', event.timestamp),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return true; // Already stored
      }

      // 2. Validate student account
      const stuRef = doc(db, 'students', event.studentId);
      const stuSnap = await getDoc(stuRef);
      if (!stuSnap.exists()) {
        throw new Error(`Student ${event.studentId} does not exist in library database.`);
      }

      // 3. Process action
      if (event.action === 'IN') {
        if (!event.location) {
          throw new Error('Valid GPS location is required to sync entry.');
        }
        await this.startAttendanceSession(
          event.studentId,
          event.studentName,
          event.location,
          event.triggerType,
          event.geofenceVersion,
          event.dwellMinutes
        );
      } else {
        const active = await this.getActiveSession(event.studentId);
        if (active) {
          await this.endAttendanceSession(
            event.studentId,
            active.id,
            event.location,
            event.triggerType,
            event.geofenceVersion
          );
        } else {
          await this.recordAttendance(
            event.studentId,
            event.studentName,
            'OUT',
            event.location,
            event.triggerType,
            event.geofenceVersion
          );
        }
      }

      // 4. Create admin notification
      await this.createNotification({
        recipientType: 'ADMIN',
        title: 'Offline Attendance Synchronized',
        message: `Offline attendance event synchronized for ${event.studentName}: ${event.action} at ${event.timeFormatted}.`,
        category: 'SYSTEM',
        priority: 'normal',
        createdBy: 'System',
        metadata: {
          studentId: event.studentId,
          studentName: event.studentName,
          action: event.action,
          timestamp: event.timestamp,
        },
      });

      return true;
    } catch (err: any) {
      console.error('syncOfflineEvent failed:', err);
      await this.createNotification({
        recipientType: 'ADMIN',
        title: 'Synchronization Requires Review',
        message: `Offline event synchronization failed for ${event.studentName} (${event.action}): ${err?.message || 'Validation error'}.`,
        category: 'SYSTEM',
        priority: 'important',
        createdBy: 'System',
        metadata: {
          studentId: event.studentId,
          studentName: event.studentName,
          error: err?.message,
        },
      }).catch(() => {});
      return false;
    }
  },

  // --------------------------------------------------------------------------
  // DETAILED STUDENT PROFILE (Features 6, 7)
  // --------------------------------------------------------------------------

  async getStudentProfileDetails(studentId: string): Promise<{
    personal: {
      id: string;
      firstName: string;
      lastName: string;
      fullName: string;
      dateOfJoining: string;
      accountStatus: 'active' | 'inactive';
      createdAt: string;
    };
    attendance: {
      totalDays: number;
      currentStatus: 'INSIDE' | 'OUTSIDE';
      totalVisits: number;
      totalMinutesInside: number;
      firstAttendanceDate: string | null;
      latestAttendanceDate: string | null;
    };
    membership: {
      dateOfJoining: string;
      currentPeriodStart: string;
      currentPeriodEnd: string;
      expiryDate: string;
      status: 'ACTIVE' | 'DUE' | 'EXPIRED';
      totalPeriodsCompleted: number;
    };
  }> {
    await this.ensureAuthReady();

    const stuRef = doc(db, 'students', studentId);
    const stuSnap = await getDoc(stuRef);
    if (!stuSnap.exists()) {
      throw new Error('Student profile not found.');
    }

    const stu = stuSnap.data();
    const dateOfJoining = stu.dateOfJoining || stu.createdAt?.split('T')[0] || '2026-09-01';

    // Query all student attendance events for stats
    const evQ = query(
      collection(db, 'attendanceEvents'),
      where('studentId', '==', studentId),
      orderBy('timestamp', 'asc')
    );
    const evSnap = await getDocs(evQ);

    const datesSet = new Set<string>();
    let totalVisits = 0;
    let firstDate: string | null = null;
    let latestDate: string | null = null;

    evSnap.docs.forEach((d) => {
      const e = d.data();
      datesSet.add(e.dateKey);
      if (e.action === 'IN') {
        totalVisits++;
      }
      if (!firstDate) firstDate = e.dateKey;
      latestDate = e.dateKey;
    });

    // Query all student sessions for total minutes inside
    const sessQ = query(
      collection(db, 'attendanceSessions'),
      where('studentId', '==', studentId)
    );
    const sessSnap = await getDocs(sessQ);
    let totalMinutesInside = 0;
    sessSnap.docs.forEach((d) => {
      const s = d.data();
      if (s.totalMinutesInside) {
        totalMinutesInside += Number(s.totalMinutesInside);
      }
    });

    const activeSession = await this.getActiveSession(studentId);
    const currentStatus = activeSession ? 'INSIDE' : 'OUTSIDE';

    // Calculate membership period from dateOfJoining
    const [y, m, d] = dateOfJoining.split('-').map(Number);
    let currentPeriodStart = dateOfJoining;
    let currentPeriodEnd = dateOfJoining;
    let expiryDate = dateOfJoining;
    let status: 'ACTIVE' | 'DUE' | 'EXPIRED' = 'ACTIVE';
    let totalPeriodsCompleted = 0;

    if (y && m && d) {
      const today = new Date();
      let cycleStart = new Date(y, m - 1, d);

      while (true) {
        const cycleEnd = new Date(cycleStart);
        cycleEnd.setMonth(cycleEnd.getMonth() + 1);
        cycleEnd.setDate(cycleEnd.getDate() - 1);

        if (today > cycleEnd) {
          totalPeriodsCompleted++;
          cycleStart = new Date(cycleEnd);
          cycleStart.setDate(cycleStart.getDate() + 1);
        } else {
          currentPeriodStart = cycleStart.toISOString().split('T')[0];
          currentPeriodEnd = cycleEnd.toISOString().split('T')[0];
          expiryDate = currentPeriodEnd;

          // Check if due in next 3 days
          const diffDays = Math.ceil((cycleEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays <= 0) {
            status = 'EXPIRED';
          } else if (diffDays <= 3) {
            status = 'DUE';
          } else {
            status = 'ACTIVE';
          }
          break;
        }
      }
    }

    return {
      personal: {
        id: stuSnap.id,
        firstName: stu.firstName,
        lastName: stu.lastName,
        fullName: stu.fullName,
        dateOfJoining,
        accountStatus: stu.active ? 'active' : 'inactive',
        createdAt: stu.createdAt,
      },
      attendance: {
        totalDays: datesSet.size,
        currentStatus,
        totalVisits,
        totalMinutesInside,
        firstAttendanceDate: firstDate,
        latestAttendanceDate: latestDate,
      },
      membership: {
        dateOfJoining,
        currentPeriodStart,
        currentPeriodEnd,
        expiryDate,
        status,
        totalPeriodsCompleted,
      },
    };
  },
};


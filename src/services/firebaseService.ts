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
  serverTimestamp,
} from 'firebase/firestore';
import {
  signInAnonymously,
  onAuthStateChanged,
  signOut,
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
  // Ensure anonymous auth ready if needed
  async ensureAuthReady() {
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.warn('Anonymous auth sign-in warning:', err);
      }
    }
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
  // STUDENT AUTHENTICATION & SESSION PERSISTENCE (Requirement 7 & 8)
  // --------------------------------------------------------------------------
  getSavedStudentId(): string | null {
    return localStorage.getItem(AUTH_STUDENT_ID_KEY);
  },

  /**
   * Restores authenticated student on website open / page reload.
   * Checks Firestore document to ensure student is still active & not deleted.
   */
  async restoreStudentSession(): Promise<StudentInfo | null> {
    await this.ensureAuthReady();
    const savedId = this.getSavedStudentId();
    if (!savedId) return null;

    try {
      const stuRef = doc(db, 'students', savedId);
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
      };
    } catch (err) {
      console.error('Failed to restore student session:', err);
      return null;
    }
  },

  /**
   * Student Login using First Name + Last Name + Password
   */
  async studentLogin(firstName: string, lastName: string, passwordRaw: string): Promise<StudentInfo> {
    await this.ensureAuthReady();

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

    // Persist student session
    localStorage.setItem(AUTH_STUDENT_ID_KEY, docSnap.id);

    return {
      id: docSnap.id,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: data.fullName,
      status: 'active',
      createdAt: data.createdAt,
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
  // STUDENT STATUS & ATTENDANCE (Requirements 9 & 10)
  // --------------------------------------------------------------------------

  /**
   * Queries Firestore for the student's latest attendance event to determine
   * their true current status ('INSIDE' vs 'OUTSIDE').
   */
  async getStudentCurrentStatus(studentId: string): Promise<{
    status: 'INSIDE' | 'OUTSIDE';
    lastEvent: ActivityEvent | null;
  }> {
    await this.ensureAuthReady();

    try {
      const q = query(
        collection(db, 'attendanceEvents'),
        where('studentId', '==', studentId),
        orderBy('timestamp', 'desc'),
        limit(1)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        return { status: 'OUTSIDE', lastEvent: null };
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

  /**
   * Records an attendance event (IN or OUT) with location capture
   */
  async recordAttendance(
    studentId: string,
    studentName: string,
    requestedAction: 'IN' | 'OUT',
    location?: LocationData | null
  ): Promise<{
    event: ActivityEvent;
    newStatus: 'INSIDE' | 'OUTSIDE';
  }> {
    await this.ensureAuthReady();

    // Verify student is active in Firestore
    const stuRef = doc(db, 'students', studentId);
    const stuSnap = await getDoc(stuRef);
    if (!stuSnap.exists() || !stuSnap.data().active) {
      throw new Error('Your library registration is currently inactive. Please contact the administrator.');
    }

    // Check current status in Firestore to strictly enforce alternating sequence
    const { status: currentStatus } = await this.getStudentCurrentStatus(studentId);
    if (requestedAction === 'IN' && currentStatus === 'INSIDE') {
      throw new Error('Invalid action: You are already marked INSIDE the library.');
    }
    if (requestedAction === 'OUT' && currentStatus === 'OUTSIDE') {
      throw new Error('Invalid action: You are already marked OUTSIDE the library.');
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
      action: requestedAction,
      timestamp,
      timeFormatted: formatLocalTime(timestamp),
      location: eventPayload.location,
    };

    return {
      event,
      newStatus: requestedAction === 'IN' ? 'INSIDE' : 'OUTSIDE',
    };
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

        // Fetch counts and latest action for each student
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
   * Adds a new student into Firestore with duplicate detection
   */
  async addStudent(firstNameRaw: string, lastNameRaw: string, passwordRaw: string): Promise<StudentInfo> {
    await this.ensureAuthReady();

    const { firstName, lastName, fullName, normalizedName } = normalizeStudentName(firstNameRaw, lastNameRaw);

    if (!passwordRaw || passwordRaw.trim().length < 4) {
      throw new Error('Password must be at least 4 characters long.');
    }

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
      createdAt: now,
    };

    try {
      await setDoc(doc(db, 'students', studentId), newStudentDoc);
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
    };
  },

  /**
   * Permanently deletes a student and all associated attendance events from Firestore
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

      // 2. Delete the student document
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

    let unsubEvents: (() => void) | null = null;

    const unsubStudents = onSnapshot(
      studentsQ,
      (studentsSnap) => {
        const allStudents = studentsSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as any[];

        if (unsubEvents) unsubEvents();

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
              const isPresent = hasInAction;

              if (isPresent) {
                presentCount++;
              }

              let dailyStatus: 'INSIDE' | 'OUTSIDE' | 'ABSENT' = 'ABSENT';
              if (isPresent) {
                const lastDayEvent = stuEvents[stuEvents.length - 1];
                dailyStatus = lastDayEvent.action === 'IN' ? 'INSIDE' : 'OUTSIDE';
              }

              // Check latest global action for this student
              let lastAction = null;
              if (stuEvents.length > 0) {
                const lastEvt = stuEvents[stuEvents.length - 1];
                lastAction = {
                  action: lastEvt.action as 'IN' | 'OUT',
                  timestamp: lastEvt.timestamp,
                  timeFormatted: formatLocalTime(lastEvt.timestamp),
                  location: lastEvt.location || null,
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
                  action: ev.action,
                  timestamp: ev.timestamp,
                  timeFormatted: formatLocalTime(ev.timestamp),
                  location: ev.location || null,
                };
              });

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
                totalVisits: visits,
                totalMinutesInside,
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
    };
  },

  /**
   * Fetches full historical attendance across all days for a specific student
   */
  async getStudentFullHistory(studentId: string): Promise<StudentHistoryResponse> {
    await this.ensureAuthReady();

    const stuRef = doc(db, 'students', studentId);
    const stuSnap = await getDoc(stuRef);
    if (!stuSnap.exists()) {
      throw new Error('Student not found.');
    }
    const studentData = stuSnap.data();

    const q = query(
      collection(db, 'attendanceEvents'),
      where('studentId', '==', studentId),
      orderBy('timestamp', 'desc')
    );
    const snap = await getDocs(q);

    const dateGroups: Record<string, ActivityEvent[]> = {};

    snap.docs.forEach((docSnap) => {
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

    const groupedList = Object.keys(dateGroups)
      .sort((a, b) => b.localeCompare(a))
      .map((dateKey) => ({
        dateKey,
        events: dateGroups[dateKey].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
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
};

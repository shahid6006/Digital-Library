import { firebaseService, computeDateKey } from './firebaseService';
import type {
  StudentMeResponse,
  AdminAttendanceReport,
  StudentHistoryResponse,
  StudentInfo,
  RegisteredStudentItem,
  LocationData,
  ActivityEvent,
  AttendanceSession,
  SessionLocationPoint,
  GeofenceSettings,
  NotificationItem,
  NotificationCategory,
  NotificationPriority,
  OfflineAttendanceEvent,
  PendingGeofenceEntry,
} from '../types';

export const api = {
  // Session checks
  getStudentToken(): string | null {
    return firebaseService.getSavedStudentId();
  },

  getAdminToken(): string | null {
    return firebaseService.isAdminLoggedIn() ? 'adm_active' : null;
  },

  async restoreStudentSession(): Promise<StudentInfo | null> {
    return firebaseService.restoreStudentSession();
  },

  // Student endpoints
  async studentLogin(
    firstName: string,
    lastName: string,
    password: string
  ): Promise<{ token: string; student: StudentInfo }> {
    const student = await firebaseService.studentLogin(firstName, lastName, password);
    return {
      token: student.id,
      student,
    };
  },

  async getStudentMe(studentId?: string): Promise<StudentMeResponse> {
    const activeStudentId = studentId || firebaseService.getSavedStudentId();
    if (!activeStudentId) {
      throw new Error('Not logged in. Session expired.');
    }

    const { status, lastEvent, activeSession, pendingDwellEntry } = await firebaseService.getStudentCurrentStatus(activeStudentId);
    const nowIso = new Date().toISOString();
    const dateKey = computeDateKey(nowIso);
    const todayEvents = await firebaseService.getStudentTodayEvents(activeStudentId, dateKey);

    const studentInfo = await firebaseService.restoreStudentSession();
    if (!studentInfo) {
      throw new Error('Student account not found or inactive.');
    }

    let activeRoute: SessionLocationPoint[] = [];
    if (activeSession) {
      try {
        activeRoute = await firebaseService.getSessionLocations(activeSession.id);
      } catch (err) {
        console.warn('Failed to load initial active route:', err);
      }
    }

    let geofenceSettings = null;
    try {
      geofenceSettings = await firebaseService.getGeofenceSettings();
    } catch (err) {
      console.warn('Failed to load geofence settings in getStudentMe:', err);
    }

    return {
      student: studentInfo,
      currentStatus: status,
      activeSession,
      activeRoute,
      lastEvent: lastEvent
        ? {
            action: lastEvent.action,
            timestamp: lastEvent.timestamp,
            timeFormatted: lastEvent.timeFormatted,
            location: lastEvent.location || null,
            triggerType: lastEvent.triggerType || 'MANUAL',
            geofenceVersion: lastEvent.geofenceVersion,
          }
        : null,
      todayEvents,
      serverTime: nowIso,
      geofenceSettings,
      isFirstManualInDoneToday: todayEvents.some((e) => e.action === 'IN'),
      pendingDwellEntry,
    };
  },

  async markAttendance(
    action: 'IN' | 'OUT',
    location?: LocationData | null,
    studentId?: string,
    studentName?: string,
    triggerType: 'MANUAL' | 'GEOFENCE_AUTO' = 'MANUAL',
    geofenceVersion?: string,
    dwellMinutes?: number
  ): Promise<{
    success: boolean;
    message: string;
    currentStatus: 'INSIDE' | 'OUTSIDE';
    session?: AttendanceSession | null;
    event: ActivityEvent;
    todayEvents: ActivityEvent[];
  }> {
    const activeStudentId = studentId || firebaseService.getSavedStudentId();
    if (!activeStudentId) {
      throw new Error('Not logged in. Please log in again.');
    }

    const studentInfo = await firebaseService.restoreStudentSession();
    const name = studentName || studentInfo?.fullName || 'Student';

    let event: ActivityEvent;
    let newStatus: 'INSIDE' | 'OUTSIDE';
    let session: AttendanceSession | null = null;

    if (action === 'IN') {
      if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
        throw new Error('A fresh GPS position is required to mark IN. Please enable location access.');
      }

      const res = await firebaseService.startAttendanceSession(
        activeStudentId,
        name,
        location,
        triggerType,
        geofenceVersion,
        dwellMinutes
      );
      event = res.event;
      session = res.session;
      newStatus = 'INSIDE';
    } else {
      // Action OUT
      const currentActiveSession = await firebaseService.getActiveSession(activeStudentId);
      if (!currentActiveSession) {
        // Fallback to legacy recordAttendance if no active session doc was found
        const res = await firebaseService.recordAttendance(
          activeStudentId,
          name,
          'OUT',
          location,
          triggerType,
          geofenceVersion
        );
        event = res.event;
        newStatus = 'OUTSIDE';
      } else {
        const res = await firebaseService.endAttendanceSession(
          activeStudentId,
          currentActiveSession.id,
          location,
          triggerType,
          geofenceVersion
        );
        event = res.event;
        session = res.session;
        newStatus = 'OUTSIDE';
      }
    }

    const nowIso = new Date().toISOString();
    const dateKey = computeDateKey(nowIso);
    const todayEvents = await firebaseService.getStudentTodayEvents(activeStudentId, dateKey);

    return {
      success: true,
      message: `Successfully marked ${action} at ${event.timeFormatted}${triggerType === 'GEOFENCE_AUTO' ? ' (Automatic Geofence)' : ''}.`,
      currentStatus: newStatus,
      session,
      event,
      todayEvents,
    };
  },

  async recordLocationWaypoint(
    sessionId: string,
    studentId: string,
    location: LocationData,
    sequenceNumber: number
  ): Promise<SessionLocationPoint> {
    return firebaseService.recordSessionLocationPoint(sessionId, studentId, location, sequenceNumber);
  },

  subscribeToSessionRoute(
    sessionId: string,
    callback: (points: SessionLocationPoint[]) => void
  ): () => void {
    return firebaseService.subscribeToSessionRoute(sessionId, callback);
  },

  subscribeToActiveLiveSessions(
    callback: (sessions: AttendanceSession[]) => void
  ): () => void {
    return firebaseService.subscribeToActiveLiveSessions(callback);
  },

  async getSessionLocations(sessionId: string): Promise<SessionLocationPoint[]> {
    return firebaseService.getSessionLocations(sessionId);
  },

  async getStudentSessionsForDate(studentId: string, dateKey: string): Promise<AttendanceSession[]> {
    return firebaseService.getStudentSessionsForDate(studentId, dateKey);
  },

  async studentLogout(): Promise<void> {
    await firebaseService.studentLogout();
  },

  // Admin endpoints
  async adminLogin(code: string): Promise<{ token: string }> {
    firebaseService.adminLogin(code);
    return { token: 'adm_active' };
  },

  async adminLogout(): Promise<void> {
    firebaseService.adminLogout();
  },

  subscribeToDailyAttendance(
    dateKey: string,
    callback: (report: AdminAttendanceReport) => void
  ): () => void {
    return firebaseService.subscribeToDailyAttendance(dateKey, callback);
  },

  subscribeToRegisteredStudents(
    callback: (students: RegisteredStudentItem[]) => void
  ): () => void {
    return firebaseService.subscribeToStudents(callback);
  },

  async getAdminAttendance(dateKey: string): Promise<AdminAttendanceReport> {
    return new Promise((resolve, reject) => {
      const unsub = firebaseService.subscribeToDailyAttendance(
        dateKey,
        (report) => {
          unsub();
          resolve(report);
        }
      );
      setTimeout(() => {
        unsub();
        reject(new Error('Timeout loading attendance report.'));
      }, 8000);
    });
  },

  async getRegisteredStudents(): Promise<{ students: RegisteredStudentItem[] }> {
    return new Promise((resolve, reject) => {
      const unsub = firebaseService.subscribeToStudents((students) => {
        unsub();
        resolve({ students });
      });
      setTimeout(() => {
        unsub();
        reject(new Error('Timeout loading registered students.'));
      }, 8000);
    });
  },

  async registerStudent(
    firstName: string,
    lastName: string,
    password: string,
    dateOfJoining?: string
  ): Promise<{ success: boolean; message: string; student: StudentInfo }> {
    const student = await firebaseService.addStudent(firstName, lastName, password, dateOfJoining);
    return {
      success: true,
      message: `Student "${student.fullName}" added successfully.`,
      student,
    };
  },

  async deleteStudent(
    studentId: string
  ): Promise<{ success: boolean; message: string; deletedStudent: StudentInfo }> {
    await firebaseService.deleteStudent(studentId);
    return {
      success: true,
      message: 'Student and all associated records permanently deleted from Firestore.',
      deletedStudent: { id: studentId, firstName: '', lastName: '', fullName: '' },
    };
  },

  async resetStudentPassword(
    studentId: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string }> {
    await firebaseService.resetStudentPassword(studentId, newPassword);
    return {
      success: true,
      message: 'Student password updated successfully in Firestore.',
    };
  },

  async updateStudentStatus(
    studentId: string,
    status: 'active' | 'inactive'
  ): Promise<{ success: boolean; message: string; student: StudentInfo }> {
    await firebaseService.updateStudentStatus(studentId, status);
    return {
      success: true,
      message: `Student is now ${status}.`,
      student: { id: studentId, firstName: '', lastName: '', fullName: '', status },
    };
  },

  async getStudentHistory(studentId: string): Promise<StudentHistoryResponse> {
    return firebaseService.getStudentFullHistory(studentId);
  },

  // Geofence & Location Settings
  async getGeofenceSettings(): Promise<GeofenceSettings> {
    return firebaseService.getGeofenceSettings();
  },

  async saveGeofenceSettings(settings: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    enabled: boolean;
    address?: string;
  }): Promise<GeofenceSettings> {
    return firebaseService.saveGeofenceSettings(settings);
  },

  subscribeToGeofenceSettings(callback: (settings: GeofenceSettings) => void): () => void {
    return firebaseService.subscribeToGeofenceSettings(callback);
  },

  // Notification Operations
  subscribeNotifications(
    studentId: string | null,
    isAdmin: boolean,
    callback: (notifications: NotificationItem[]) => void
  ): () => void {
    return firebaseService.subscribeNotifications(studentId, isAdmin, callback);
  },

  async sendNotification(params: {
    recipientType: 'ALL' | 'STUDENT' | 'ADMIN';
    recipientStudentId?: string | null;
    recipientStudentName?: string | null;
    title: string;
    message: string;
    category: NotificationCategory;
    priority?: NotificationPriority;
    createdBy?: string;
  }): Promise<NotificationItem> {
    return firebaseService.createNotification(params);
  },

  async markNotificationAsRead(id: string): Promise<void> {
    return firebaseService.markNotificationAsRead(id);
  },

  async markAllNotificationsAsRead(
    recipientType: 'ADMIN' | 'STUDENT',
    studentId?: string
  ): Promise<void> {
    return firebaseService.markAllNotificationsAsRead(recipientType, studentId);
  },

  async checkMembershipMonthCompletions(): Promise<void> {
    return firebaseService.checkMembershipMonthCompletions();
  },

  async syncOfflineEvent(event: OfflineAttendanceEvent): Promise<boolean> {
    return firebaseService.syncOfflineEvent(event);
  },

  async getStudentProfileDetails(studentId: string) {
    return firebaseService.getStudentProfileDetails(studentId);
  },

  // Persistent Geofence Pending Dwell Entry (Requirement 1, 2, 3, 4, 5)
  async getPendingGeofenceEntry(studentId: string): Promise<PendingGeofenceEntry | null> {
    return firebaseService.getPendingGeofenceEntry(studentId);
  },

  async savePendingGeofenceEntry(entry: PendingGeofenceEntry): Promise<void> {
    return firebaseService.savePendingGeofenceEntry(entry);
  },

  async deletePendingGeofenceEntry(studentId: string): Promise<void> {
    return firebaseService.deletePendingGeofenceEntry(studentId);
  },

  subscribeToPendingGeofenceEntry(
    studentId: string,
    callback: (entry: PendingGeofenceEntry | null) => void
  ): () => void {
    return firebaseService.subscribeToPendingGeofenceEntry(studentId, callback);
  },

  subscribeToAllPendingGeofenceEntries(
    callback: (entries: PendingGeofenceEntry[]) => void
  ): () => void {
    return firebaseService.subscribeToAllPendingGeofenceEntries(callback);
  },
};

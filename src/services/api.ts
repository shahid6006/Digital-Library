import { firebaseService, computeDateKey } from './firebaseService';
import type {
  StudentMeResponse,
  AdminAttendanceReport,
  StudentHistoryResponse,
  StudentInfo,
  RegisteredStudentItem,
  LocationData,
  ActivityEvent,
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

    const { status, lastEvent } = await firebaseService.getStudentCurrentStatus(activeStudentId);
    const nowIso = new Date().toISOString();
    const dateKey = computeDateKey(nowIso);
    const todayEvents = await firebaseService.getStudentTodayEvents(activeStudentId, dateKey);

    const studentInfo = await firebaseService.restoreStudentSession();
    if (!studentInfo) {
      throw new Error('Student account not found or inactive.');
    }

    return {
      student: studentInfo,
      currentStatus: status,
      lastEvent: lastEvent
        ? {
            action: lastEvent.action,
            timestamp: lastEvent.timestamp,
            timeFormatted: lastEvent.timeFormatted,
            location: lastEvent.location || null,
          }
        : null,
      todayEvents,
      serverTime: nowIso,
    };
  },

  async markAttendance(
    action: 'IN' | 'OUT',
    location?: LocationData | null,
    studentId?: string,
    studentName?: string
  ): Promise<{
    success: boolean;
    message: string;
    currentStatus: 'INSIDE' | 'OUTSIDE';
    event: ActivityEvent;
    todayEvents: ActivityEvent[];
  }> {
    const activeStudentId = studentId || firebaseService.getSavedStudentId();
    if (!activeStudentId) {
      throw new Error('Not logged in. Please log in again.');
    }

    const studentInfo = await firebaseService.restoreStudentSession();
    const name = studentName || studentInfo?.fullName || 'Student';

    const { event, newStatus } = await firebaseService.recordAttendance(
      activeStudentId,
      name,
      action,
      location
    );

    const nowIso = new Date().toISOString();
    const dateKey = computeDateKey(nowIso);
    const todayEvents = await firebaseService.getStudentTodayEvents(activeStudentId, dateKey);

    return {
      success: true,
      message: `Successfully marked ${action} at ${event.timeFormatted}.`,
      currentStatus: newStatus,
      event,
      todayEvents,
    };
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
      // Timeout guard
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
    password: string
  ): Promise<{ success: boolean; message: string; student: StudentInfo }> {
    const student = await firebaseService.addStudent(firstName, lastName, password);
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
};

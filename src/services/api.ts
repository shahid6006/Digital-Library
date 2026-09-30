import type {
  StudentMeResponse,
  AdminAttendanceReport,
  StudentHistoryResponse,
  StudentInfo,
  RegisteredStudentItem,
  LocationData,
  ActivityEvent,
} from '../types';

const STUDENT_TOKEN_KEY = 'lib_student_token';
const ADMIN_TOKEN_KEY = 'lib_admin_token';
const SAVED_STUDENT_INFO = 'lib_student_info';

function getClientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  headers.set('x-client-timezone', getClientTimezone());

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.error || `Request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export const api = {
  // Session storage helpers
  getStudentToken(): string | null {
    return localStorage.getItem(STUDENT_TOKEN_KEY);
  },
  setStudentToken(token: string, student: StudentInfo): void {
    localStorage.setItem(STUDENT_TOKEN_KEY, token);
    localStorage.setItem(SAVED_STUDENT_INFO, JSON.stringify(student));
  },
  clearStudentSession(): void {
    localStorage.removeItem(STUDENT_TOKEN_KEY);
    localStorage.removeItem(SAVED_STUDENT_INFO);
  },
  getCachedStudent(): StudentInfo | null {
    const raw = localStorage.getItem(SAVED_STUDENT_INFO);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  getAdminToken(): string | null {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  },
  setAdminToken(token: string): void {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  },
  clearAdminSession(): void {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  },

  // Student endpoints
  async studentLogin(firstName: string, lastName: string, password: string): Promise<{ token: string; student: StudentInfo }> {
    const res = await request<{ success: boolean; token: string; student: StudentInfo }>('/api/students/login', {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, password }),
    });
    this.setStudentToken(res.token, res.student);
    return res;
  },

  async getStudentMe(): Promise<StudentMeResponse> {
    const token = this.getStudentToken();
    if (!token) throw new Error('Not logged in');
    return request<StudentMeResponse>('/api/students/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async markAttendance(
    action: 'IN' | 'OUT',
    location?: LocationData | null
  ): Promise<{
    success: boolean;
    message: string;
    currentStatus: 'INSIDE' | 'OUTSIDE';
    event: ActivityEvent;
    todayEvents: ActivityEvent[];
  }> {
    const token = this.getStudentToken();
    if (!token) throw new Error('Not logged in');
    return request('/api/students/me/attendance', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, location }),
    });
  },

  async studentLogout(): Promise<void> {
    const token = this.getStudentToken();
    if (token) {
      try {
        await request('/api/students/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // continue clearing local session
      }
    }
    this.clearStudentSession();
  },

  // Admin endpoints
  async adminLogin(code: string): Promise<{ token: string }> {
    const res = await request<{ success: boolean; token: string }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    this.setAdminToken(res.token);
    return res;
  },

  async getAdminAttendance(dateKey: string, search?: string): Promise<AdminAttendanceReport> {
    const token = this.getAdminToken();
    if (!token) throw new Error('Admin not authenticated');

    const params = new URLSearchParams();
    if (dateKey) params.set('date', dateKey);
    if (search && search.trim()) params.set('search', search.trim());

    return request<AdminAttendanceReport>(`/api/admin/attendance?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async getRegisteredStudents(search?: string): Promise<{ students: RegisteredStudentItem[] }> {
    const token = this.getAdminToken();
    if (!token) throw new Error('Admin not authenticated');

    const params = new URLSearchParams();
    if (search && search.trim()) params.set('search', search.trim());

    return request<{ students: RegisteredStudentItem[] }>(`/api/admin/students?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async registerStudent(firstName: string, lastName: string, password: string): Promise<{ success: boolean; message: string; student: StudentInfo }> {
    const token = this.getAdminToken();
    if (!token) throw new Error('Admin not authenticated');

    return request<{ success: boolean; message: string; student: StudentInfo }>('/api/admin/students', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ firstName, lastName, password }),
    });
  },

  async deleteStudent(studentId: string): Promise<{ success: boolean; message: string; deletedStudent: StudentInfo }> {
    const token = this.getAdminToken();
    if (!token) throw new Error('Admin not authenticated');

    return request<{ success: boolean; message: string; deletedStudent: StudentInfo }>(`/api/admin/students/${studentId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async resetStudentPassword(studentId: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const token = this.getAdminToken();
    if (!token) throw new Error('Admin not authenticated');

    return request<{ success: boolean; message: string }>(`/api/admin/students/${studentId}/reset-password`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newPassword }),
    });
  },

  async updateStudentStatus(studentId: string, status: 'active' | 'inactive'): Promise<{ success: boolean; message: string; student: StudentInfo }> {
    const token = this.getAdminToken();
    if (!token) throw new Error('Admin not authenticated');

    return request<{ success: boolean; message: string; student: StudentInfo }>(`/api/admin/students/${studentId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
  },

  async getStudentHistory(studentId: string): Promise<StudentHistoryResponse> {
    const token = this.getAdminToken();
    if (!token) throw new Error('Admin not authenticated');

    return request<StudentHistoryResponse>(`/api/admin/student/${studentId}/history`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async adminLogout(): Promise<void> {
    const token = this.getAdminToken();
    if (token) {
      try {
        await request('/api/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // continue clearing local session
      }
    }
    this.clearAdminSession();
  },
};

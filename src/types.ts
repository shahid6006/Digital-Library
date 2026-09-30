export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface StudentInfo {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  status?: 'active' | 'inactive';
  createdAt?: string;
}

export interface ActivityEvent {
  id: string;
  action: 'IN' | 'OUT';
  timestamp: string;
  timeFormatted: string;
  location?: LocationData | null;
}

export interface SessionLocationPoint {
  id: string;
  sessionId: string;
  studentId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
  sequenceNumber: number;
}

export interface AttendanceSession {
  id: string;
  studentId: string;
  studentName: string;
  dateKey: string;
  inTimestamp: string;
  outTimestamp?: string | null;
  inLocation?: LocationData | null;
  outLocation?: LocationData | null;
  lastLocation?: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    timestamp: string;
  } | null;
  status: 'INSIDE' | 'OUTSIDE';
  totalMinutesInside?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentMeResponse {
  student: StudentInfo;
  currentStatus: 'INSIDE' | 'OUTSIDE';
  activeSession: AttendanceSession | null;
  activeRoute: SessionLocationPoint[];
  lastEvent: {
    action: 'IN' | 'OUT';
    timestamp: string;
    timeFormatted: string;
    location?: LocationData | null;
  } | null;
  todayEvents: ActivityEvent[];
  serverTime: string;
}

export interface AdminSummary {
  totalRegistered: number;
  presentToday: number;
  absentToday: number;
  currentlyInside: number;
  totalActions: number;
}

export interface StudentDayRow {
  studentId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  studentStatus: 'active' | 'inactive';
  dailyStatus: 'INSIDE' | 'OUTSIDE' | 'ABSENT';
  isPresent: boolean;
  lastAction: {
    action: 'IN' | 'OUT';
    timestamp: string;
    timeFormatted: string;
    location?: LocationData | null;
  } | null;
  events: ActivityEvent[];
  totalVisits: number;
  totalMinutesInside: number;
  activeSessionId?: string | null;
  lastLocation?: LocationData | null;
}

export interface AdminAttendanceReport {
  date: string;
  summary: AdminSummary;
  students: StudentDayRow[];
}

export interface StudentHistoryDayGroup {
  dateKey: string;
  events: ActivityEvent[];
  sessions?: AttendanceSession[];
}

export interface StudentHistoryResponse {
  student: StudentInfo;
  currentStatus: 'INSIDE' | 'OUTSIDE';
  lastAction: {
    action: 'IN' | 'OUT';
    timestamp: string;
    timeFormatted: string;
    location?: LocationData | null;
  } | null;
  history: StudentHistoryDayGroup[];
}

export interface RegisteredStudentItem {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  status: 'active' | 'inactive';
  createdAt: string;
  totalEvents: number;
  lastAction: {
    action: 'IN' | 'OUT';
    timestamp: string;
    location?: LocationData | null;
  } | null;
}

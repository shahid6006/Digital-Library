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
  dateOfJoining?: string; // YYYY-MM-DD
}

export interface ActivityEvent {
  id: string;
  studentId?: string;
  studentName?: string;
  action: 'IN' | 'OUT';
  timestamp: string;
  timeFormatted: string;
  location?: LocationData | null;
  triggerType?: 'MANUAL' | 'GEOFENCE_AUTO';
  geofenceVersion?: string;
  dwellMinutes?: number;
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
  triggerType?: 'MANUAL' | 'GEOFENCE_AUTO';
  geofenceVersion?: string;
  totalMinutesInside?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeofenceSettings {
  id?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
  version?: string;
  address?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface PendingGeofenceEntry {
  studentId: string;
  studentName?: string;
  status: 'WAITING_FOR_DWELL' | 'VERIFIED' | 'CANCELLED';
  dwellStartTimestamp: string;
  requiredDwellSeconds: number; // 60 seconds (1 minute)
  latestLatitude?: number | null;
  latestLongitude?: number | null;
  latestAccuracy?: number | null;
  lastLocationTimestamp?: string;
  geofenceId?: string;
  geofenceVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export type GeofenceStudentState =
  | 'INSIDE'
  | 'OUTSIDE'
  | 'WAITING_FOR_LOCATION'
  | 'WAITING_FOR_DWELL'
  | 'VERIFYING_ENTRY'
  | 'VERIFYING_EXIT'
  | 'SYNC_PENDING';

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
    triggerType?: 'MANUAL' | 'GEOFENCE_AUTO';
    geofenceVersion?: string;
  } | null;
  todayEvents: ActivityEvent[];
  serverTime: string;
  geofenceSettings?: GeofenceSettings | null;
  isFirstManualInDoneToday?: boolean;
  pendingDwellEntry?: PendingGeofenceEntry | null;
}

export interface AdminSummary {
  totalRegistered: number;
  presentToday: number;
  absentToday: number;
  currentlyInside: number;
  totalActions: number;
  geofenceEnabled?: boolean;
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
    triggerType?: 'MANUAL' | 'GEOFENCE_AUTO';
    geofenceVersion?: string;
  } | null;
  events: ActivityEvent[];
  totalVisits: number;
  totalMinutesInside: number;
  activeSessionId?: string | null;
  lastLocation?: LocationData | null;
  geofenceState?: GeofenceStudentState;
}

export interface AdminAttendanceReport {
  date: string;
  summary: AdminSummary;
  students: StudentDayRow[];
  geofenceSettings?: GeofenceSettings | null;
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
  dateOfJoining?: string;
  totalEvents: number;
  lastAction: {
    action: 'IN' | 'OUT';
    timestamp: string;
    location?: LocationData | null;
  } | null;
}

export type NotificationCategory = 'ATTENDANCE' | 'MEMBERSHIP' | 'STUDENTS' | 'SYSTEM';
export type NotificationPriority = 'normal' | 'important';

export interface NotificationItem {
  id: string;
  recipientType: 'ALL' | 'STUDENT' | 'ADMIN';
  recipientStudentId?: string | null;
  recipientStudentName?: string | null;
  title: string;
  message: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  read: boolean;
  createdAt: string;
  createdBy: string;
  dedupKey?: string;
  metadata?: Record<string, any>;
}

export interface MembershipPeriod {
  id: string;
  studentId: string;
  studentName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: 'ACTIVE' | 'DUE' | 'EXPIRED' | 'RENEWED';
  createdAt: string;
  createdBy: string;
}

export interface OfflineAttendanceEvent {
  localId: string;
  studentId: string;
  studentName: string;
  action: 'IN' | 'OUT';
  timestamp: string;
  timeFormatted: string;
  location: LocationData | null;
  geofenceVersion?: string;
  triggerType: 'MANUAL' | 'GEOFENCE_AUTO';
  dwellMinutes?: number;
  status: 'PENDING_SYNC' | 'SYNCED' | 'SYNC_REVIEW_REQUIRED';
  queueCreatedAt: string;
  syncError?: string;
}


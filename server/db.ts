import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Ensure data directory exists (on Vercel serverless, only /tmp is writable)
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = isVercel ? '/tmp' : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create data directory:', err);
  }
}

const DB_PATH = path.join(DATA_DIR, 'library.db');
export const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = ${isVercel ? 'DELETE' : 'WAL'};
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    password_hash TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance_events (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('IN', 'OUT')),
    timestamp TEXT NOT NULL,
    date_key TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS student_sessions (
    token TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS geofence_settings (
    id TEXT PRIMARY KEY,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius_meters REAL NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    version TEXT NOT NULL,
    address TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_students_normalized ON students(normalized_name);
  CREATE INDEX IF NOT EXISTS idx_events_date ON attendance_events(date_key);
  CREATE INDEX IF NOT EXISTS idx_events_student ON attendance_events(student_id);
  CREATE INDEX IF NOT EXISTS idx_events_student_date ON attendance_events(student_id, date_key);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON attendance_events(timestamp);
`);

// Migrations: ensure status, password_hash, location, and geofence columns exist
try {
  const stuInfo = db.prepare('PRAGMA table_info(students)').all() as unknown as Array<{ name: string }>;
  if (!stuInfo.some((col) => col.name === 'status')) {
    db.exec(`ALTER TABLE students ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`);
  }
  if (!stuInfo.some((col) => col.name === 'password_hash')) {
    db.exec(`ALTER TABLE students ADD COLUMN password_hash TEXT;`);
  }

  const evtInfo = db.prepare('PRAGMA table_info(attendance_events)').all() as unknown as Array<{ name: string }>;
  if (!evtInfo.some((col) => col.name === 'latitude')) {
    db.exec(`ALTER TABLE attendance_events ADD COLUMN latitude REAL;`);
  }
  if (!evtInfo.some((col) => col.name === 'longitude')) {
    db.exec(`ALTER TABLE attendance_events ADD COLUMN longitude REAL;`);
  }
  if (!evtInfo.some((col) => col.name === 'accuracy')) {
    db.exec(`ALTER TABLE attendance_events ADD COLUMN accuracy REAL;`);
  }
  if (!evtInfo.some((col) => col.name === 'trigger_type')) {
    db.exec(`ALTER TABLE attendance_events ADD COLUMN trigger_type TEXT DEFAULT 'MANUAL';`);
  }
  if (!evtInfo.some((col) => col.name === 'geofence_version')) {
    db.exec(`ALTER TABLE attendance_events ADD COLUMN geofence_version TEXT;`);
  }
  if (!evtInfo.some((col) => col.name === 'dwell_minutes')) {
    db.exec(`ALTER TABLE attendance_events ADD COLUMN dwell_minutes REAL;`);
  }
} catch {
  // Columns already exist
}

export interface Student {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  normalized_name: string;
  status: 'active' | 'inactive';
  created_at: string;
  password_hash?: string;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface AttendanceEvent {
  id: string;
  student_id: string;
  action: 'IN' | 'OUT';
  timestamp: string;
  date_key: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  location?: LocationData | null;
  trigger_type?: 'MANUAL' | 'GEOFENCE_AUTO';
  geofence_version?: string | null;
  dwell_minutes?: number | null;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  action: 'IN' | 'OUT';
  timestamp: string;
  timeFormatted: string;
  location: LocationData | null;
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
    location: LocationData | null;
  } | null;
  events: ActivityEvent[];
  totalVisits: number;
  totalMinutesInside: number;
}

export interface AdminSummary {
  totalRegistered: number;
  presentToday: number;
  absentToday: number;
  currentlyInside: number;
  totalActions: number;
}

/**
 * Secure password hashing using Node's standard crypto scryptSync with random salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

/**
 * Normalizes student name
 */
export function normalizeStudentName(firstNameRaw: string, lastNameRaw: string) {
  const cleanFirst = (firstNameRaw || '').trim().replace(/\s+/g, ' ');
  const cleanLast = (lastNameRaw || '').trim().replace(/\s+/g, ' ');

  if (!cleanFirst || !cleanLast) {
    throw new Error('Both First Name and Last Name are required.');
  }

  const normalized = `${cleanFirst.toLowerCase()} ${cleanLast.toLowerCase()}`;

  const formatWord = (w: string) =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

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

/**
 * Format timestamp in local 12-hour format e.g. "08:00 AM"
 */
export function formatLocalTime(isoString: string, timeZone?: string): string {
  const d = new Date(isoString);
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timeZone || undefined,
    }).format(d);
  } catch {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
}

/**
 * Calculates dateKey YYYY-MM-DD for a given timestamp in a timezone
 */
export function computeDateKey(isoString: string, timeZone?: string): string {
  const d = new Date(isoString);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timeZone || undefined,
    }).formatToParts(d);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // fallback
  }
  return isoString.split('T')[0];
}

/**
 * Admin registers a new student with password
 */
export function registerStudentByAdmin(
  firstNameRaw: string,
  lastNameRaw: string,
  passwordRaw?: string
): Omit<Student, 'password_hash'> {
  const { firstName, lastName, fullName, normalizedName } = normalizeStudentName(firstNameRaw, lastNameRaw);

  if (!passwordRaw || passwordRaw.trim().length < 4) {
    throw new Error('Password must be at least 4 characters long.');
  }

  const selectStmt = db.prepare('SELECT * FROM students WHERE normalized_name = ?');
  const existing = selectStmt.get(normalizedName) as Student | undefined;

  if (existing) {
    if (existing.status === 'inactive') {
      throw new Error(`Student "${existing.full_name}" is already registered but currently inactive. You can reactivate them from the list.`);
    }
    throw new Error(`Student "${existing.full_name}" is already registered.`);
  }

  const passwordHash = hashPassword(passwordRaw);
  const id = `stu_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO students (id, first_name, last_name, full_name, normalized_name, status, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `);
  insertStmt.run(id, firstName, lastName, fullName, normalizedName, passwordHash, now);

  return {
    id,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    normalized_name: normalizedName,
    status: 'active',
    created_at: now,
  };
}

/**
 * FEATURE 1: Admin permanently deletes a student and all their associated records.
 * Only authenticated Admin can call this!
 */
export function deleteStudentByAdmin(studentId: string): Student {
  const student = getStudentById(studentId);
  if (!student) {
    throw new Error('Student not found.');
  }

  // Delete all attendance events belonging to this student
  db.prepare('DELETE FROM attendance_events WHERE student_id = ?').run(studentId);

  // Delete all authentication sessions for this student
  db.prepare('DELETE FROM student_sessions WHERE student_id = ?').run(studentId);

  // Delete student profile record
  db.prepare('DELETE FROM students WHERE id = ?').run(studentId);

  return student;
}

/**
 * Admin resets / updates student password
 */
export function resetStudentPassword(studentId: string, newPasswordRaw: string): void {
  if (!newPasswordRaw || newPasswordRaw.trim().length < 4) {
    throw new Error('New password must be at least 4 characters long.');
  }

  const student = getStudentById(studentId);
  if (!student) {
    throw new Error('Student not found.');
  }

  const newHash = hashPassword(newPasswordRaw);
  db.prepare('UPDATE students SET password_hash = ? WHERE id = ?').run(newHash, studentId);
  db.prepare('DELETE FROM student_sessions WHERE student_id = ?').run(studentId);
}

/**
 * Admin updates student status (active / inactive)
 */
export function updateStudentStatus(studentId: string, status: 'active' | 'inactive'): Omit<Student, 'password_hash'> {
  const selectStmt = db.prepare('SELECT id, first_name, last_name, full_name, normalized_name, status, created_at FROM students WHERE id = ?');
  const student = selectStmt.get(studentId) as Student | undefined;

  if (!student) {
    throw new Error('Student not found.');
  }

  const updateStmt = db.prepare('UPDATE students SET status = ? WHERE id = ?');
  updateStmt.run(status, studentId);

  if (status === 'inactive') {
    db.prepare('DELETE FROM student_sessions WHERE student_id = ?').run(studentId);
  }

  return {
    ...student,
    status,
  };
}

/**
 * Get all registered students for Admin Student Management
 */
export function getAllRegisteredStudents(searchQuery?: string) {
  let query = 'SELECT id, first_name, last_name, full_name, normalized_name, status, created_at FROM students';
  const params: string[] = [];

  if (searchQuery && searchQuery.trim()) {
    query += ' WHERE LOWER(full_name) LIKE ?';
    params.push(`%${searchQuery.trim().toLowerCase()}%`);
  }

  query += ' ORDER BY full_name ASC';

  const stmt = db.prepare(query);
  const students = (params.length > 0 ? stmt.all(...params) : stmt.all()) as unknown as Student[];

  return students.map((s) => {
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM attendance_events WHERE student_id = ?');
    const res = countStmt.get(s.id) as { count: number };

    const lastEventStmt = db.prepare(`
      SELECT action, timestamp, latitude, longitude, accuracy FROM attendance_events 
      WHERE student_id = ? ORDER BY timestamp DESC LIMIT 1
    `);
    const lastEvent = lastEventStmt.get(s.id) as {
      action: 'IN' | 'OUT';
      timestamp: string;
      latitude?: number | null;
      longitude?: number | null;
      accuracy?: number | null;
    } | undefined;

    return {
      id: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      fullName: s.full_name,
      status: s.status,
      createdAt: s.created_at,
      totalEvents: res?.count || 0,
      lastAction: lastEvent
        ? {
            action: lastEvent.action,
            timestamp: lastEvent.timestamp,
            location:
              lastEvent.latitude != null && lastEvent.longitude != null
                ? {
                    latitude: lastEvent.latitude,
                    longitude: lastEvent.longitude,
                    accuracy: lastEvent.accuracy ?? null,
                  }
                : null,
          }
        : null,
    };
  });
}

/**
 * Student Login with Password Verification
 */
export function verifyAndLoginStudent(
  firstNameRaw: string,
  lastNameRaw: string,
  passwordRaw: string
): { student: Omit<Student, 'password_hash'>; token: string } {
  if (!passwordRaw) {
    throw new Error('Please enter your password.');
  }

  const { normalizedName } = normalizeStudentName(firstNameRaw, lastNameRaw);

  const selectStmt = db.prepare('SELECT * FROM students WHERE normalized_name = ?');
  const student = selectStmt.get(normalizedName) as (Student & { password_hash?: string }) | undefined;

  if (!student) {
    throw new Error('Student account not found. Please contact the administrator.');
  }

  if (student.status === 'inactive') {
    throw new Error('Your library registration is currently inactive. Please contact the administrator.');
  }

  const isMatch = verifyPassword(passwordRaw, student.password_hash);
  if (!isMatch) {
    throw new Error('Incorrect password.');
  }

  const token = createStudentSession(student.id);

  return {
    student: {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      full_name: student.full_name,
      normalized_name: student.normalized_name,
      status: student.status,
      created_at: student.created_at,
    },
    token,
  };
}

export function getStudentById(id: string): Student | null {
  const stmt = db.prepare('SELECT id, first_name, last_name, full_name, normalized_name, status, created_at FROM students WHERE id = ?');
  const student = stmt.get(id) as Student | undefined;
  return student || null;
}

/**
 * Returns overall latest status for student: 'INSIDE' or 'OUTSIDE'
 */
export function getStudentCurrentStatus(studentId: string): {
  status: 'INSIDE' | 'OUTSIDE';
  lastEvent: AttendanceEvent | null;
} {
  const stmt = db.prepare(`
    SELECT * FROM attendance_events 
    WHERE student_id = ? 
    ORDER BY timestamp DESC 
    LIMIT 1
  `);
  const lastEvent = stmt.get(studentId) as AttendanceEvent | undefined;

  if (!lastEvent) {
    return { status: 'OUTSIDE', lastEvent: null };
  }

  return {
    status: lastEvent.action === 'IN' ? 'INSIDE' : 'OUTSIDE',
    lastEvent: {
      ...lastEvent,
      location:
        lastEvent.latitude != null && lastEvent.longitude != null
          ? {
              latitude: lastEvent.latitude,
              longitude: lastEvent.longitude,
              accuracy: lastEvent.accuracy ?? null,
            }
          : null,
    },
  };
}

/**
 * FEATURE 2: Records an attendance event (IN or OUT) with location capture
 */
export function recordAttendance(
  studentId: string,
  requestedAction: 'IN' | 'OUT',
  clientTimezone?: string,
  location?: { latitude: number; longitude: number; accuracy?: number | null } | null,
  options?: {
    triggerType?: 'MANUAL' | 'GEOFENCE_AUTO';
    geofenceVersion?: string;
    dwellMinutes?: number;
    eventId?: string;
  }
): { event: AttendanceEvent; newStatus: 'INSIDE' | 'OUTSIDE'; duplicate?: boolean } {
  const student = getStudentById(studentId);
  if (!student || student.status !== 'active') {
    throw new Error('Your library registration is currently inactive. Please contact the administrator.');
  }

  // Idempotency: Check if this specific eventId was already processed
  const requestedEventId = options?.eventId;
  if (requestedEventId) {
    const existingEvt = db.prepare('SELECT * FROM attendance_events WHERE id = ?').get(requestedEventId) as any;
    if (existingEvt) {
      const { status: curStatus } = getStudentCurrentStatus(studentId);
      return {
        event: {
          id: existingEvt.id,
          student_id: existingEvt.student_id,
          action: existingEvt.action,
          timestamp: existingEvt.timestamp,
          date_key: existingEvt.date_key,
          latitude: existingEvt.latitude,
          longitude: existingEvt.longitude,
          accuracy: existingEvt.accuracy,
          trigger_type: existingEvt.trigger_type || 'MANUAL',
          geofence_version: existingEvt.geofence_version,
          dwell_minutes: existingEvt.dwell_minutes,
          location:
            existingEvt.latitude != null && existingEvt.longitude != null
              ? { latitude: existingEvt.latitude, longitude: existingEvt.longitude, accuracy: existingEvt.accuracy }
              : null,
          created_at: existingEvt.created_at,
        },
        newStatus: curStatus,
        duplicate: true,
      };
    }
  }

  const { status: currentStatus, lastEvent } = getStudentCurrentStatus(studentId);

  // If already in the target status (e.g., duplicate OS geofence trigger)
  const isAlreadyInRequestedStatus =
    (requestedAction === 'IN' && currentStatus === 'INSIDE') ||
    (requestedAction === 'OUT' && currentStatus === 'OUTSIDE');

  if (isAlreadyInRequestedStatus) {
    if (lastEvent) {
      return {
        event: lastEvent,
        newStatus: currentStatus,
        duplicate: true,
      };
    }
    if (requestedAction === 'IN') {
      throw new Error('Invalid action: You are already marked INSIDE the library.');
    } else {
      throw new Error('Invalid action: You are already marked OUTSIDE the library.');
    }
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const dateKey = computeDateKey(timestamp, clientTimezone);
  const id = requestedEventId || `evt_${crypto.randomUUID()}`;
  const triggerType = options?.triggerType || 'MANUAL';
  const geofenceVersion = options?.geofenceVersion || null;
  const dwellMinutes = options?.dwellMinutes != null ? options.dwellMinutes : (triggerType === 'GEOFENCE_AUTO' && requestedAction === 'IN' ? 1 : null);

  const lat = location && typeof location.latitude === 'number' ? location.latitude : null;
  const lng = location && typeof location.longitude === 'number' ? location.longitude : null;
  const acc = location && typeof location.accuracy === 'number' ? location.accuracy : null;

  const insertStmt = db.prepare(`
    INSERT INTO attendance_events (id, student_id, action, timestamp, date_key, latitude, longitude, accuracy, trigger_type, geofence_version, dwell_minutes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(id, studentId, requestedAction, timestamp, dateKey, lat, lng, acc, triggerType, geofenceVersion, dwellMinutes, timestamp);

  const event: AttendanceEvent = {
    id,
    student_id: studentId,
    action: requestedAction,
    timestamp,
    date_key: dateKey,
    latitude: lat,
    longitude: lng,
    accuracy: acc,
    trigger_type: triggerType,
    geofence_version: geofenceVersion,
    dwell_minutes: dwellMinutes,
    location: lat != null && lng != null ? { latitude: lat, longitude: lng, accuracy: acc } : null,
    created_at: timestamp,
  };

  return {
    event,
    newStatus: requestedAction === 'IN' ? 'INSIDE' : 'OUTSIDE',
  };
}

/**
 * Returns today's activity events for a specific student with location
 */
export function getStudentTodayEvents(
  studentId: string,
  dateKey: string,
  timeZone?: string
): ActivityEvent[] {
  const stmt = db.prepare(`
    SELECT * FROM attendance_events
    WHERE student_id = ? AND date_key = ?
    ORDER BY timestamp ASC
  `);
  const rawEvents = stmt.all(studentId, dateKey) as unknown as AttendanceEvent[];

  return rawEvents.map((e) => ({
    id: e.id,
    action: e.action,
    timestamp: e.timestamp,
    timeFormatted: formatLocalTime(e.timestamp, timeZone),
    location:
      e.latitude != null && e.longitude != null
        ? {
            latitude: e.latitude,
            longitude: e.longitude,
            accuracy: e.accuracy ?? null,
          }
        : null,
  }));
}

/**
 * Returns full historical events for a single student across all dates with location
 */
export function getStudentFullHistory(studentId: string, timeZone?: string) {
  const stmt = db.prepare(`
    SELECT * FROM attendance_events
    WHERE student_id = ?
    ORDER BY timestamp DESC
  `);
  const rawEvents = stmt.all(studentId) as unknown as AttendanceEvent[];

  const dateGroups: Record<string, ActivityEvent[]> = {};

  for (const e of rawEvents) {
    if (!dateGroups[e.date_key]) {
      dateGroups[e.date_key] = [];
    }
    dateGroups[e.date_key].push({
      id: e.id,
      action: e.action,
      timestamp: e.timestamp,
      timeFormatted: formatLocalTime(e.timestamp, timeZone),
      location:
        e.latitude != null && e.longitude != null
          ? {
              latitude: e.latitude,
              longitude: e.longitude,
              accuracy: e.accuracy ?? null,
            }
          : null,
    });
  }

  const groupedList = Object.keys(dateGroups)
    .sort((a, b) => b.localeCompare(a))
    .map((dateKey) => ({
      dateKey,
      events: dateGroups[dateKey].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ),
    }));

  return groupedList;
}

/**
 * Admin Daily Student List:
 * Includes location for every event!
 */
export function getAdminAttendanceForDate(
  dateKey: string,
  searchQuery?: string,
  timeZone?: string
): {
  date: string;
  summary: AdminSummary;
  students: StudentDayRow[];
} {
  // 1. Get all registered students
  const studentsStmt = db.prepare(`SELECT id, first_name, last_name, full_name, normalized_name, status, created_at FROM students ORDER BY full_name ASC`);
  const allStudents = studentsStmt.all() as unknown as Student[];

  // 2. Query all events for the given date
  const eventsStmt = db.prepare(`
    SELECT * FROM attendance_events
    WHERE date_key = ?
    ORDER BY timestamp ASC
  `);
  const dateEvents = eventsStmt.all(dateKey) as unknown as AttendanceEvent[];

  // Group events by student
  const eventsByStudent = new Map<string, AttendanceEvent[]>();
  for (const ev of dateEvents) {
    if (!eventsByStudent.has(ev.student_id)) {
      eventsByStudent.set(ev.student_id, []);
    }
    eventsByStudent.get(ev.student_id)!.push(ev);
  }

  // 3. Count currently inside
  let currentlyInsideCount = 0;
  try {
    const latestList = db.prepare(`
      WITH Ranked AS (
        SELECT student_id, action,
               ROW_NUMBER() OVER(PARTITION BY student_id ORDER BY timestamp DESC) as rn
        FROM attendance_events
      )
      SELECT COUNT(*) as count FROM Ranked r
      JOIN students s ON r.student_id = s.id
      WHERE r.rn = 1 AND r.action = 'IN' AND s.status = 'active'
    `).get() as { count: number };
    currentlyInsideCount = Number(latestList?.count || 0);
  } catch {
    // fallback
  }

  let presentCount = 0;
  const studentRows: StudentDayRow[] = [];

  for (const s of allStudents) {
    const stuEvents = eventsByStudent.get(s.id) || [];
    const hasInAction = stuEvents.some((e) => e.action === 'IN');
    const isPresent = hasInAction;

    if (isPresent) {
      presentCount++;
    }

    const { status: currentStatus, lastEvent } = getStudentCurrentStatus(s.id);

    let dailyStatus: 'INSIDE' | 'OUTSIDE' | 'ABSENT' = 'ABSENT';
    if (isPresent) {
      const lastDayEvent = stuEvents[stuEvents.length - 1];
      dailyStatus = lastDayEvent.action === 'IN' ? 'INSIDE' : 'OUTSIDE';
    }

    // Search filter
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      if (!s.full_name.toLowerCase().includes(q)) {
        continue;
      }
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
        timeFormatted: formatLocalTime(ev.timestamp, timeZone),
        location:
          ev.latitude != null && ev.longitude != null
            ? {
                latitude: ev.latitude,
                longitude: ev.longitude,
                accuracy: ev.accuracy ?? null,
              }
            : null,
      };
    });

    if (inTime !== null) {
      const nowMs = Date.now();
      const diffMinutes = Math.max(0, Math.round((nowMs - inTime) / (1000 * 60)));
      totalMinutesInside += diffMinutes;
    }

    const lastAction = lastEvent
      ? {
          action: lastEvent.action,
          timestamp: lastEvent.timestamp,
          timeFormatted: formatLocalTime(lastEvent.timestamp, timeZone),
          location:
            lastEvent.latitude != null && lastEvent.longitude != null
              ? {
                  latitude: lastEvent.latitude,
                  longitude: lastEvent.longitude,
                  accuracy: lastEvent.accuracy ?? null,
                }
              : null,
        }
      : null;

    studentRows.push({
      studentId: s.id,
      firstName: s.first_name,
      lastName: s.last_name,
      fullName: s.full_name,
      studentStatus: s.status,
      dailyStatus,
      isPresent,
      lastAction,
      events: formattedEvents,
      totalVisits: visits,
      totalMinutesInside,
    });
  }

  // Sort rows: Present & Inside first, then Present & Outside, then Absent, alphabetical
  studentRows.sort((a, b) => {
    if (a.dailyStatus === 'INSIDE' && b.dailyStatus !== 'INSIDE') return -1;
    if (b.dailyStatus === 'INSIDE' && a.dailyStatus !== 'INSIDE') return 1;
    if (a.dailyStatus === 'OUTSIDE' && b.dailyStatus === 'ABSENT') return -1;
    if (b.dailyStatus === 'OUTSIDE' && a.dailyStatus === 'ABSENT') return 1;
    return a.fullName.localeCompare(b.fullName);
  });

  const totalRegistered = allStudents.filter((s) => s.status === 'active').length;
  const absentCount = Math.max(0, totalRegistered - presentCount);

  return {
    date: dateKey,
    summary: {
      totalRegistered,
      presentToday: presentCount,
      absentToday: absentCount,
      currentlyInside: currentlyInsideCount,
      totalActions: dateEvents.length,
    },
    students: studentRows,
  };
}

// Session management
export function createStudentSession(studentId: string): string {
  const token = `stu_sess_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO student_sessions (token, student_id, created_at) VALUES (?, ?, ?)').run(
    token,
    studentId,
    now
  );
  return token;
}

export function getStudentFromSession(token: string): Student | null {
  const stmt = db.prepare(`
    SELECT s.id, s.first_name, s.last_name, s.full_name, s.normalized_name, s.status, s.created_at FROM students s
    JOIN student_sessions ss ON ss.student_id = s.id
    WHERE ss.token = ?
  `);
  const student = stmt.get(token) as Student | undefined;
  return student || null;
}

export function deleteStudentSession(token: string): void {
  db.prepare('DELETE FROM student_sessions WHERE token = ?').run(token);
}

export function createAdminSession(): string {
  const token = `adm_sess_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO admin_sessions (token, created_at) VALUES (?, ?)').run(token, now);
  return token;
}

export function validateAdminSession(token: string): boolean {
  if (!token) return false;
  const stmt = db.prepare('SELECT 1 FROM admin_sessions WHERE token = ?');
  const res = stmt.get(token);
  return !!res;
}

export function deleteAdminSession(token: string): void {
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
}

/**
 * Seed initial sample records for demonstration and date-switching testing.
 */
export function seedInitialDataIfNeeded() {
  // Ensure default geofence configuration exists
  try {
    const existing = db.prepare('SELECT id FROM geofence_settings WHERE id = ?').get('library');
    if (!existing) {
      db.prepare(`
        INSERT INTO geofence_settings (id, latitude, longitude, radius_meters, enabled, version, address, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'library',
        33.7782,
        75.1495,
        100,
        1,
        'v1',
        'Digital Library Campus, Main Block',
        new Date().toISOString(),
        'Admin'
      );
    }
  } catch (err) {
    console.error('Error seeding geofence settings:', err);
  }
}

export function getGeofenceSettingsFromDb() {
  const row = db.prepare('SELECT * FROM geofence_settings WHERE id = ?').get('library') as any;
  if (!row) {
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
  return {
    id: row.id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: Number(row.radius_meters),
    enabled: Boolean(row.enabled),
    version: row.version,
    address: row.address || '',
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || 'Admin',
  };
}

export function saveGeofenceSettingsInDb(settings: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
  address?: string;
}) {
  const version = `v_${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO geofence_settings (id, latitude, longitude, radius_meters, enabled, version, address, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      radius_meters = excluded.radius_meters,
      enabled = excluded.enabled,
      version = excluded.version,
      address = excluded.address,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    'library',
    Number(settings.latitude),
    Number(settings.longitude),
    Number(settings.radiusMeters),
    settings.enabled ? 1 : 0,
    version,
    settings.address || 'Digital Library Campus',
    now,
    'Admin'
  );

  return {
    id: 'library',
    latitude: Number(settings.latitude),
    longitude: Number(settings.longitude),
    radiusMeters: Number(settings.radiusMeters),
    enabled: Boolean(settings.enabled),
    version,
    address: settings.address || '',
    updatedAt: now,
    updatedBy: 'Admin',
  };
}


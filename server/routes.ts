import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  verifyAndLoginStudent,
  registerStudentByAdmin,
  resetStudentPassword,
  updateStudentStatus,
  deleteStudentByAdmin,
  getAllRegisteredStudents,
  getStudentById,
  getStudentCurrentStatus,
  recordAttendance,
  getStudentTodayEvents,
  getAdminAttendanceForDate,
  getStudentFullHistory,
  computeDateKey,
  getStudentFromSession,
  deleteStudentSession,
  createAdminSession,
  validateAdminSession,
  deleteAdminSession,
  formatLocalTime,
} from './db.ts';
import { addSSEClient, removeSSEClient, broadcastAttendanceUpdate } from './sse.ts';

const router = Router();

// Middleware: Student authentication
function requireStudentAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Student authorization token required.' });
  }

  const token = authHeader.substring(7).trim();
  const student = getStudentFromSession(token);
  if (!student) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  if (student.status === 'inactive') {
    deleteStudentSession(token);
    return res.status(403).json({ error: 'Your library registration is currently inactive. Please contact the administrator.' });
  }

  (req as any).student = student;
  (req as any).studentToken = token;
  next();
}

// Middleware: Admin authentication
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token.trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Admin authorization token required.' });
  }

  const isValid = validateAdminSession(token);
  if (!isValid) {
    return res.status(401).json({ error: 'Admin session expired or invalid. Please log in again.' });
  }

  (req as any).adminToken = token;
  next();
}

// -------------------------------------------------------------
// STUDENT ROUTES
// -------------------------------------------------------------

/**
 * Student Login with Password Verification
 */
router.post('/students/login', (req: Request, res: Response) => {
  const { firstName, lastName, password } = req.body;

  if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
    return res.status(400).json({ error: 'Please enter your first name.' });
  }

  if (!lastName || typeof lastName !== 'string' || !lastName.trim()) {
    return res.status(400).json({ error: 'Please enter your last name.' });
  }

  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'Please enter your password.' });
  }

  try {
    const { student, token } = verifyAndLoginStudent(firstName, lastName, password);

    return res.json({
      success: true,
      token,
      student: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        fullName: student.full_name,
        status: student.status,
      },
    });
  } catch (err: any) {
    const message = err.message || 'Login failed.';
    let status = 401;
    if (message.includes('not found')) {
      status = 404;
    } else if (message.includes('inactive')) {
      status = 403;
    } else if (message.includes('Incorrect password')) {
      status = 401;
    }
    return res.status(status).json({ error: message });
  }
});

/**
 * Get Authenticated Student Details & Current Status & Today's Activity with Location
 */
router.get('/students/me', requireStudentAuth, (req: Request, res: Response) => {
  const student = (req as any).student;
  const timeZone = (req.headers['x-client-timezone'] as string) || undefined;

  const { status, lastEvent } = getStudentCurrentStatus(student.id);
  const nowIso = new Date().toISOString();
  const dateKey = computeDateKey(nowIso, timeZone);

  const todayEvents = getStudentTodayEvents(student.id, dateKey, timeZone);

  return res.json({
    student: {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      fullName: student.full_name,
      status: student.status,
    },
    currentStatus: status,
    lastEvent: lastEvent
      ? {
          action: lastEvent.action,
          timestamp: lastEvent.timestamp,
          timeFormatted: formatLocalTime(lastEvent.timestamp, timeZone),
          location: lastEvent.location || null,
        }
      : null,
    todayEvents,
    serverTime: nowIso,
  });
});

/**
 * FEATURE 2: Record Attendance (IN / OUT) with Location Capture
 */
router.post('/students/me/attendance', requireStudentAuth, (req: Request, res: Response) => {
  const student = (req as any).student;
  const { action, location } = req.body;
  const timeZone = (req.headers['x-client-timezone'] as string) || undefined;

  if (action !== 'IN' && action !== 'OUT') {
    return res.status(400).json({ error: "Invalid action. Must be 'IN' or 'OUT'." });
  }

  // Validate location if provided
  let validatedLoc: { latitude: number; longitude: number; accuracy?: number | null } | null = null;
  if (location && typeof location === 'object') {
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    const acc = location.accuracy != null ? Number(location.accuracy) : null;
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      validatedLoc = {
        latitude: lat,
        longitude: lng,
        accuracy: acc,
      };
    }
  }

  try {
    const { event, newStatus } = recordAttendance(student.id, action, timeZone, validatedLoc);

    // Broadcast in real-time to admin listeners
    broadcastAttendanceUpdate({
      studentId: student.id,
      studentName: student.full_name,
      action: event.action,
      timestamp: event.timestamp,
      dateKey: event.date_key,
      location: event.location || null,
    });

    const nowIso = new Date().toISOString();
    const dateKey = computeDateKey(nowIso, timeZone);
    const todayEvents = getStudentTodayEvents(student.id, dateKey, timeZone);

    return res.json({
      success: true,
      message: `Attendance marked ${action} successfully.`,
      currentStatus: newStatus,
      event: {
        id: event.id,
        action: event.action,
        timestamp: event.timestamp,
        timeFormatted: formatLocalTime(event.timestamp, timeZone),
        location: event.location || null,
      },
      todayEvents,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Unable to record attendance.' });
  }
});

/**
 * Student Logout
 */
router.post('/students/logout', requireStudentAuth, (req: Request, res: Response) => {
  const token = (req as any).studentToken;
  deleteStudentSession(token);
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// -------------------------------------------------------------
// ADMIN ROUTES
// -------------------------------------------------------------

/**
 * Admin Login
 */
router.post('/admin/login', (req: Request, res: Response) => {
  const { code } = req.body;
  const validCode = (process.env.ADMIN_ACCESS_CODE || 'Retype@77#').trim();
  const submittedCode = typeof code === 'string' ? code.trim() : '';

  if (!submittedCode || submittedCode !== validCode) {
    return res.status(401).json({ error: 'Invalid admin code.' });
  }

  const token = createAdminSession();
  return res.json({
    success: true,
    token,
    message: 'Admin authenticated successfully.',
  });
});

/**
 * Admin Logout
 */
router.post('/admin/logout', requireAdminAuth, (req: Request, res: Response) => {
  const token = (req as any).adminToken;
  deleteAdminSession(token);
  return res.json({ success: true, message: 'Admin logged out successfully.' });
});

/**
 * Admin: Get Registered Students List
 */
router.get('/admin/students', requireAdminAuth, (req: Request, res: Response) => {
  const search = req.query.search as string | undefined;
  try {
    const students = getAllRegisteredStudents(search);
    return res.json({ students });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch registered students.' });
  }
});

/**
 * Admin: Add New Registered Student with Password
 */
router.post('/admin/students', requireAdminAuth, (req: Request, res: Response) => {
  const { firstName, lastName, password } = req.body;

  if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
    return res.status(400).json({ error: 'Please enter student first name.' });
  }
  if (!lastName || typeof lastName !== 'string' || !lastName.trim()) {
    return res.status(400).json({ error: 'Please enter student last name.' });
  }
  if (!password || typeof password !== 'string' || password.trim().length < 4) {
    return res.status(400).json({ error: 'Student password must be at least 4 characters long.' });
  }

  try {
    const newStudent = registerStudentByAdmin(firstName, lastName, password);
    return res.json({
      success: true,
      message: `Student "${newStudent.full_name}" registered successfully.`,
      student: newStudent,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to register student.' });
  }
});

/**
 * FEATURE 1: Admin Permanently Deletes a Student and All Associated Records
 * Protected strictly by requireAdminAuth!
 */
router.delete('/admin/students/:studentId', requireAdminAuth, (req: Request, res: Response) => {
  const { studentId } = req.params;

  try {
    const deletedStudent = deleteStudentByAdmin(studentId);

    // Broadcast SSE update so open Admin Dashboards refresh
    broadcastAttendanceUpdate({
      studentId: deletedStudent.id,
      studentName: deletedStudent.full_name,
      action: 'OUT',
      timestamp: new Date().toISOString(),
      dateKey: 'DELETED',
    });

    return res.json({
      success: true,
      message: `Student "${deletedStudent.full_name}" and all associated attendance records were permanently deleted.`,
      deletedStudent,
    });
  } catch (err: any) {
    return res.status(err.message === 'Student not found.' ? 404 : 500).json({
      error: err.message || 'Failed to delete student.',
    });
  }
});

/**
 * Admin: Reset Student Password
 */
router.post('/admin/students/:studentId/reset-password', requireAdminAuth, (req: Request, res: Response) => {
  const { studentId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
  }

  try {
    resetStudentPassword(studentId, newPassword);
    return res.json({
      success: true,
      message: 'Student password has been reset successfully. Previous password has stopped working.',
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to reset password.' });
  }
});

/**
 * Admin: Deactivate / Reactivate Student
 */
router.patch('/admin/students/:studentId/status', requireAdminAuth, (req: Request, res: Response) => {
  const { studentId } = req.params;
  const { status } = req.body;

  if (status !== 'active' && status !== 'inactive') {
    return res.status(400).json({ error: "Status must be 'active' or 'inactive'." });
  }

  try {
    const updated = updateStudentStatus(studentId, status);
    return res.json({
      success: true,
      message: `Student "${updated.full_name}" is now ${status}.`,
      student: updated,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update student status.' });
  }
});

/**
 * Admin Attendance Dashboard Data (Includes location for all events)
 */
router.get('/admin/attendance', requireAdminAuth, (req: Request, res: Response) => {
  const timeZone = (req.headers['x-client-timezone'] as string) || undefined;
  const rawDate = req.query.date as string | undefined;
  const search = req.query.search as string | undefined;

  const dateKey = rawDate || computeDateKey(new Date().toISOString(), timeZone);

  try {
    const report = getAdminAttendanceForDate(dateKey, search, timeZone);
    return res.json(report);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load attendance report.' });
  }
});

/**
 * Admin: Get individual student full historical attendance log across all days
 */
router.get('/admin/student/:studentId/history', requireAdminAuth, (req: Request, res: Response) => {
  const { studentId } = req.params;
  const timeZone = (req.headers['x-client-timezone'] as string) || undefined;

  const student = getStudentById(studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  const { status, lastEvent } = getStudentCurrentStatus(studentId);
  const history = getStudentFullHistory(studentId, timeZone);

  return res.json({
    student: {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      fullName: student.full_name,
      status: student.status,
      createdAt: student.created_at,
    },
    currentStatus: status,
    lastAction: lastEvent
      ? {
          action: lastEvent.action,
          timestamp: lastEvent.timestamp,
          timeFormatted: formatLocalTime(lastEvent.timestamp, timeZone),
          location: lastEvent.location || null,
        }
      : null,
    history,
  });
});

/**
 * Admin Server-Sent Events (SSE) stream for live real-time updates!
 */
router.get('/admin/events', requireAdminAuth, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const clientId = `admin_sse_${crypto.randomUUID()}`;
  addSSEClient(clientId, res);

  const interval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(interval);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(interval);
    removeSSEClient(clientId);
  });
});

export function setupApiRoutes(app: any) {
  app.use('/api', router);
}

import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { StudentLogin } from './components/StudentLogin';
import { StudentPortal } from './components/StudentPortal';
import { AdminLogin } from './components/AdminLogin';
import { AdminDashboard } from './components/AdminDashboard';
import { api } from './services/api';
import type { StudentInfo } from './types';
import { Library, BookOpen, Clock, ShieldCheck, UserCheck } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'student' | 'admin'>('student');
  const [student, setStudent] = useState<StudentInfo | null>(() => api.getCachedStudent());
  const [studentStatus, setStudentStatus] = useState<'INSIDE' | 'OUTSIDE' | null>(null);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => !!api.getAdminToken());
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Initialize session verification
  useEffect(() => {
    const initSessions = async () => {
      // Check student session
      const studentToken = api.getStudentToken();
      if (studentToken) {
        try {
          const me = await api.getStudentMe();
          setStudent(me.student);
          setStudentStatus(me.currentStatus);
        } catch {
          api.clearStudentSession();
          setStudent(null);
          setStudentStatus(null);
        }
      }

      // Check admin session
      const adminToken = api.getAdminToken();
      if (adminToken) {
        setIsAdminLoggedIn(true);
      }

      setIsInitializing(false);
    };

    initSessions();
  }, []);

  const handleStudentLoginSuccess = (newStudent: StudentInfo) => {
    setStudent(newStudent);
    // StudentPortal will load current status
  };

  const handleStudentLogout = async () => {
    await api.studentLogout();
    setStudent(null);
    setStudentStatus(null);
  };

  const handleAdminLoginSuccess = () => {
    setIsAdminLoggedIn(true);
  };

  const handleAdminLogout = async () => {
    await api.adminLogout();
    setIsAdminLoggedIn(false);
  };

  return (
    <div className="min-h-screen bg-stone-100/70 text-stone-900 flex flex-col font-sans antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Top Header */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        student={student}
        studentStatus={studentStatus}
        isAdminLoggedIn={isAdminLoggedIn}
        onStudentLogout={handleStudentLogout}
        onAdminLogout={handleAdminLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8 max-w-7xl w-full mx-auto">
        {isInitializing ? (
          <div className="py-24 flex flex-col items-center justify-center text-stone-400">
            <div className="w-8 h-8 border-3 border-stone-300 border-t-amber-600 rounded-full animate-spin mb-3" />
            <p className="text-sm">Connecting to Library Terminal...</p>
          </div>
        ) : currentTab === 'student' ? (
          /* Student Terminal Flow */
          student ? (
            <StudentPortal
              student={student}
              onLogout={handleStudentLogout}
              onStatusChange={(status) => setStudentStatus(status)}
            />
          ) : (
            <div className="py-6 sm:py-12">
              <StudentLogin
                onLoginSuccess={handleStudentLoginSuccess}
                onSwitchToAdmin={() => setCurrentTab('admin')}
              />
            </div>
          )
        ) : (
          /* Admin Portal Flow */
          isAdminLoggedIn ? (
            <AdminDashboard onLogout={handleAdminLogout} />
          ) : (
            <div className="py-6 sm:py-12">
              <AdminLogin
                onLoginSuccess={handleAdminLoginSuccess}
                onSwitchToStudent={() => setCurrentTab('student')}
              />
            </div>
          )
        )}
      </main>

      {/* Institutional Footer */}
      <footer className="bg-white border-t border-stone-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-500">
          <div className="flex items-center gap-2">
            <Library className="w-4 h-4 text-stone-400" />
            <span className="font-medium text-stone-700">Central Academic Library Attendance System</span>
            <span className="text-stone-300">·</span>
            <span>Digital Gate Entry Register</span>
          </div>

          <div className="flex items-center gap-4 text-stone-400">
            <span>Server Timestamp Verification</span>
            <span className="text-stone-300">·</span>
            <span>Real-time Live Sync</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

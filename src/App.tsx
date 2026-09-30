import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { StudentLogin } from './components/StudentLogin';
import { StudentPortal } from './components/StudentPortal';
import { AdminLogin } from './components/AdminLogin';
import { AdminDashboard } from './components/AdminDashboard';
import { api } from './services/api';
import type { StudentInfo } from './types';
import { Library, User, Armchair, Instagram } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'student' | 'admin'>('student');
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [studentStatus, setStudentStatus] = useState<'INSIDE' | 'OUTSIDE' | null>(null);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => !!api.getAdminToken());
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Initialize session verification from Firestore on website load
  useEffect(() => {
    let isMounted = true;

    const initSessions = async () => {
      try {
        const restoredStudent = await api.restoreStudentSession();
        if (restoredStudent && isMounted) {
          setStudent(restoredStudent);
          const me = await api.getStudentMe(restoredStudent.id);
          if (isMounted) {
            setStudentStatus(me.currentStatus);
          }
        }
      } catch (err) {
        console.warn('Student session check:', err);
        if (isMounted) {
          setStudent(null);
          setStudentStatus(null);
        }
      }

      if (isMounted) {
        setIsAdminLoggedIn(!!api.getAdminToken());
        setIsInitializing(false);
      }
    };

    initSessions();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleStudentLoginSuccess = async (newStudent: StudentInfo) => {
    setStudent(newStudent);
    try {
      const me = await api.getStudentMe(newStudent.id);
      setStudentStatus(me.currentStatus);
    } catch {
      // Portal will load
    }
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
            <p className="text-sm font-medium">Connecting to Library Database...</p>
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
          /* Admin Terminal Flow */
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

      {/* Footer */}
      <footer className="mt-auto border-t border-stone-200 bg-white py-5 text-center text-xs text-stone-600">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            <div className="flex items-center gap-1.5 font-semibold text-stone-800">
              <Library className="w-4 h-4 text-amber-700" />
              <span>Digital Library</span>
            </div>
            <span className="text-stone-300 hidden sm:inline">&bull;</span>
            <span className="text-stone-500 hidden sm:inline">Attendance &amp; Live Tracking</span>
          </div>

          {/* Shahid Saleem details: Name, Seat #19, and Instagram ID */}
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {/* Student Name */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 border border-stone-200 rounded-full font-semibold text-stone-800 shadow-2xs">
              <User className="w-3.5 h-3.5 text-stone-600" />
              <span>Shahid Saleem</span>
            </div>

            {/* Seat Number with Seat Logo */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-full font-bold shadow-2xs">
              <Armchair className="w-3.5 h-3.5 text-amber-700" />
              <span>Seat 19</span>
            </div>

            {/* Instagram ID with Instagram Logo */}
            <a
              href="https://instagram.com/shahid6_00"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-pink-50 via-purple-50 to-amber-50 hover:from-pink-100 hover:to-amber-100 border border-pink-200 text-pink-700 hover:text-pink-900 rounded-full font-semibold transition-all shadow-2xs group cursor-pointer"
              title="Visit Instagram: @shahid6_00"
            >
              <Instagram className="w-3.5 h-3.5 text-pink-600 group-hover:scale-110 transition-transform" />
              <span>shahid6_00</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

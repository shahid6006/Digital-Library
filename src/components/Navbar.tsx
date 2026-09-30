import { useState, useEffect } from 'react';
import { Library, Shield, User, LogOut, Clock } from 'lucide-react';
import type { StudentInfo } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface NavbarProps {
  currentTab: 'student' | 'admin';
  onSelectTab: (tab: 'student' | 'admin') => void;
  student: StudentInfo | null;
  studentStatus: 'INSIDE' | 'OUTSIDE' | null;
  isAdminLoggedIn: boolean;
  onStudentLogout: () => void;
  onAdminLogout: () => void;
}

export function Navbar({
  currentTab,
  onSelectTab,
  student,
  studentStatus,
  isAdminLoggedIn,
  onStudentLogout,
  onAdminLogout,
}: NavbarProps) {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="bg-stone-900 text-stone-100 border-b border-stone-800 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
              <Library className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Digital Library
              </h1>
              <p className="text-[11px] text-stone-400 hidden sm:block">
                Campus Attendance &amp; Live GPS Tracking
              </p>
            </div>
          </div>

          {/* Right Navigation & Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* PWA Install Button */}
            <PWAInstallButton variant="navbar" />

            {/* Live Clock */}
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-stone-800/80 rounded-md border border-stone-700/60 text-xs font-mono text-stone-300">
              <Clock className="w-3.5 h-3.5 text-stone-400" />
              <span>{currentTime || '00:00:00'}</span>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex items-center p-1 bg-stone-800 rounded-lg border border-stone-700/60">
              <button
                type="button"
                onClick={() => onSelectTab('student')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  currentTab === 'student'
                    ? 'bg-amber-600 text-white shadow-sm font-semibold'
                    : 'text-stone-300 hover:text-white hover:bg-stone-700'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Student</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTab('admin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  currentTab === 'admin'
                    ? 'bg-stone-700 text-white shadow-sm font-semibold ring-1 ring-amber-400/40'
                    : 'text-stone-300 hover:text-white hover:bg-stone-700'
                }`}
              >
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>Admin</span>
              </button>
            </div>

            {/* Student session bar if in student mode */}
            {currentTab === 'student' && student && (
              <div className="flex items-center gap-2 pl-2 border-l border-stone-800">
                <div className="hidden xl:flex flex-col text-right">
                  <span className="text-xs font-medium text-stone-200">{student.fullName}</span>
                  <span className="text-[11px] flex items-center justify-end gap-1 text-stone-400">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        studentStatus === 'INSIDE' ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    {studentStatus === 'INSIDE' ? 'Inside' : 'Outside'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onStudentLogout}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-stone-200 hover:text-white bg-stone-800 hover:bg-stone-700 rounded-lg border border-stone-700 transition-colors cursor-pointer"
                  title="Logout Student"
                >
                  <LogOut className="w-3.5 h-3.5 text-amber-500" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            )}

            {/* Admin session bar if in admin mode */}
            {currentTab === 'admin' && isAdminLoggedIn && (
              <div className="flex items-center gap-2 pl-2 border-l border-stone-800">
                <button
                  type="button"
                  onClick={onAdminLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:text-rose-100 bg-rose-950/40 hover:bg-rose-900/60 rounded-lg border border-rose-800/60 transition-colors cursor-pointer"
                  title="Logout Admin"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

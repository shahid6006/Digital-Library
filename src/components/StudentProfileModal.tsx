import { useState, useEffect } from 'react';
import {
  User,
  X,
  Calendar,
  Clock,
  Award,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Timer,
  Layers,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import type { StudentInfo } from '../types';

interface StudentProfileModalProps {
  student: StudentInfo;
  isOpen: boolean;
  onClose: () => void;
}

export function StudentProfileModal({ student, isOpen, onClose }: StudentProfileModalProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !student.id) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    api
      .getStudentProfileDetails(student.id)
      .then((data) => {
        if (mounted) {
          setProfile(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || 'Unable to load profile.');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, student.id]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-200 bg-amber-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-800 border border-amber-700 flex items-center justify-center text-amber-200 font-bold text-lg">
              {student.firstName[0]}
              {student.lastName[0]}
            </div>
            <div>
              <h3 className="font-bold text-white text-base sm:text-lg">{student.fullName}</h3>
              <p className="text-xs text-amber-200/90 flex items-center gap-1.5 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Student ID: {student.id.substring(0, 14)}...</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-amber-200 hover:text-white hover:bg-amber-800 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 divide-y divide-stone-100">
          {loading ? (
            <div className="py-12 text-center text-stone-500 flex flex-col items-center">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-700 mb-2" />
              <p className="text-xs">Loading student profile...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 text-red-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* Account Overview */}
              <div className="space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Account Status
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-stone-400 block text-[10px]">Status</span>
                    <span className="font-semibold text-emerald-700 flex items-center gap-1 mt-0.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Active Student
                    </span>
                  </div>
                  <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-stone-400 block text-[10px]">Current Presence</span>
                    <span className={`font-semibold mt-0.5 inline-block ${profile?.attendance.currentStatus === 'INSIDE' ? 'text-emerald-700' : 'text-stone-700'}`}>
                      {profile?.attendance.currentStatus === 'INSIDE' ? 'Inside Library' : 'Outside'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Membership Details (Feature 5 & 7) */}
              <div className="pt-4 space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Library Membership Period</span>
                </div>
                <div className="p-3.5 bg-amber-50/60 rounded-xl border border-amber-200/70 space-y-2 text-xs">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-stone-600 font-medium">Date of Joining:</span>
                    <span className="font-bold text-stone-900 bg-white px-2 py-0.5 rounded border border-amber-200">
                      {profile?.membership.dateOfJoining}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-stone-600 font-medium">Current Monthly Period:</span>
                    <span className="font-semibold text-stone-800">
                      {profile?.membership.currentPeriodStart} → {profile?.membership.currentPeriodEnd}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-stone-600 font-medium">Monthly Renewal Due:</span>
                    <span className="font-semibold text-amber-900">
                      {profile?.membership.expiryDate}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-stone-600 font-medium">Membership Status:</span>
                    <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${
                      profile?.membership.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : profile?.membership.status === 'DUE'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {profile?.membership.status === 'ACTIVE'
                        ? 'Active & Good Standing'
                        : profile?.membership.status === 'DUE'
                        ? 'Renewal Due Soon'
                        : 'Period Completed'}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-stone-400 italic">
                  Note: Date of Joining and membership periods are official records managed by the library administration.
                </p>
              </div>

              {/* Attendance Statistics */}
              <div className="pt-4 space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5" />
                  <span>Attendance Statistics</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-xl font-bold text-stone-900 block">
                      {profile?.attendance.totalDays || 0}
                    </span>
                    <span className="text-[10px] text-stone-500 font-medium">Days Attended</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-xl font-bold text-stone-900 block">
                      {profile?.attendance.totalVisits || 0}
                    </span>
                    <span className="text-[10px] text-stone-500 font-medium">Total Entries</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-xl font-bold text-amber-700 block">
                      {Math.round((profile?.attendance.totalMinutesInside || 0) / 60)}h
                    </span>
                    <span className="text-[10px] text-stone-500 font-medium">Hours in Library</span>
                  </div>
                </div>

                <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200/70 text-xs space-y-1 text-stone-600">
                  <div className="flex justify-between">
                    <span>First Attendance:</span>
                    <span className="font-medium text-stone-900">
                      {profile?.attendance.firstAttendanceDate || 'None recorded'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Latest Attendance:</span>
                    <span className="font-medium text-stone-900">
                      {profile?.attendance.latestAttendanceDate || 'None recorded'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-stone-50 border-t border-stone-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 font-semibold rounded-lg text-xs transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

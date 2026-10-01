import { useState, useEffect } from 'react';
import {
  User,
  X,
  Calendar,
  Clock,
  Award,
  KeyRound,
  Trash2,
  UserCheck,
  UserX,
  Send,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../services/api';

interface AdminStudentProfileModalProps {
  studentId: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenMessageComposer?: (studentId: string) => void;
  onStudentUpdated?: () => void;
}

export function AdminStudentProfileModal({
  studentId,
  isOpen,
  onClose,
  onOpenMessageComposer,
  onStudentUpdated,
}: AdminStudentProfileModalProps) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Quick reset password state
  const [showResetPassword, setShowResetPassword] = useState<boolean>(false);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isResetting, setIsResetting] = useState<boolean>(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const loadData = () => {
    setLoading(true);
    setError(null);
    api
      .getStudentProfileDetails(studentId)
      .then((data) => {
        setProfile(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Unable to load student profile.');
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!isOpen || !studentId) return;
    loadData();
  }, [isOpen, studentId]);

  if (!isOpen) return null;

  const handleToggleStatus = async () => {
    if (!profile) return;
    const nextStatus = profile.personal.accountStatus === 'active' ? 'inactive' : 'active';
    try {
      await api.updateStudentStatus(studentId, nextStatus);
      setProfile((prev: any) => ({
        ...prev,
        personal: { ...prev.personal, accountStatus: nextStatus },
      }));
      setFeedback(`Student account marked as ${nextStatus}.`);
      onStudentUpdated?.();
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Failed to update account status.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsResetting(true);
    try {
      await api.resetStudentPassword(studentId, newPassword);
      setFeedback('Student password updated successfully.');
      setShowResetPassword(false);
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await api.deleteStudent(studentId);
      onStudentUpdated?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete student.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-stone-200 bg-amber-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-800 border border-amber-700 flex items-center justify-center text-amber-200 font-bold text-lg">
              {profile?.personal.firstName?.[0] || 'S'}
              {profile?.personal.lastName?.[0] || ''}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base sm:text-lg">
                  {profile?.personal.fullName || 'Student Profile'}
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    profile?.personal.accountStatus === 'active'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-stone-500/20 text-stone-300 border border-stone-500/30'
                  }`}
                >
                  {profile?.personal.accountStatus || 'active'}
                </span>
              </div>
              <p className="text-xs text-amber-200/80 mt-0.5">
                ID: {studentId} • Registered {profile?.personal.createdAt ? new Date(profile.personal.createdAt).toLocaleDateString() : ''}
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
        <div className="p-5 overflow-y-auto space-y-5 flex-1 divide-y divide-stone-100">
          {feedback && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-stone-500 flex flex-col items-center">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-700 mb-2" />
              <p className="text-xs">Loading profile records...</p>
            </div>
          ) : (
            <>
              {/* Section 1: Personal Information */}
              <div className="space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Personal Information
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-stone-400 block text-[10px]">First Name</span>
                    <span className="font-semibold text-stone-900 mt-0.5 block">{profile?.personal.firstName}</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-stone-400 block text-[10px]">Last Name</span>
                    <span className="font-semibold text-stone-900 mt-0.5 block">{profile?.personal.lastName}</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-stone-400 block text-[10px]">Date of Joining</span>
                    <span className="font-bold text-amber-800 mt-0.5 block">{profile?.personal.dateOfJoining}</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-stone-400 block text-[10px]">Security</span>
                    <span className="font-medium text-stone-600 mt-0.5 block">Stored as salted argon/sha256 hash (never plaintext)</span>
                  </div>
                </div>
              </div>

              {/* Section 2: Membership & Monthly Period (Feature 5 & 6) */}
              <div className="pt-4 space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Library Membership Details</span>
                </div>
                <div className="p-3.5 bg-amber-50/70 rounded-xl border border-amber-200/80 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-stone-600 font-medium">Date of Joining:</span>
                    <span className="font-bold text-stone-900 bg-white px-2 py-0.5 rounded border border-amber-200">
                      {profile?.membership.dateOfJoining}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-stone-600 font-medium">Current Monthly Period:</span>
                    <span className="font-semibold text-stone-800">
                      {profile?.membership.currentPeriodStart} → {profile?.membership.currentPeriodEnd}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-stone-600 font-medium">Membership Expiry / Completion Date:</span>
                    <span className="font-bold text-amber-900">
                      {profile?.membership.expiryDate}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-stone-600 font-medium">Membership Status:</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      profile?.membership.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : profile?.membership.status === 'DUE'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {profile?.membership.status === 'ACTIVE'
                        ? 'Active'
                        : profile?.membership.status === 'DUE'
                        ? 'Renewal Due Soon'
                        : 'Period Completed'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-stone-500 pt-1 border-t border-amber-200/50">
                    <span>Total monthly periods completed:</span>
                    <span className="font-semibold text-stone-700">{profile?.membership.totalPeriodsCompleted} months</span>
                  </div>
                </div>
              </div>

              {/* Section 3: Attendance Statistics */}
              <div className="pt-4 space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5" />
                  <span>Attendance Record</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-xl font-bold text-stone-900 block">
                      {profile?.attendance.totalDays || 0}
                    </span>
                    <span className="text-[10px] text-stone-500">Days Attended</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-xl font-bold text-stone-900 block">
                      {profile?.attendance.totalVisits || 0}
                    </span>
                    <span className="text-[10px] text-stone-500">Total IN Visits</span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                    <span className="text-xl font-bold text-amber-700 block">
                      {Math.round((profile?.attendance.totalMinutesInside || 0) / 60)}h
                    </span>
                    <span className="text-[10px] text-stone-500">Total Hours Inside</span>
                  </div>
                </div>

                <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200/70 text-xs space-y-1.5 text-stone-600">
                  <div className="flex justify-between">
                    <span>Current Live Status:</span>
                    <span className={`font-semibold ${profile?.attendance.currentStatus === 'INSIDE' ? 'text-emerald-700' : 'text-stone-700'}`}>
                      {profile?.attendance.currentStatus}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>First Attendance Date:</span>
                    <span className="font-medium text-stone-900">
                      {profile?.attendance.firstAttendanceDate || 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Latest Attendance Date:</span>
                    <span className="font-medium text-stone-900">
                      {profile?.attendance.latestAttendanceDate || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 4: Admin Actions */}
              <div className="pt-4 space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Administrative Actions
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onOpenMessageComposer?.(studentId)}
                    className="p-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold rounded-xl border border-amber-200 flex flex-col items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <Send className="w-4 h-4 text-amber-700" />
                    <span>Send Message</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="p-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold rounded-xl border border-stone-200 flex flex-col items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <KeyRound className="w-4 h-4 text-stone-700" />
                    <span>Reset Password</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleStatus}
                    className={`p-2.5 font-semibold rounded-xl border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                      profile?.personal.accountStatus === 'active'
                        ? 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                    }`}
                  >
                    {profile?.personal.accountStatus === 'active' ? (
                      <>
                        <UserX className="w-4 h-4 text-stone-600" />
                        <span>Deactivate</span>
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-4 h-4 text-emerald-600" />
                        <span>Activate</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-2.5 bg-red-50 hover:bg-red-100 text-red-700 font-semibold rounded-xl border border-red-200 flex flex-col items-center justify-center gap-1 transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                    <span>Delete</span>
                  </button>
                </div>

                {/* Reset Password Sub-Form */}
                {showResetPassword && (
                  <form onSubmit={handleResetPassword} className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3 mt-2 text-xs">
                    <span className="font-semibold text-stone-900 block">Set New Student Password</span>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="password"
                        placeholder="New password (min 4 chars)"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="p-2 rounded-lg border border-stone-300 bg-white"
                      />
                      <input
                        type="password"
                        placeholder="Confirm password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="p-2 rounded-lg border border-stone-300 bg-white"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowResetPassword(false)}
                        className="px-3 py-1 text-stone-600 hover:text-stone-900"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isResetting}
                        className="px-4 py-1.5 bg-amber-700 text-white rounded-lg font-semibold hover:bg-amber-800 disabled:opacity-50"
                      >
                        {isResetting ? 'Saving...' : 'Update Password'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Delete Confirmation */}
                {showDeleteConfirm && (
                  <div className="p-3.5 bg-red-50 rounded-xl border border-red-200 space-y-2 mt-2 text-xs text-red-900">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span>Are you sure you want to permanently delete this student?</span>
                    </div>
                    <p className="text-[11px] text-red-700">
                      All attendance events, sessions, and location tracks will be permanently removed.
                    </p>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-3 py-1.5 bg-white text-stone-700 rounded-lg border border-stone-200 font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="px-4 py-1.5 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-stone-50 border-t border-stone-200 flex justify-end">
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

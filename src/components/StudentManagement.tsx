import { useState, useEffect, useMemo, type FormEvent } from 'react';
import {
  UserPlus,
  Search,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Eye,
  UserCheck,
  UserX,
  KeyRound,
  Trash2,
  AlertTriangle,
  X,
  EyeOff,
} from 'lucide-react';
import { api } from '../services/api';
import type { RegisteredStudentItem } from '../types';
import { StudentHistoryModal } from './StudentHistoryModal';

export function StudentManagement() {
  const [students, setStudents] = useState<RegisteredStudentItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');

  // Add student form state
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showFormPassword, setShowFormPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formFeedback, setFormFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Reset password modal state
  const [resettingStudent, setResettingStudent] = useState<RegisteredStudentItem | null>(null);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>('');
  const [showResetPassword, setShowResetPassword] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetFeedback, setResetFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Delete student confirmation modal state
  const [deletingStudent, setDeletingStudent] = useState<RegisteredStudentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState<string>('');
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);

  // Global action banner
  const [actionSuccessBanner, setActionSuccessBanner] = useState<string | null>(null);

  // History modal state
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState<string | null>(null);

  const loadStudents = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const res = await api.getRegisteredStudents();
      setStudents(res.students);
    } catch (err: any) {
      setError(err.message || 'Unable to load registered students.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, []);

  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault();
    setFormFeedback(null);

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();

    if (!cleanFirst || !cleanLast) {
      setFormFeedback({ type: 'error', message: 'Please enter both First Name and Last Name.' });
      return;
    }

    if (!password) {
      setFormFeedback({ type: 'error', message: 'Please enter a student password.' });
      return;
    }

    if (password.length < 4) {
      setFormFeedback({ type: 'error', message: 'Password must be at least 4 characters.' });
      return;
    }

    if (password !== confirmPassword) {
      setFormFeedback({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.registerStudent(cleanFirst, cleanLast, password);
      setFormFeedback({
        type: 'success',
        message: res.message || `Student "${res.student.fullName}" registered successfully.`,
      });
      setFirstName('');
      setLastName('');
      setPassword('');
      setConfirmPassword('');
      loadStudents(true);
    } catch (err: any) {
      setFormFeedback({
        type: 'error',
        message: err.message || 'Failed to register student.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!resettingStudent) return;
    setResetFeedback(null);

    if (!newPassword) {
      setResetFeedback({ type: 'error', message: 'Please enter a new password.' });
      return;
    }

    if (newPassword.length < 4) {
      setResetFeedback({ type: 'error', message: 'New password must be at least 4 characters.' });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setResetFeedback({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    setIsResetting(true);
    try {
      const res = await api.resetStudentPassword(resettingStudent.id, newPassword);
      setResetFeedback({
        type: 'success',
        message: res.message || 'Password reset successfully.',
      });
      setNewPassword('');
      setConfirmNewPassword('');
      setTimeout(() => {
        setResettingStudent(null);
        setResetFeedback(null);
      }, 1500);
    } catch (err: any) {
      setResetFeedback({
        type: 'error',
        message: err.message || 'Failed to update student password.',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleToggleStatus = async (student: RegisteredStudentItem) => {
    const nextStatus = student.status === 'active' ? 'inactive' : 'active';
    try {
      await api.updateStudentStatus(student.id, nextStatus);
      setStudents((prev) =>
        prev.map((s) => (s.id === student.id ? { ...s, status: nextStatus } : s))
      );
      setActionSuccessBanner(`Student "${student.fullName}" is now ${nextStatus}.`);
      setTimeout(() => setActionSuccessBanner(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Failed to update student status.');
    }
  };

  // FEATURE 1: Permanent Student Deletion
  const handleConfirmDelete = async () => {
    if (!deletingStudent) return;
    setIsDeleting(true);
    setDeleteFeedback(null);

    try {
      await api.deleteStudent(deletingStudent.id);
      // Remove from local list immediately
      setStudents((prev) => prev.filter((s) => s.id !== deletingStudent.id));
      setActionSuccessBanner(
        `Student "${deletingStudent.fullName}" and all associated attendance records were permanently deleted.`
      );
      setDeletingStudent(null);
      setDeleteConfirmationText('');
      setTimeout(() => setActionSuccessBanner(null), 5000);
    } catch (err: any) {
      setDeleteFeedback(err.message || 'Failed to delete student.');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredStudents = useMemo(() => {
    let list = students;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((s) => s.fullName.toLowerCase().includes(q));
    }

    if (statusFilter !== 'ALL') {
      list = list.filter((s) => s.status === statusFilter);
    }

    return list;
  }, [students, searchQuery, statusFilter]);

  const activeCount = students.filter((s) => s.status === 'active').length;
  const inactiveCount = students.filter((s) => s.status === 'inactive').length;

  return (
    <div className="space-y-6">
      {/* Top Header & Add Student trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-semibold tracking-wider text-amber-700 mb-0.5">
            Admin Panel
          </div>
          <h2 className="text-2xl font-bold text-stone-900 tracking-tight">
            STUDENT MANAGEMENT
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Register students, manage credentials, deactivate access, or permanently delete records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadStudents(false)}
            className="p-2 text-stone-600 hover:text-stone-900 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg shadow-2xs transition cursor-pointer"
            title="Refresh directory"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setFormFeedback(null);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 rounded-lg shadow-sm hover:shadow transition cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Add Student</span>
          </button>
        </div>
      </div>

      {/* Global Success Notification */}
      {actionSuccessBanner && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-center gap-2.5 animate-fade-in shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{actionSuccessBanner}</span>
        </div>
      )}

      {/* Add Student Form Card */}
      {showAddForm && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5 sm:p-6 transition animate-fade-in">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-700" />
              <h3 className="text-sm font-bold text-stone-900">
                Register New Student with Password
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-stone-400 hover:text-stone-700 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {formFeedback && (
            <div
              className={`mb-4 p-3 rounded-lg text-xs flex items-start gap-2 ${
                formFeedback.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              {formFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="font-medium">{formFeedback.message}</div>
            </div>
          )}

          <form onSubmit={handleAddStudent} className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="addFirstName"
                  className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1"
                >
                  First Name
                </label>
                <input
                  id="addFirstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="e.g. Shahid"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label
                  htmlFor="addLastName"
                  className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1"
                >
                  Last Name
                </label>
                <input
                  id="addLastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="e.g. Saleem"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="addPassword"
                  className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1"
                >
                  Student Password
                </label>
                <div className="relative">
                  <input
                    id="addPassword"
                    type={showFormPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="e.g. shahid@777"
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition pr-9"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowFormPassword(!showFormPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5 cursor-pointer"
                  >
                    {showFormPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1"
                >
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type={showFormPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Registering...</span>
                  </div>
                ) : (
                  <span>ADD STUDENT</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setFirstName('');
                  setLastName('');
                  setPassword('');
                  setConfirmPassword('');
                }}
                className="px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 transition cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <p className="text-[11px] text-stone-400">
              Passwords are securely hashed using cryptographic salts and are never saved or displayed in plain text.
            </p>
          </form>
        </div>
      )}

      {/* Directory Search & Filter Controls */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search registered students by name..."
            className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 hover:text-stone-700 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg border border-stone-200">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-white text-stone-900 shadow-2xs font-semibold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            All Students ({students.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer flex items-center gap-1 ${
              statusFilter === 'active'
                ? 'bg-white text-emerald-800 shadow-2xs font-semibold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Active ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('inactive')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition cursor-pointer flex items-center gap-1 ${
              statusFilter === 'inactive'
                ? 'bg-white text-stone-800 shadow-2xs font-semibold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-stone-400" />
            Inactive ({inactiveCount})
          </button>
        </div>
      </div>

      {/* Registered Students Table */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-stone-900">
              Registered Students Directory
            </h3>
            <p className="text-xs text-stone-500">
              Manage student accounts, credentials, and records.
            </p>
          </div>
          <div className="text-xs text-stone-500 font-mono">
            Showing {filteredStudents.length} of {students.length} students
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-stone-400 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-stone-500" />
            <p className="text-sm font-medium">Loading student directory...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-700 text-sm font-medium">
            {error}
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="py-16 text-center px-4">
            <p className="text-base font-semibold text-stone-800">
              {searchQuery
                ? `No registered students matching "${searchQuery}".`
                : 'No registered students found.'}
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Click &quot;+ Add Student&quot; above to register students into the library system.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/70 text-[11px] font-semibold uppercase tracking-wider text-stone-600">
                  <th className="py-3.5 px-6">Student Name</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6">Attendance Records</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredStudents.map((student) => {
                  const initials = `${student.firstName[0] || ''}${student.lastName[0] || ''}`.toUpperCase();
                  const isActive = student.status === 'active';

                  return (
                    <tr
                      key={student.id}
                      className="hover:bg-stone-50/80 transition-colors group"
                    >
                      {/* Student info */}
                      <td className="py-4 px-6 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-stone-100 border border-stone-300 flex items-center justify-center text-xs font-bold text-stone-800 shrink-0">
                            {initials}
                          </div>
                          <div>
                            <div className="font-semibold text-stone-900 group-hover:text-amber-800 transition-colors">
                              {student.fullName}
                            </div>
                            <div className="text-[11px] text-stone-400 font-mono">
                              ID: {student.id.substring(0, 10)}...
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-6 align-middle">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-stone-100 text-stone-600 border-stone-300'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isActive ? 'bg-emerald-500' : 'bg-stone-400'
                            }`}
                          />
                          <span>{isActive ? 'Active' : 'Inactive'}</span>
                        </span>
                      </td>

                      {/* Attendance Records count */}
                      <td className="py-4 px-6 align-middle">
                        <div className="text-xs text-stone-700 font-medium">
                          {student.totalEvents} {student.totalEvents === 1 ? 'event' : 'events'} recorded
                        </div>
                        <div className="text-[11px] text-stone-400 mt-0.5">
                          Permanent historical log
                        </div>
                      </td>

                      {/* Action buttons: Reset Password | Deactivate/Activate | Delete */}
                      <td className="py-4 px-6 align-middle text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setResettingStudent(student);
                              setNewPassword('');
                              setConfirmNewPassword('');
                              setResetFeedback(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition cursor-pointer"
                            title="Reset student password"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Reset Password</span>
                          </button>

                          {isActive ? (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(student)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded-md transition cursor-pointer"
                              title="Deactivate student login"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              <span>Deactivate</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(student)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition cursor-pointer"
                              title="Reactivate student login"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Activate</span>
                            </button>
                          )}

                          {/* FEATURE 1: Delete Student Action */}
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingStudent(student);
                              setDeleteFeedback(null);
                              setDeleteConfirmationText('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition cursor-pointer"
                            title="Permanently delete student record and all attendance"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                            <span>Delete</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedStudentForHistory(student.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md transition cursor-pointer"
                            title="View attendance history"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>History</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FEATURE 1: Strong Delete Confirmation Modal */}
      {deletingStudent && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-rose-200 shadow-2xl max-w-md w-full overflow-hidden animate-fade-in">
            <div className="px-6 py-4 border-b border-rose-100 bg-rose-50 flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-base">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <span>Delete Student Record</span>
              </div>
              <button
                type="button"
                onClick={() => setDeletingStudent(null)}
                className="text-rose-400 hover:text-rose-700 p-1 cursor-pointer"
                disabled={isDeleting}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-200/80 text-rose-900 text-sm">
                <p className="font-semibold text-base mb-1">
                  Are you sure you want to permanently delete this student and all associated attendance records?
                </p>
                <p className="text-xs text-rose-700 mt-2 leading-relaxed">
                  Student: <strong className="font-bold text-rose-950">{deletingStudent.fullName}</strong>
                  <br />
                  Total recorded events to be permanently purged:{' '}
                  <strong className="font-bold">{deletingStudent.totalEvents}</strong>
                </p>
              </div>

              {deleteFeedback && (
                <div className="p-3 rounded-lg bg-rose-100 text-rose-800 text-xs font-medium">
                  {deleteFeedback}
                </div>
              )}

              <p className="text-xs text-stone-600 leading-relaxed">
                This action is <strong className="text-rose-700">permanent and irreversible</strong>. It will remove the student from the directory, purge all daily attendance rows, delete all historical logs, and invalidate any login sessions.
              </p>

              <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-xs text-stone-600">
                <span className="font-medium text-stone-700">Safer alternative:</span> If you only want to revoke access without losing attendance logs, click Cancel and use <strong>Deactivate</strong> instead.
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setDeletingStudent(null)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 transition cursor-pointer"
                  disabled={isDeleting}
                >
                  Cancel (Keep Record)
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition disabled:opacity-50 cursor-pointer"
                >
                  {isDeleting ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Deleting...</span>
                    </div>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>Permanently Delete Student</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resettingStudent && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-md w-full overflow-hidden animate-fade-in">
            <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <div className="flex items-center gap-2 text-stone-900 font-bold text-base">
                <KeyRound className="w-5 h-5 text-amber-700" />
                <span>Reset Student Password</span>
              </div>
              <button
                type="button"
                onClick={() => setResettingStudent(null)}
                className="text-stone-400 hover:text-stone-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="p-6 space-y-4">
              <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-xs text-stone-600">
                Student: <span className="font-semibold text-stone-900">{resettingStudent.fullName}</span>
              </div>

              {resetFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                    resetFeedback.type === 'success'
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border border-rose-200 text-rose-800'
                  }`}
                >
                  {resetFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="font-medium">{resetFeedback.message}</div>
                </div>
              )}

              <div>
                <label
                  htmlFor="newPassword"
                  className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1"
                >
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="newPassword"
                    type={showResetPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition pr-9"
                    disabled={isResetting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5 cursor-pointer"
                  >
                    {showResetPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirmNewPassword"
                  className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1"
                >
                  Confirm Password
                </label>
                <input
                  id="confirmNewPassword"
                  type={showResetPassword ? 'text' : 'password'}
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
                  disabled={isResetting}
                />
              </div>

              <p className="text-[11px] text-stone-500">
                After updating, the previous password will stop working immediately and any active sessions will be terminated.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setResettingStudent(null)}
                  className="px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 transition cursor-pointer"
                  disabled={isResetting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {isResetting ? 'Updating...' : 'UPDATE PASSWORD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Historical Student History Modal */}
      {selectedStudentForHistory && (
        <StudentHistoryModal
          studentId={selectedStudentForHistory}
          onClose={() => setSelectedStudentForHistory(null)}
        />
      )}
    </div>
  );
}

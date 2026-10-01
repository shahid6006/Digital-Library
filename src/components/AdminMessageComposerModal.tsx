import { useState, useEffect, type FormEvent } from 'react';
import {
  Send,
  X,
  Users,
  User,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Search,
} from 'lucide-react';
import { api } from '../services/api';
import type { RegisteredStudentItem, NotificationPriority } from '../types';

interface AdminMessageComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  preSelectedStudentId?: string | null;
  onSuccess?: () => void;
}

export function AdminMessageComposerModal({
  isOpen,
  onClose,
  preSelectedStudentId,
  onSuccess,
}: AdminMessageComposerModalProps) {
  const [targetType, setTargetType] = useState<'ONE' | 'MULTIPLE' | 'ALL'>('ALL');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [students, setStudents] = useState<RegisteredStudentItem[]>([]);
  const [title, setTitle] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [priority, setPriority] = useState<NotificationPriority>('normal');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchStudent, setSearchStudent] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;

    api.getRegisteredStudents().then((res) => {
      setStudents(res.students.filter((s) => s.status === 'active'));
    });

    if (preSelectedStudentId) {
      setTargetType('ONE');
      setSelectedStudentId(preSelectedStudentId);
    }
  }, [isOpen, preSelectedStudentId]);

  if (!isOpen) return null;

  const filteredStudents = students.filter((s) =>
    s.fullName.toLowerCase().includes(searchStudent.toLowerCase().trim())
  );

  const toggleStudentSelection = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanTitle = title.trim();
    const cleanMessage = message.trim();

    if (!cleanTitle) {
      setError('Please provide a notification title.');
      return;
    }

    if (!cleanMessage) {
      setError('Please enter a notification message.');
      return;
    }

    if (targetType === 'ONE' && !selectedStudentId) {
      setError('Please select a recipient student.');
      return;
    }

    if (targetType === 'MULTIPLE' && selectedStudentIds.length === 0) {
      setError('Please select at least one student.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (targetType === 'ALL') {
        await api.sendNotification({
          recipientType: 'ALL',
          title: cleanTitle,
          message: cleanMessage,
          category: 'STUDENTS',
          priority,
          createdBy: 'Admin',
        });
      } else if (targetType === 'ONE') {
        const student = students.find((s) => s.id === selectedStudentId);
        await api.sendNotification({
          recipientType: 'STUDENT',
          recipientStudentId: selectedStudentId,
          recipientStudentName: student?.fullName || null,
          title: cleanTitle,
          message: cleanMessage,
          category: 'STUDENTS',
          priority,
          createdBy: 'Admin',
        });
      } else {
        // MULTIPLE
        for (const sid of selectedStudentIds) {
          const student = students.find((s) => s.id === sid);
          await api.sendNotification({
            recipientType: 'STUDENT',
            recipientStudentId: sid,
            recipientStudentName: student?.fullName || null,
            title: cleanTitle,
            message: cleanMessage,
            category: 'STUDENTS',
            priority,
            createdBy: 'Admin',
          });
        }
      }

      setSuccess('Notification sent successfully to selected students.');
      setTitle('');
      setMessage('');
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to dispatch notification.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-stone-200 bg-amber-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-800 flex items-center justify-center text-amber-200">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base">Send Notification</h3>
              <p className="text-xs text-amber-200/80">Message library students directly</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-amber-200 hover:text-white hover:bg-amber-800 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSend} className="p-5 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 bg-red-50 text-red-800 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Recipient Selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-700">Recipient</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetType('ALL')}
                className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition cursor-pointer ${
                  targetType === 'ALL'
                    ? 'bg-amber-50 border-amber-600 text-amber-900'
                    : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                All Students ({students.length})
              </button>
              <button
                type="button"
                onClick={() => setTargetType('ONE')}
                className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition cursor-pointer ${
                  targetType === 'ONE'
                    ? 'bg-amber-50 border-amber-600 text-amber-900'
                    : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                One Student
              </button>
              <button
                type="button"
                onClick={() => setTargetType('MULTIPLE')}
                className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition cursor-pointer ${
                  targetType === 'MULTIPLE'
                    ? 'bg-amber-50 border-amber-600 text-amber-900'
                    : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                Multiple Selected
              </button>
            </div>
          </div>

          {/* Student Picker if ONE */}
          {targetType === 'ONE' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-stone-700">Select Student</label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="w-full text-xs rounded-xl border border-stone-300 p-2.5 bg-white text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">-- Choose student --</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} ({s.dateOfJoining ? `Joined ${s.dateOfJoining}` : 'Active'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Student Picker if MULTIPLE */}
          {targetType === 'MULTIPLE' && (
            <div className="space-y-2 border border-stone-200 rounded-xl p-3 bg-stone-50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-700">
                  Select Students ({selectedStudentIds.length} chosen)
                </span>
                <span className="text-[11px] text-stone-500">
                  Click to add/remove
                </span>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchStudent}
                  onChange={(e) => setSearchStudent(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-1.5 bg-white rounded-lg border border-stone-200 text-stone-900"
                />
              </div>
              <div className="max-h-36 overflow-y-auto divide-y divide-stone-200 border border-stone-200 rounded-lg bg-white">
                {filteredStudents.map((s) => {
                  const isChecked = selectedStudentIds.includes(s.id);
                  return (
                    <div
                      key={s.id}
                      onClick={() => toggleStudentSelection(s.id)}
                      className={`p-2 text-xs flex items-center justify-between cursor-pointer transition ${
                        isChecked ? 'bg-amber-50 text-amber-900 font-semibold' : 'hover:bg-stone-50'
                      }`}
                    >
                      <span>{s.fullName}</span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-700">Title</label>
            <input
              type="text"
              placeholder="e.g. Monthly Membership Renewal Notice"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-xs rounded-xl border border-stone-300 p-2.5 text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-700">Message</label>
            <textarea
              rows={3}
              placeholder="Your library membership month has been completed. Please contact the library administration for renewal."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full text-xs rounded-xl border border-stone-300 p-2.5 text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-700">Priority</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                <input
                  type="radio"
                  name="priority"
                  checked={priority === 'normal'}
                  onChange={() => setPriority('normal')}
                  className="text-amber-600 focus:ring-amber-500"
                />
                <span>Normal</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                <input
                  type="radio"
                  name="priority"
                  checked={priority === 'important'}
                  onChange={() => setPriority('important')}
                  className="text-amber-600 focus:ring-amber-500"
                />
                <span className="font-semibold text-red-600">Important</span>
              </label>
            </div>
          </div>

          {/* Submit */}
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Sending...' : 'Send Notification'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

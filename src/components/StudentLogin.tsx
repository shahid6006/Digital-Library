import { useState, type FormEvent } from 'react';
import { BookOpen, LogIn, AlertCircle, Eye, EyeOff, Shield } from 'lucide-react';
import { api } from '../services/api';
import type { StudentInfo } from '../types';

interface StudentLoginProps {
  onLoginSuccess: (student: StudentInfo) => void;
  onSwitchToAdmin?: () => void;
}

export function StudentLogin({ onLoginSuccess, onSwitchToAdmin }: StudentLoginProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();

    if (!cleanFirst || !cleanLast) {
      setError('Please enter your first and last name.');
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.studentLogin(cleanFirst, cleanLast, password);
      onLoginSuccess(res.student);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please contact the administrator.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 sm:p-8">
        {/* Terminal Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 mb-3">
            <BookOpen className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight">
            Library Attendance
          </h2>
          <p className="text-sm text-stone-600 mt-1">
            Student Digital Register Terminal
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="leading-snug font-medium">{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="firstName"
              className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1.5"
            >
              First Name
            </label>
            <input
              id="firstName"
              type="text"
              required
              autoFocus
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Enter first name"
              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="lastName"
              className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1.5"
            >
              Last Name
            </label>
            <input
              id="lastName"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Enter last name"
              className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition"
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="studentPassword"
              className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="studentPassword"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your student password"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition pr-10"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-stone-900 hover:bg-stone-800 text-white font-medium rounded-lg shadow-sm hover:shadow transition disabled:opacity-50 text-sm cursor-pointer"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying credentials...</span>
                </div>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>LOGIN</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Navigation to Admin Panel */}
        <div className="mt-6 pt-5 border-t border-stone-200 text-center space-y-3">
          <p className="text-xs text-stone-500 leading-relaxed">
            Only students registered by the library administrator with an active account can log in.
          </p>
          {onSwitchToAdmin && (
            <button
              type="button"
              onClick={onSwitchToAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded-lg transition cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5 text-amber-700" />
              <span>Go to Admin Panel</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

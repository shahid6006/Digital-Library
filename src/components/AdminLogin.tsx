import { useState, type FormEvent } from 'react';
import { Shield, Eye, EyeOff, AlertCircle, ArrowLeft } from 'lucide-react';
import { api } from '../services/api';

interface AdminLoginProps {
  onLoginSuccess: () => void;
  onSwitchToStudent?: () => void;
}

export function AdminLogin({ onLoginSuccess, onSwitchToStudent }: AdminLoginProps) {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!code) {
      setError('Please enter the admin access code.');
      return;
    }

    setIsLoading(true);
    try {
      await api.adminLogin(code);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Invalid admin code.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-stone-900 text-stone-100 mb-3 shadow-inner">
            <Shield className="w-6 h-6 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight">
            ADMIN ACCESS
          </h2>
          <p className="text-sm text-stone-600 mt-1">
            Library Administrator Portal
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="leading-snug">{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="adminCode"
              className="block text-xs font-semibold uppercase tracking-wider text-stone-700 mb-1.5"
            >
              Admin Code
            </label>
            <div className="relative">
              <input
                id="adminCode"
                type={showCode ? 'text' : 'password'}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter admin code"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-stone-900 placeholder-stone-400 text-sm focus:outline-none focus:ring-2 focus:ring-stone-800 focus:bg-white transition pr-10"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowCode(!showCode)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
                title={showCode ? 'Hide code' : 'Show code'}
              >
                {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                  <span>Verifying...</span>
                </div>
              ) : (
                <span>ADMIN LOGIN</span>
              )}
            </button>
          </div>
        </form>

        <div className="mt-6 pt-5 border-t border-stone-100 space-y-3">
          <div className="bg-stone-50 rounded-lg p-3 border border-stone-200/80 text-xs text-stone-600">
            <span className="font-semibold text-stone-800">Prototype Credential:</span>
            <div className="mt-1 font-mono text-[11px] text-amber-800 bg-amber-50/80 px-2 py-1 rounded border border-amber-200/60 inline-block">
              Retype@77#
            </div>
            <p className="mt-1.5 text-[11px] text-stone-500">
              Validated on the secure backend server.
            </p>
          </div>

          {onSwitchToStudent && (
            <div className="text-center">
              <button
                type="button"
                onClick={onSwitchToStudent}
                className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800 font-medium transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Student Terminal</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

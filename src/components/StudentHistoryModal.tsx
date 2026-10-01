import { useState, useEffect } from 'react';
import { X, Calendar, RefreshCw, User, MapPin, Armchair } from 'lucide-react';
import { api } from '../services/api';
import type { StudentHistoryResponse, ActivityEvent } from '../types';
import { LocationModal } from './LocationModal';

interface StudentHistoryModalProps {
  studentId: string;
  onClose: () => void;
}

export function StudentHistoryModal({ studentId, onClose }: StudentHistoryModalProps) {
  const [data, setData] = useState<StudentHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Nested Location modal
  const [selectedDayLocation, setSelectedDayLocation] = useState<{
    dateKey: string;
    events: ActivityEvent[];
  } | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchHistory() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.getStudentHistory(studentId);
        if (isMounted) setData(res);
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Unable to load attendance history.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    fetchHistory();
    return () => {
      isMounted = false;
    };
  }, [studentId]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-2xl w-full overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-semibold tracking-wider text-amber-700">
                Attendance History
              </div>
              <h3 className="text-base font-bold text-stone-900 tracking-tight flex items-center gap-2 flex-wrap">
                <span>{data?.student.fullName || 'Student Attendance'}</span>
                {data?.student.seatNumber != null ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-950 border border-amber-300 font-mono">
                    <Armchair className="w-3.5 h-3.5 text-amber-700" />
                    <span>Seat #{data.student.seatNumber}</span>
                  </span>
                ) : (
                  <span className="text-xs text-stone-400 font-normal">Seat: Unassigned</span>
                )}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-stone-400">
              <RefreshCw className="w-6 h-6 animate-spin mb-2" />
              <p className="text-sm">Loading historical records...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
              {error}
            </div>
          ) : data && (
            <>
              {/* Status summary banner */}
              <div className="flex items-center justify-between p-4 bg-stone-50 rounded-xl border border-stone-200">
                <div>
                  <div className="text-xs text-stone-500 uppercase font-semibold">
                    Current Status
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        data.currentStatus === 'INSIDE' ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <span
                      className={`font-bold text-sm ${
                        data.currentStatus === 'INSIDE' ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {data.currentStatus}
                    </span>
                  </div>
                </div>

                {data.lastAction && (
                  <div className="text-right">
                    <div className="text-xs text-stone-500 uppercase font-semibold">
                      Last Action
                    </div>
                    <div className="text-xs font-mono font-medium text-stone-800 mt-0.5">
                      {data.lastAction.action} at {data.lastAction.timeFormatted}
                    </div>
                  </div>
                )}
              </div>

              {/* History Days */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Daily Attendance Breakdown</span>
                </h4>

                {data.history.length === 0 ? (
                  <p className="text-sm text-stone-500 text-center py-6">
                    No historical records found for this student.
                  </p>
                ) : (
                  data.history.map((day) => {
                    const hasLocations = day.events.some((e) => e.location != null);
                    return (
                      <div
                        key={day.dateKey}
                        className="p-4 rounded-xl border border-stone-200 bg-white shadow-2xs space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                          <span className="font-semibold text-sm text-stone-900 font-mono">
                            {day.dateKey}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-stone-500">
                              {day.events.length} actions
                            </span>
                            {hasLocations && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedDayLocation({
                                    dateKey: day.dateKey,
                                    events: day.events,
                                  })
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 cursor-pointer"
                              >
                                <MapPin className="w-3 h-3 text-amber-600" />
                                <span>View Locations</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Event sequence for this day */}
                        <div className="flex flex-wrap items-center gap-2">
                          {day.events.map((evt, idx) => (
                            <div key={evt.id || idx} className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono font-medium border ${
                                  evt.action === 'IN'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-rose-50 text-rose-800 border-rose-200'
                                }`}
                              >
                                {evt.action === 'IN' ? (
                                  <span className="text-emerald-600 font-bold">🟢 IN</span>
                                ) : (
                                  <span className="text-rose-600 font-bold">🔴 OUT</span>
                                )}
                                <span>{evt.timeFormatted}</span>
                                {evt.location && (
                                  <MapPin className="w-3 h-3 text-amber-700 ml-0.5" />
                                )}
                              </span>
                              {idx < day.events.length - 1 && (
                                <span className="text-stone-300 font-bold select-none">→</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-stone-700 bg-white hover:bg-stone-100 border border-stone-300 rounded-lg transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Location Modal if triggered from history */}
      {selectedDayLocation && data && (
        <LocationModal
          studentName={data.student.fullName}
          dateStr={selectedDayLocation.dateKey}
          events={selectedDayLocation.events}
          onClose={() => setSelectedDayLocation(null)}
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import { X, MapPin, ExternalLink, ShieldCheck, Navigation } from 'lucide-react';
import type { ActivityEvent } from '../types';
import { AttendanceLocationMap } from './AttendanceLocationMap';

interface LocationModalProps {
  studentName: string;
  dateStr: string;
  events: ActivityEvent[];
  initialSelectedEventId?: string;
  onClose: () => void;
}

export function LocationModal({
  studentName,
  dateStr,
  events,
  initialSelectedEventId,
  onClose,
}: LocationModalProps) {
  const eventsWithLoc = events.filter((e) => e.location != null);
  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialSelectedEventId || (eventsWithLoc.length > 0 ? eventsWithLoc[0].id : events[0]?.id || '')
  );

  const selectedEvent = events.find((e) => e.id === selectedEventId) || events[0];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-2xl max-w-5xl w-full overflow-hidden animate-fade-in flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-semibold tracking-wider text-amber-700">
                Attendance GPS Map
              </div>
              <h3 className="text-base font-bold text-stone-900 tracking-tight flex items-center gap-2">
                <span>{studentName}</span>
                <span className="text-xs font-normal text-stone-500 font-mono">
                  &bull; {dateStr}
                </span>
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Events Timeline */}
          <div className="lg:col-span-5 space-y-3">
            <div className="text-xs font-semibold text-stone-700 uppercase tracking-wider flex items-center justify-between">
              <span>Today&apos;s Activity ({events.length})</span>
              <span className="text-[11px] font-normal text-stone-500 font-mono">
                {eventsWithLoc.length} with GPS
              </span>
            </div>

            {events.length === 0 ? (
              <div className="p-8 text-center text-xs text-stone-400 border border-dashed border-stone-200 rounded-xl">
                No attendance events recorded for this date.
              </div>
            ) : (
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {events.map((evt, idx) => {
                  const isSelected = evt.id === selectedEventId;
                  const hasLoc = evt.location != null;
                  const isLatest = idx === events.length - 1;

                  return (
                    <div
                      key={evt.id || idx}
                      onClick={() => setSelectedEventId(evt.id)}
                      className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                        isSelected
                          ? 'bg-amber-50/80 border-amber-400 shadow-xs ring-1 ring-amber-400/50'
                          : 'bg-white hover:bg-stone-50 border-stone-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold ${
                              evt.action === 'IN'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            <span>{evt.action === 'IN' ? '🟢 IN' : '🔴 OUT'}</span>
                          </span>
                          <span className="text-xs font-mono font-semibold text-stone-800">
                            {evt.timeFormatted}
                          </span>
                        </div>

                        {hasLoc ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <Navigation className="w-3 h-3 text-emerald-600" />
                            <span>GPS Captured</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-stone-400 italic">
                            Location not available
                          </span>
                        )}
                      </div>

                      {isLatest && hasLoc && (
                        <div className="mt-1 text-[10px] uppercase font-bold tracking-wider text-amber-700">
                          Last recorded location
                        </div>
                      )}

                      {hasLoc ? (
                        <div className="mt-2 text-[11px] text-stone-600 space-y-0.5 font-mono">
                          <div>
                            GPS location &mdash; accuracy &plusmn;{Math.round(evt.location!.accuracy || 10)} meters
                          </div>
                          <div className="text-[10px] text-stone-400">
                            Lat: {evt.location!.latitude.toFixed(6)}, Lng: {evt.location!.longitude.toFixed(6)}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1.5 text-[11px] text-stone-400">
                          Location not available for this record
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Reusable AttendanceLocationMap */}
          <div className="lg:col-span-7 flex flex-col space-y-3">
            {selectedEvent && (
              <div className="flex items-center justify-between bg-stone-50 p-3 rounded-xl border border-stone-200 text-xs">
                <div>
                  <span className="text-stone-500">Selected Event:</span>{' '}
                  <span className="font-bold text-stone-900">
                    {selectedEvent.action === 'IN' ? '🟢 IN' : '🔴 OUT'} &bull;{' '}
                    {selectedEvent.timeFormatted}
                  </span>
                  {selectedEvent.location && (
                    <span className="text-stone-500 ml-2 font-mono text-[11px]">
                      (accuracy &plusmn;{Math.round(selectedEvent.location.accuracy || 10)}m)
                    </span>
                  )}
                </div>
                {selectedEvent.location && (
                  <a
                    href={`https://www.google.com/maps?q=${selectedEvent.location.latitude},${selectedEvent.location.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 font-medium"
                  >
                    <span>Google Maps</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}

            <AttendanceLocationMap
              events={events}
              selectedEventId={selectedEventId}
              onSelectEvent={(id) => setSelectedEventId(id)}
              studentName={studentName}
              className="h-[340px] sm:h-[420px] lg:h-[460px]"
              showPolyline={true}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Event-based location capture &bull; Fresh GPS obtained on each IN/OUT</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg transition font-medium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

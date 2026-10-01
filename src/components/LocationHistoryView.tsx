import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  User,
  MapPin,
  RefreshCw,
  Navigation,
  Clock,
  Radio,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../services/api';
import type {
  RegisteredStudentItem,
  AttendanceSession,
  SessionLocationPoint,
  ActivityEvent,
} from '../types';

function getTodayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function offsetDateKey(dateKey: string, offsetDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateKey: string): string {
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateKey;
  }
}

export function LocationHistoryView() {
  const [students, setStudents] = useState<RegisteredStudentItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateKey());
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [sessionPoints, setSessionPoints] = useState<SessionLocationPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingPoints, setIsLoadingPoints] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Map references
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // 1. Subscribe to registered students list
  useEffect(() => {
    const unsub = api.subscribeToRegisteredStudents((stuList) => {
      setStudents(stuList);
      if (stuList.length > 0 && !selectedStudentId) {
        setSelectedStudentId(stuList[0].id);
      }
    });
    return () => unsub();
  }, [selectedStudentId]);

  // 2. Load attendance sessions for selected student and date
  const loadSessionsForDate = async () => {
    if (!selectedStudentId) {
      setSessions([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const sessList = await api.getStudentSessionsForDate(selectedStudentId, selectedDate);
      setSessions(sessList);
      if (sessList.length > 0) {
        setSelectedSessionId(sessList[0].id);
      } else {
        setSelectedSessionId('');
        setSessionPoints([]);
      }
    } catch (err: any) {
      setError(err.message || 'Unable to load attendance sessions for this date.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessionsForDate();
  }, [selectedStudentId, selectedDate]);

  // 3. Load location points for selected session
  useEffect(() => {
    if (!selectedSessionId) {
      setSessionPoints([]);
      return;
    }
    let isMounted = true;
    setIsLoadingPoints(true);

    api
      .getSessionLocations(selectedSessionId)
      .then((pts) => {
        if (isMounted) {
          setSessionPoints(pts);
          setIsLoadingPoints(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to load session points:', err);
        if (isMounted) setIsLoadingPoints(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedSessionId]);

  // 4. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const defaultCenter: L.LatLngExpression = [34.0522, -118.2437];
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView(defaultCenter, 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 5. Render historical route on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const selectedSession = sessions.find((s) => s.id === selectedSessionId);
    if (!selectedSession && sessionPoints.length === 0) return;

    const bounds = L.latLngBounds([]);

    // Collect valid coordinates
    const coordinates: [number, number][] = [];

    // Add IN location if available
    if (selectedSession?.inLocation) {
      coordinates.push([
        selectedSession.inLocation.latitude,
        selectedSession.inLocation.longitude,
      ]);
    }

    // Add waypoints
    sessionPoints.forEach((p) => {
      coordinates.push([p.latitude, p.longitude]);
    });

    // Add OUT location if available
    if (selectedSession?.outLocation) {
      coordinates.push([
        selectedSession.outLocation.latitude,
        selectedSession.outLocation.longitude,
      ]);
    }

    if (coordinates.length === 0) return;

    coordinates.forEach((c) => bounds.extend(c));

    // Draw route polyline
    L.polyline(coordinates, {
      color: '#b45309', // amber-700
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(layerGroup);

    // IN Marker (Green Pin)
    const inCoord = coordinates[0];
    const inIcon = L.divIcon({
      className: 'custom-in-marker',
      html: `
        <div style="background: #059669; color: white; font-size: 11px; font-weight: 800; padding: 4px 8px; border-radius: 9999px; border: 2px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
          <span>IN</span>
        </div>
      `,
      iconSize: [40, 24],
      iconAnchor: [20, 12],
    });
    L.marker(inCoord, { icon: inIcon })
      .addTo(layerGroup)
      .bindPopup(
        `<strong>IN (Session Start)</strong><br/>Time: ${new Date(
          selectedSession?.inTimestamp || ''
        ).toLocaleTimeString()}`
      );

    // OUT Marker (Red Pin if finished)
    if (selectedSession?.status === 'OUTSIDE' && coordinates.length > 1) {
      const outCoord = coordinates[coordinates.length - 1];
      const outIcon = L.divIcon({
        className: 'custom-out-marker',
        html: `
          <div style="background: #e11d48; color: white; font-size: 11px; font-weight: 800; padding: 4px 8px; border-radius: 9999px; border: 2px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
            <span>OUT</span>
          </div>
        `,
        iconSize: [48, 24],
        iconAnchor: [24, 12],
      });
      L.marker(outCoord, { icon: outIcon })
        .addTo(layerGroup)
        .bindPopup(
          `<strong>OUT (Session End)</strong><br/>Time: ${
            selectedSession?.outTimestamp
              ? new Date(selectedSession.outTimestamp).toLocaleTimeString()
              : 'N/A'
          }`
        );
    }

    // Intermediate waypoints dots
    sessionPoints.forEach((p, idx) => {
      L.circleMarker([p.latitude, p.longitude], {
        radius: 4,
        fillColor: '#f59e0b',
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9,
      })
        .addTo(layerGroup)
        .bindPopup(
          `Waypoint #${idx + 1}<br/>Time: ${new Date(
            p.timestamp
          ).toLocaleTimeString()}<br/>Accuracy: &plusmn;${Math.round(p.accuracy || 10)}m`
        );
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
    }
  }, [sessions, selectedSessionId, sessionPoints]);

  const selectedStudent = students.find((s) => s.id === selectedStudentId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const isToday = selectedDate === getTodayDateKey();

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-bold tracking-wider text-amber-700 mb-0.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            <span>Historical Records</span>
          </div>
          <h2 className="text-2xl font-black text-stone-900 tracking-tight flex items-center gap-2">
            <span>Historical Session &amp; Route Inspector</span>
          </h2>
          <p className="text-xs text-stone-600 mt-0.5">
            Inspect every independent IN-to-OUT attendance session, chronological route polyline, and
            GPS coordinates.
          </p>
        </div>

        <button
          type="button"
          onClick={loadSessionsForDate}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg shadow-2xs transition cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Selectors Toolbar (Student + Date) */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Student Selector */}
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-800 flex items-center justify-center border border-amber-200 shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <label
              htmlFor="historyStudentSelect"
              className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1"
            >
              Select Student
            </label>
            <select
              id="historyStudentSelect"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-xs font-semibold text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
            >
              {students.length === 0 ? (
                <option value="">No registered students found</option>
              ) : (
                [...students]
                  .sort((a, b) => {
                    const seatA = typeof a.seatNumber === 'number' && !isNaN(a.seatNumber) ? a.seatNumber : 999999;
                    const seatB = typeof b.seatNumber === 'number' && !isNaN(b.seatNumber) ? b.seatNumber : 999999;
                    if (seatA !== seatB) return seatA - seatB;
                    return a.fullName.localeCompare(b.fullName);
                  })
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.seatNumber != null ? `Seat #${s.seatNumber} • ` : ''}{s.fullName} ({s.status === 'active' ? 'Active' : 'Inactive'})
                    </option>
                  ))
              )}
            </select>
          </div>
        </div>

        {/* Date Selector */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200">
            <button
              type="button"
              onClick={() => setSelectedDate((d) => offsetDateKey(d, -1))}
              className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-white rounded-lg transition cursor-pointer"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 px-3 py-1 font-semibold text-xs text-stone-800 font-mono">
              <Calendar className="w-3.5 h-3.5 text-amber-700" />
              <span>{formatDateDisplay(selectedDate)}</span>
              {isToday && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 font-bold uppercase ml-1">
                  Today
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSelectedDate((d) => offsetDateKey(d, 1))}
              className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-white rounded-lg transition cursor-pointer"
              title="Next Day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate(getTodayDateKey())}
              className="px-2.5 py-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition cursor-pointer"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Sessions List Sidebar + Interactive Historical Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Distinct Sessions for selected day */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-stone-200 shadow-sm p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-700">
              Sessions on this Date ({sessions.length})
            </h3>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs text-stone-400">
              Loading attendance sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-10 text-center px-4 rounded-xl bg-stone-50 border border-stone-200/60">
              <Clock className="w-8 h-8 text-stone-400 mx-auto mb-2" />
              <p className="text-xs text-stone-600 font-semibold">No Sessions Recorded</p>
              <p className="text-[11px] text-stone-400 mt-1">
                No attendance sessions were recorded for {selectedStudent?.fullName || 'this student'} on{' '}
                {formatDateDisplay(selectedDate)}.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((sess, idx) => {
                const isSelected = sess.id === selectedSessionId;
                const inFormatted = new Date(sess.inTimestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const outFormatted = sess.outTimestamp
                  ? new Date(sess.outTimestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Active Now';

                return (
                  <div
                    key={sess.id}
                    onClick={() => setSelectedSessionId(sess.id)}
                    className={`p-4 rounded-xl border text-xs transition cursor-pointer ${
                      isSelected
                        ? 'bg-amber-50/80 border-amber-300 shadow-xs'
                        : 'bg-stone-50 hover:bg-stone-100/80 border-stone-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-stone-900 text-sm">
                        Session #{idx + 1}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          sess.status === 'INSIDE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-stone-200 text-stone-700'
                        }`}
                      >
                        {sess.status}
                      </span>
                    </div>

                    <div className="mt-2.5 space-y-1 text-stone-600 font-mono text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-stone-400">IN Time:</span>
                        <strong className="text-stone-800">{inFormatted}</strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-stone-400">OUT Time:</span>
                        <strong className="text-stone-800">{outFormatted}</strong>
                      </div>
                      {sess.totalMinutesInside != null && (
                        <div className="flex items-center justify-between pt-1 border-t border-stone-200/60">
                          <span className="text-stone-400">Duration:</span>
                          <span className="text-amber-800 font-bold">
                            {sess.totalMinutesInside} mins
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Waypoints List for Selected Session */}
          {selectedSession && sessionPoints.length > 0 && (
            <div className="mt-4 pt-4 border-t border-stone-100">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-2">
                Recorded Waypoints ({sessionPoints.length})
              </h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-[11px] font-mono text-stone-600">
                {sessionPoints.map((pt, i) => (
                  <div
                    key={pt.id || i}
                    className="p-2 rounded bg-stone-50 border border-stone-200/70 flex items-center justify-between"
                  >
                    <span>
                      #{i + 1} &bull; {new Date(pt.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-amber-700 font-semibold">
                      &plusmn;{Math.round(pt.accuracy || 10)}m
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Leaflet Historical Map */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-stone-200 shadow-sm p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <div className="text-xs">
              <span className="font-bold text-stone-900">
                {selectedSession
                  ? `Historical Route for Session (${new Date(
                      selectedSession.inTimestamp
                    ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
                  : 'Select a Session'}
              </span>
            </div>

            {selectedSession && (
              <div className="flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span> IN Start
                </span>
                <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span> OUT End
                </span>
                <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                  <span className="w-3 h-1 bg-amber-600 rounded"></span> Traveled Polyline
                </span>
              </div>
            )}
          </div>

          <div className="relative rounded-xl overflow-hidden border border-stone-300">
            <div ref={mapContainerRef} className="w-full h-[480px] sm:h-[540px] z-0" />

            {isLoadingPoints && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-xs flex items-center justify-center z-10">
                <div className="flex items-center gap-2 text-xs font-semibold text-stone-700 bg-white px-4 py-2 rounded-xl shadow-lg border border-stone-200">
                  <div className="w-4 h-4 border-2 border-stone-300 border-t-amber-600 rounded-full animate-spin" />
                  <span>Loading route polyline...</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

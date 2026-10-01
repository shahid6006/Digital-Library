import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  Radio,
  Crosshair,
  Clock,
  MapPin,
  RefreshCw,
  Users,
  Compass,
  AlertCircle,
  Eye,
  Armchair,
} from 'lucide-react';
import { api } from '../services/api';
import type { AttendanceSession, SessionLocationPoint, GeofenceSettings } from '../types';

export function AdminLiveMapView() {
  const [activeSessions, setActiveSessions] = useState<AttendanceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [sessionRoutes, setSessionRoutes] = useState<Record<string, SessionLocationPoint[]>>({});
  const [geofence, setGeofence] = useState<GeofenceSettings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const circlesRef = useRef<Map<string, L.Circle>>(new Map());
  const polylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const geofenceCircleRef = useRef<L.Circle | null>(null);

  // 1. Subscribe to active live sessions & geofence settings in real time via Firestore
  useEffect(() => {
    setIsLoading(true);
    const unsub = api.subscribeToActiveLiveSessions((sessions) => {
      setActiveSessions(sessions);
      setIsLoading(false);

      if (sessions.length > 0 && !selectedSessionId) {
        setSelectedSessionId(sessions[0].id);
      }
    });

    const unsubGeo = api.subscribeToGeofenceSettings((settings) => {
      setGeofence(settings);
    });

    return () => {
      unsub();
      unsubGeo();
    };
  }, [selectedSessionId]);

  // 2. Subscribe to route waypoints for each active session
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    activeSessions.forEach((sess) => {
      const unsub = api.subscribeToSessionRoute(sess.id, (points) => {
        setSessionRoutes((prev) => ({
          ...prev,
          [sess.id]: points,
        }));
      });
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [activeSessions]);

  // 3. Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const defaultCenter: L.LatLngExpression = [34.0522, -118.2437];
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView(defaultCenter, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

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

  // 4. Update markers, polylines, and bounds on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove markers/polylines for sessions no longer active
    const activeIds = new Set(activeSessions.map((s) => s.id));

    markersRef.current.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    circlesRef.current.forEach((circle, id) => {
      if (!activeIds.has(id)) {
        circle.remove();
        circlesRef.current.delete(id);
      }
    });

    polylinesRef.current.forEach((poly, id) => {
      if (!activeIds.has(id)) {
        poly.remove();
        polylinesRef.current.delete(id);
      }
    });

    // Render/update Geofence Circle on Live Map
    if (geofence) {
      if (!geofenceCircleRef.current) {
        geofenceCircleRef.current = L.circle([geofence.latitude, geofence.longitude], {
          radius: geofence.radiusMeters,
          color: geofence.enabled ? '#d97706' : '#6b7280',
          fillColor: geofence.enabled ? '#f59e0b' : '#9ca3af',
          fillOpacity: 0.12,
          weight: 2,
          dashArray: geofence.enabled ? undefined : '5, 5',
        }).addTo(map);
        geofenceCircleRef.current.bindPopup(
          `<strong>Official Geofence</strong><br/>Radius: ${geofence.radiusMeters}m<br/>Status: ${geofence.enabled ? '🟢 Active' : '⚪ Disabled'}`
        );
      } else {
        geofenceCircleRef.current.setLatLng([geofence.latitude, geofence.longitude]);
        geofenceCircleRef.current.setRadius(geofence.radiusMeters);
        geofenceCircleRef.current.setStyle({
          color: geofence.enabled ? '#d97706' : '#6b7280',
          fillColor: geofence.enabled ? '#f59e0b' : '#9ca3af',
          dashArray: geofence.enabled ? undefined : '5, 5',
        });
      }
    }

    if (activeSessions.length === 0) return;

    const bounds = L.latLngBounds([]);

    activeSessions.forEach((sess) => {
      const loc = sess.lastLocation || sess.inLocation;
      if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;

      const latLng: L.LatLngExpression = [loc.latitude, loc.longitude];
      bounds.extend(latLng);

      const isSelected = sess.id === selectedSessionId;

      // Update / Draw Polyline for this student's session route
      const points = sessionRoutes[sess.id] || [];
      const latLngs: L.LatLngExpression[] = points.map((p) => [p.latitude, p.longitude]);

      if (!polylinesRef.current.has(sess.id)) {
        const poly = L.polyline(latLngs, {
          color: isSelected ? '#d97706' : '#2563eb',
          weight: isSelected ? 5 : 3.5,
          opacity: 0.85,
          lineCap: 'round',
        }).addTo(map);
        polylinesRef.current.set(sess.id, poly);
      } else {
        const poly = polylinesRef.current.get(sess.id)!;
        poly.setLatLngs(latLngs);
        poly.setStyle({
          color: isSelected ? '#d97706' : '#2563eb',
          weight: isSelected ? 5 : 3.5,
        });
      }

      // Update / Draw Moving Live Marker
      const customHtml = `
        <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
          <div style="
            position: absolute;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: ${isSelected ? 'rgba(217, 119, 6, 0.4)' : 'rgba(37, 99, 235, 0.3)'};
            animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
          "></div>
          <div style="
            position: relative;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: ${isSelected ? '#d97706' : '#2563eb'};
            border: 3px solid white;
            box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          "></div>
        </div>
      `;

      if (!markersRef.current.has(sess.id)) {
        const icon = L.divIcon({
          className: 'custom-live-student-marker',
          html: customHtml,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const marker = L.marker(latLng, { icon, zIndexOffset: isSelected ? 1000 : 500 })
          .addTo(map)
          .bindPopup(
            `<strong>${sess.seatNumberSnapshot != null ? `Seat #${sess.seatNumberSnapshot} &bull; ` : ''}${sess.studentName}</strong><br/>IN: ${new Date(
              sess.inTimestamp
            ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<br/>Accuracy: &plusmn;${Math.round(
              loc.accuracy || 10
            )}m`
          );

        marker.on('click', () => {
          setSelectedSessionId(sess.id);
        });

        markersRef.current.set(sess.id, marker);
      } else {
        const marker = markersRef.current.get(sess.id)!;
        marker.setLatLng(latLng);
        marker.setZIndexOffset(isSelected ? 1000 : 500);
        const icon = L.divIcon({
          className: 'custom-live-student-marker',
          html: customHtml,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        marker.setIcon(icon);
      }

      // Accuracy Circle
      const acc = Math.max(5, loc.accuracy || 15);
      if (!circlesRef.current.has(sess.id)) {
        const circle = L.circle(latLng, {
          radius: acc,
          color: isSelected ? '#d97706' : '#2563eb',
          fillColor: isSelected ? '#f59e0b' : '#3b82f6',
          fillOpacity: 0.12,
          weight: 1.5,
        }).addTo(map);
        circlesRef.current.set(sess.id, circle);
      } else {
        const circle = circlesRef.current.get(sess.id)!;
        circle.setLatLng(latLng);
        circle.setRadius(acc);
      }
    });

    // Auto-follow selected student or fit bounds if initial
    if (autoFollow && selectedSessionId) {
      const selSess = activeSessions.find((s) => s.id === selectedSessionId);
      const loc = selSess?.lastLocation || selSess?.inLocation;
      if (loc) {
        map.panTo([loc.latitude, loc.longitude], { animate: true, duration: 0.6 });
      }
    } else if (bounds.isValid() && !selectedSessionId) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
    }
  }, [activeSessions, sessionRoutes, selectedSessionId, autoFollow]);

  const selectedSession = activeSessions.find((s) => s.id === selectedSessionId);
  const selectedRoute = selectedSession ? sessionRoutes[selectedSession.id] || [] : [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-bold tracking-wider text-amber-700 mb-0.5 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>Admin Live Operations</span>
          </div>
          <h2 className="text-2xl font-black text-stone-900 tracking-tight flex items-center gap-2">
            <span>Live Student GPS Tracking</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
              {activeSessions.length} Active {activeSessions.length === 1 ? 'Student' : 'Students'}
            </span>
          </h2>
          <p className="text-xs text-stone-600 mt-0.5">
            Real-time GPS positions and moving polylines for students currently inside an active
            attendance session.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoFollow((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition cursor-pointer shadow-2xs ${
              autoFollow
                ? 'bg-amber-600 text-white border-amber-700'
                : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>{autoFollow ? 'Follow Enabled' : 'Follow Disabled'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Active Student List Sidebar + Large Live Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Active Students Roster */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-stone-200 shadow-sm p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-700 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-amber-700" />
              <span>Students Inside Campus ({activeSessions.length})</span>
            </h3>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs text-stone-400">
              <div className="w-6 h-6 border-2 border-stone-300 border-t-amber-600 rounded-full animate-spin mx-auto mb-2" />
              Connecting to live GPS streams...
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="py-10 text-center px-4 rounded-xl bg-stone-50 border border-stone-200/60">
              <Compass className="w-8 h-8 text-stone-400 mx-auto mb-2" />
              <p className="text-xs text-stone-600 font-semibold">No Active Sessions</p>
              <p className="text-[11px] text-stone-400 mt-1 leading-relaxed">
                Currently, no students are marked INSIDE with active GPS tracking. When a student
                marks IN, their moving dot will immediately appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
              {[...activeSessions]
                .sort((a, b) => {
                  const seatA = typeof a.seatNumberSnapshot === 'number' && !isNaN(a.seatNumberSnapshot) ? a.seatNumberSnapshot : 999999;
                  const seatB = typeof b.seatNumberSnapshot === 'number' && !isNaN(b.seatNumberSnapshot) ? b.seatNumberSnapshot : 999999;
                  if (seatA !== seatB) return seatA - seatB;
                  return a.studentName.localeCompare(b.studentName);
                })
                .map((sess) => {
                const isSelected = sess.id === selectedSessionId;
                const loc = sess.lastLocation || sess.inLocation;
                const pointsCount = (sessionRoutes[sess.id] || []).length;
                const elapsedMins = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(sess.inTimestamp).getTime()) / (1000 * 60))
                );

                return (
                  <div
                    key={sess.id}
                    onClick={() => {
                      setSelectedSessionId(sess.id);
                      setAutoFollow(true);
                    }}
                    className={`p-3.5 rounded-xl border text-xs transition cursor-pointer ${
                      isSelected
                        ? 'bg-amber-50/80 border-amber-300 shadow-xs'
                        : 'bg-stone-50 hover:bg-stone-100/80 border-stone-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {sess.seatNumberSnapshot != null ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold font-mono">
                                <Armchair className="w-3 h-3 text-amber-700" />
                                <span>Seat #{sess.seatNumberSnapshot}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-stone-400 font-mono">Seat: —</span>
                            )}
                            <span className="font-extrabold text-stone-900 text-sm">
                              {sess.studentName}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">
                        INSIDE
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-stone-600 font-mono text-[11px]">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-stone-400" />
                        <span>Duration: {elapsedMins}m</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-stone-400" />
                        <span>Waypoints: {pointsCount}</span>
                      </div>
                    </div>

                    {loc && (
                      <div className="mt-2 pt-2 border-t border-stone-200/60 flex items-center justify-between text-[10px] text-stone-500">
                        <span>
                          Lat: {loc.latitude.toFixed(4)}, Lng: {loc.longitude.toFixed(4)}
                        </span>
                        <span className="text-amber-700 font-semibold font-mono">
                          &plusmn;{Math.round(loc.accuracy || 10)}m
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Live Map Canvas */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-stone-200 shadow-sm p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-stone-800">
                {selectedSession ? `Following: ${selectedSession.studentName}` : 'Campus Overview'}
              </span>
              {selectedSession && (
                <span className="text-stone-400 font-mono">
                  (IN at{' '}
                  {new Date(selectedSession.inTimestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  )
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-stone-500">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-1 bg-amber-600 rounded"></span> Selected Route
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-1 bg-blue-600 rounded"></span> Other Active
              </span>
            </div>
          </div>

          {/* Leaflet Container */}
          <div className="relative rounded-xl overflow-hidden border border-stone-300">
            <div ref={mapContainerRef} className="w-full h-[480px] sm:h-[540px] z-0" />

            {/* Selected Student Info Strip */}
            {selectedSession && (
              <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-none">
                <div className="pointer-events-auto bg-stone-900/90 backdrop-blur-md text-white px-4 py-2.5 rounded-xl border border-stone-700/60 shadow-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-extrabold text-sm text-amber-400 flex items-center gap-1.5">
                      {selectedSession.seatNumberSnapshot != null && (
                        <span className="bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded text-xs border border-amber-400/30 font-mono">
                          Seat #{selectedSession.seatNumberSnapshot}
                        </span>
                      )}
                      <span>{selectedSession.studentName}</span>
                    </div>
                    <div className="text-[11px] text-stone-300 mt-0.5">
                      Session started at{' '}
                      {new Date(selectedSession.inTimestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      &bull; {selectedRoute.length} GPS points logged
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    {selectedSession.lastLocation?.accuracy && (
                      <span className="px-2.5 py-1 rounded bg-stone-800 border border-stone-700 font-mono text-amber-300">
                        Accuracy: &plusmn;{Math.round(selectedSession.lastLocation.accuracy)}m
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

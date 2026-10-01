import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  MapPin,
  Crosshair,
  Search,
  CheckCircle2,
  AlertCircle,
  Shield,
  ShieldAlert,
  Save,
  Navigation,
  Sliders,
  Radio,
  Layers,
  Info,
  RefreshCw,
  Compass,
  Building2,
} from 'lucide-react';
import { api } from '../services/api';
import type { GeofenceSettings, AttendanceSession } from '../types';

interface SearchResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
}

const RADIUS_PRESETS = [25, 50, 100, 150, 200, 500];

export function AdminGeofenceSettings() {
  const [settings, setSettings] = useState<GeofenceSettings | null>(null);
  const [latitude, setLatitude] = useState<number>(33.7782);
  const [longitude, setLongitude] = useState<number>(75.1495);
  const [radiusMeters, setRadiusMeters] = useState<number>(100);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [address, setAddress] = useState<string>('Digital Library Campus, Main Block');

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSearchResults, setShowSearchResults] = useState<boolean>(false);

  // Map interaction mode
  const [isClickSelectMode, setIsClickSelectMode] = useState<boolean>(true);
  const [isGettingCurrentLoc, setIsGettingCurrentLoc] = useState<boolean>(false);

  // Save / Confirmation state
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Live active sessions to show live student presence on geofence map
  const [liveSessions, setLiveSessions] = useState<AttendanceSession[]>([]);

  // Leaflet refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const centerMarkerRef = useRef<L.Marker | null>(null);
  const radiusCircleRef = useRef<L.Circle | null>(null);
  const studentLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // 1. Subscribe to real-time geofence settings
  useEffect(() => {
    const unsub = api.subscribeToGeofenceSettings((newSettings) => {
      setSettings(newSettings);
      setLatitude(newSettings.latitude);
      setLongitude(newSettings.longitude);
      setRadiusMeters(newSettings.radiusMeters);
      setEnabled(newSettings.enabled);
      setAddress(newSettings.address || '');
    });

    const unsubSessions = api.subscribeToActiveLiveSessions((sessions) => {
      setLiveSessions(sessions);
    });

    return () => {
      unsub();
      unsubSessions();
    };
  }, []);

  // 2. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: L.LatLngExpression = [latitude, longitude];
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView(initialCenter, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Circle for geofence range
    const circle = L.circle(initialCenter, {
      radius: radiusMeters,
      color: enabled ? '#d97706' : '#6b7280',
      fillColor: enabled ? '#f59e0b' : '#9ca3af',
      fillOpacity: 0.18,
      weight: 2.5,
      dashArray: enabled ? undefined : '6, 6',
    }).addTo(map);
    radiusCircleRef.current = circle;

    // Custom Draggable Geofence Center Pin
    const centerIcon = L.divIcon({
      className: 'custom-geofence-center-pin',
      html: `
        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          background: #78350f;
          color: #ffffff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 3px solid #ffffff;
          box-shadow: 0 4px 14px rgba(0,0,0,0.4);
          cursor: grab;
        ">
          <div style="
            transform: rotate(45deg);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
          ">
            🏛️
          </div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -40],
    });

    const marker = L.marker(initialCenter, {
      icon: centerIcon,
      draggable: true,
      autoPan: true,
    }).addTo(map);

    marker.bindPopup(`
      <div style="font-family: inherit; font-size: 12px; padding: 4px;">
        <strong style="color: #b45309; font-size: 13px;">Official Library Location</strong>
        <div style="margin-top: 4px; color: #44403c;">Drag this marker or click map to change location</div>
      </div>
    `);

    // Handle marker drag
    marker.on('drag', () => {
      const pos = marker.getLatLng();
      circle.setLatLng(pos);
    });

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      const newLat = parseFloat(pos.lat.toFixed(6));
      const newLng = parseFloat(pos.lng.toFixed(6));
      setLatitude(newLat);
      setLongitude(newLng);
      circle.setLatLng([newLat, newLng]);
      reverseGeocode(newLat, newLng);
    });

    centerMarkerRef.current = marker;

    // Handle map click
    map.on('click', (e: L.LeafletMouseEvent) => {
      const newLat = parseFloat(e.latlng.lat.toFixed(6));
      const newLng = parseFloat(e.latlng.lng.toFixed(6));
      setLatitude(newLat);
      setLongitude(newLng);
      marker.setLatLng([newLat, newLng]);
      circle.setLatLng([newLat, newLng]);
      reverseGeocode(newLat, newLng);
    });

    // Layer group for live student dots
    const studentGroup = L.layerGroup().addTo(map);
    studentLayerGroupRef.current = studentGroup;

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

  // 3. Sync circle and marker when radius or enabled state changes
  useEffect(() => {
    if (!radiusCircleRef.current || !centerMarkerRef.current) return;

    radiusCircleRef.current.setRadius(radiusMeters);
    radiusCircleRef.current.setStyle({
      color: enabled ? '#d97706' : '#6b7280',
      fillColor: enabled ? '#f59e0b' : '#9ca3af',
      fillOpacity: enabled ? 0.18 : 0.08,
      dashArray: enabled ? undefined : '6, 6',
    });
  }, [radiusMeters, enabled]);

  // 4. Update student markers on geofence map
  useEffect(() => {
    const layer = studentLayerGroupRef.current;
    if (!layer) return;

    layer.clearLayers();

    liveSessions.forEach((sess) => {
      const loc = sess.lastLocation || sess.inLocation;
      if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
        return;
      }

      // Check distance from current geofence center
      const dist = computeDistanceMeters(loc.latitude, loc.longitude, latitude, longitude);
      const isInside = dist <= radiusMeters;

      const studentIcon = L.divIcon({
        className: 'student-geofence-marker',
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            background: ${isInside ? '#059669' : '#e11d48'};
            color: #ffffff;
            border-radius: 50%;
            border: 2px solid #ffffff;
            font-size: 10px;
            font-weight: 800;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          ">
            ${sess.studentName.charAt(0).toUpperCase()}
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const stuMarker = L.marker([loc.latitude, loc.longitude], { icon: studentIcon });
      stuMarker.bindPopup(`
        <div style="font-size: 11px; font-family: inherit;">
          <strong>${sess.studentName}</strong>
          <div style="margin-top: 2px; color: ${isInside ? '#059669' : '#e11d48'}; font-weight: bold;">
            ${isInside ? '🟢 Inside Geofence' : '🔴 Outside Geofence'} (~${Math.round(dist)}m)
          </div>
        </div>
      `);
      stuMarker.addTo(layer);
    });
  }, [liveSessions, latitude, longitude, radiusMeters]);

  // Helper to reverse geocode lat/lng to human address
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.display_name) {
          setAddress(data.display_name);
        }
      }
    } catch {
      // Ignore geocode error
    }
  };

  // Search places via Nominatim
  const handleSearchLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery.trim()
        )}&limit=5`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (res.ok) {
        const results = await res.json();
        setSearchResults(results);
        setShowSearchResults(true);
      }
    } catch (err) {
      console.warn('Location search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Select place from search
  const handleSelectSearchResult = (result: SearchResult) => {
    const newLat = parseFloat(parseFloat(result.lat).toFixed(6));
    const newLng = parseFloat(parseFloat(result.lon).toFixed(6));

    setLatitude(newLat);
    setLongitude(newLng);
    setAddress(result.display_name);
    setShowSearchResults(false);
    setSearchQuery('');

    if (mapInstanceRef.current && centerMarkerRef.current && radiusCircleRef.current) {
      centerMarkerRef.current.setLatLng([newLat, newLng]);
      radiusCircleRef.current.setLatLng([newLat, newLng]);
      mapInstanceRef.current.setView([newLat, newLng], 17, { animate: true });
    }
  };

  // Use Admin's current device GPS
  const handleUseCurrentLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFeedback({
        type: 'error',
        message: 'Geolocation is not supported by your browser.',
      });
      return;
    }

    setIsGettingCurrentLoc(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsGettingCurrentLoc(false);
        const newLat = parseFloat(pos.coords.latitude.toFixed(6));
        const newLng = parseFloat(pos.coords.longitude.toFixed(6));

        setLatitude(newLat);
        setLongitude(newLng);

        if (mapInstanceRef.current && centerMarkerRef.current && radiusCircleRef.current) {
          centerMarkerRef.current.setLatLng([newLat, newLng]);
          radiusCircleRef.current.setLatLng([newLat, newLng]);
          mapInstanceRef.current.setView([newLat, newLng], 17, { animate: true });
        }

        reverseGeocode(newLat, newLng);
        setFeedback({
          type: 'info',
          message: `Location set to current device GPS (accuracy ±${Math.round(
            pos.coords.accuracy || 0
          )}m). Click "Save Geofence" to apply.`,
        });
      },
      (err) => {
        setIsGettingCurrentLoc(false);
        setFeedback({
          type: 'error',
          message: `Unable to get current GPS location: ${err.message}`,
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Handle manual coordinate input changes
  const handleLatChange = (val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= -90 && num <= 90) {
      setLatitude(num);
      if (centerMarkerRef.current && radiusCircleRef.current && mapInstanceRef.current) {
        centerMarkerRef.current.setLatLng([num, longitude]);
        radiusCircleRef.current.setLatLng([num, longitude]);
        mapInstanceRef.current.panTo([num, longitude]);
      }
    }
  };

  const handleLngChange = (val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= -180 && num <= 180) {
      setLongitude(num);
      if (centerMarkerRef.current && radiusCircleRef.current && mapInstanceRef.current) {
        centerMarkerRef.current.setLatLng([latitude, num]);
        radiusCircleRef.current.setLatLng([latitude, num]);
        mapInstanceRef.current.panTo([latitude, num]);
      }
    }
  };

  // Save Settings to Firestore & Backend
  const handleConfirmSave = async () => {
    setIsSaving(true);
    setShowConfirmModal(false);
    try {
      const saved = await api.saveGeofenceSettings({
        latitude,
        longitude,
        radiusMeters,
        enabled,
        address,
      });

      setSettings(saved);
      setFeedback({
        type: 'success',
        message: `Official attendance geofence saved successfully (${saved.radiusMeters}m radius, version: ${saved.version}).`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to save geofence settings. Please retry.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate how many active students are inside vs outside this geofence right now
  const studentsInsideCount = liveSessions.filter((sess) => {
    const loc = sess.lastLocation || sess.inLocation;
    if (!loc) return false;
    return computeDistanceMeters(loc.latitude, loc.longitude, latitude, longitude) <= radiusMeters;
  }).length;

  const studentsOutsideCount = liveSessions.length - studentsInsideCount;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="text-xs uppercase font-bold tracking-wider text-amber-700 mb-1 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5" />
              <span>Automated Attendance System</span>
            </div>
            <h2 className="text-2xl font-extrabold text-stone-900 tracking-tight flex items-center gap-3">
              <span>Attendance Location &amp; Geofence</span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  enabled
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-stone-100 text-stone-600 border border-stone-300'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    enabled ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'
                  }`}
                />
                {enabled ? 'Geofence Active' : 'Geofence Disabled'}
              </span>
            </h2>
            <p className="text-sm text-stone-500 mt-1 max-w-2xl">
              Set the library's physical location and allowable attendance radius. Students within this
              boundary can mark their first IN of the day, after which automatic 1-minute dwell and exit
              monitoring takes over.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Toggle Enable/Disable Button */}
            <button
              type="button"
              onClick={() => setEnabled((prev) => !prev)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs shadow-2xs transition cursor-pointer ${
                enabled
                  ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {enabled ? (
                <>
                  <ShieldAlert className="w-4 h-4 text-amber-700" />
                  <span>Disable Geofence</span>
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 text-white" />
                  <span>Enable Geofence</span>
                </>
              )}
            </button>

            {/* Save Button */}
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-700 hover:bg-amber-600 active:scale-98 text-white font-extrabold text-xs rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Geofence'}</span>
            </button>
          </div>
        </div>

        {/* Feedback alert */}
        {feedback && (
          <div
            className={`mt-4 p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 animate-fade-in ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : feedback.type === 'info'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-stone-400 hover:text-stone-700 text-sm font-bold cursor-pointer"
            >
              &times;
            </button>
          </div>
        )}
      </div>

      {/* Main Grid: Map & Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Leaflet Map & Search */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-4 sm:p-5 flex flex-col gap-3">
            {/* Search and Action Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 relative">
              <form onSubmit={handleSearchLocation} className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search street, building, city, landmark..."
                  className="w-full pl-9 pr-24 py-2 text-xs rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-stone-50/50"
                />
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                <button
                  type="submit"
                  disabled={isSearching || !searchQuery.trim()}
                  className="absolute right-1.5 top-1 px-3 py-1 bg-stone-200 hover:bg-stone-300 text-stone-800 text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  {isSearching ? '...' : 'Search'}
                </button>
              </form>

              {/* Use My Current Location */}
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={isGettingCurrentLoc}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl border border-stone-200 transition shrink-0 cursor-pointer"
                title="Detect admin current GPS location"
              >
                <Crosshair className={`w-3.5 h-3.5 ${isGettingCurrentLoc ? 'animate-spin' : ''}`} />
                <span>{isGettingCurrentLoc ? 'Locating...' : 'Use My Current Location'}</span>
              </button>

              {/* Search dropdown results */}
              {showSearchResults && searchResults.length > 0 && (
                <div className="absolute top-12 left-0 right-0 sm:right-48 bg-white border border-stone-200 rounded-xl shadow-xl z-[1000] max-h-60 overflow-y-auto divide-y divide-stone-100">
                  <div className="p-2 text-[10px] font-bold uppercase tracking-wider text-stone-400 bg-stone-50">
                    Search Results
                  </div>
                  {searchResults.map((r) => (
                    <button
                      key={r.place_id}
                      type="button"
                      onClick={() => handleSelectSearchResult(r)}
                      className="w-full text-left px-3 py-2 text-xs text-stone-700 hover:bg-amber-50/80 transition flex items-start gap-2 cursor-pointer"
                    >
                      <MapPin className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{r.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Map Container */}
            <div className="relative w-full h-[400px] sm:h-[480px] rounded-xl overflow-hidden border border-stone-200 bg-stone-100 shadow-inner">
              <div ref={mapContainerRef} className="w-full h-full z-0" />

              {/* Instructions Overlay Banner */}
              <div className="absolute top-3 left-3 z-[400] bg-white/95 backdrop-blur-xs px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-700 shadow-sm flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                <span>Click map or drag the brown pin to place the attendance center</span>
              </div>

              {/* Map Legend Overlay */}
              <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-xs px-3 py-2 rounded-xl border border-stone-200 text-[11px] font-semibold text-stone-700 shadow-md flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-amber-600 border border-white shadow-2xs inline-block" />
                  <span>Geofence Center ({radiusMeters}m radius)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-emerald-600 border border-white shadow-2xs inline-block" />
                  <span>Student Inside</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-rose-600 border border-white shadow-2xs inline-block" />
                  <span>Student Outside</span>
                </div>
              </div>
            </div>

            {/* Location Description */}
            <div className="text-xs text-stone-500 flex items-start gap-1.5 pt-1">
              <Building2 className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
              <span className="line-clamp-2 font-medium">{address || 'No address resolved'}</span>
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Coordinate & Radius Controls */}
        <div className="space-y-5">
          {/* Radius Selector Card */}
          <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-700" />
                <h3 className="text-sm font-bold text-stone-900 uppercase tracking-wider">
                  Allowed Radius
                </h3>
              </div>
              <span className="text-lg font-black text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-lg border border-amber-200 font-mono">
                {radiusMeters} m
              </span>
            </div>

            <p className="text-xs text-stone-500">
              Select or type the geographic range around the library center. Students must be inside
              this circle to check in.
            </p>

            {/* Preset Buttons */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-2">
                Radius Presets
              </label>
              <div className="grid grid-cols-3 gap-2">
                {RADIUS_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRadiusMeters(preset)}
                    className={`py-2 px-3 text-xs font-bold rounded-xl border transition cursor-pointer ${
                      radiusMeters === preset
                        ? 'bg-amber-700 text-white border-amber-700 shadow-sm'
                        : 'bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200'
                    }`}
                  >
                    {preset} meters
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Radius Input & Slider */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">
                Custom Radius (Meters)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="10"
                  max="5000"
                  step="5"
                  value={radiusMeters}
                  onChange={(e) => setRadiusMeters(Math.max(10, parseInt(e.target.value) || 10))}
                  className="w-full px-3 py-2 text-sm font-mono font-bold text-stone-900 bg-stone-50 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
                <span className="text-xs font-bold text-stone-500">meters</span>
              </div>

              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={Math.min(1000, radiusMeters)}
                onChange={(e) => setRadiusMeters(parseInt(e.target.value))}
                className="w-full mt-3 accent-amber-700 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-stone-400 font-mono mt-1">
                <span>10m</span>
                <span>250m</span>
                <span>500m</span>
                <span>1000m</span>
              </div>
            </div>
          </div>

          {/* Coordinate Precision Card */}
          <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-stone-100 pb-3">
              <Navigation className="w-4 h-4 text-amber-700" />
              <h3 className="text-sm font-bold text-stone-900 uppercase tracking-wider">
                Coordinates (GPS)
              </h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                  Center Latitude
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={latitude}
                  onChange={(e) => handleLatChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold text-stone-900 bg-stone-50 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                  Center Longitude
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={longitude}
                  onChange={(e) => handleLngChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono font-bold text-stone-900 bg-stone-50 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                Coordinates update automatically when you drag the center pin on the map or search an
                address.
              </span>
            </div>
          </div>

          {/* Active Geofence Metadata Card */}
          <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                Config Version
              </span>
              <span className="text-xs font-mono font-bold text-stone-700 bg-stone-100 px-2 py-0.5 rounded-md">
                {settings?.version || 'v1'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                Last Updated
              </span>
              <span className="text-xs font-medium text-stone-700">
                {settings?.updatedAt
                  ? new Date(settings.updatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'N/A'}
              </span>
            </div>

            <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
              <span className="font-semibold text-stone-600">Students Inside Radius:</span>
              <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                {studentsInsideCount} active
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-stone-600">Students Outside Radius:</span>
              <span className="font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                {studentsOutsideCount} active
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal Before Saving */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-5 animate-scale-up">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-800">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">Confirm Geofence Update</h3>
                <p className="text-xs text-stone-500">Review changes to official attendance location</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-xs">
              <div>
                <strong>Selected Location:</strong>
                <div className="font-mono text-stone-700 mt-0.5">
                  Lat: {latitude.toFixed(6)}, Lng: {longitude.toFixed(6)}
                </div>
              </div>
              <div>
                <strong>Allowed Radius:</strong>
                <span className="ml-1 font-bold text-amber-900">{radiusMeters} meters</span>
              </div>
              <div>
                <strong>Status:</strong>
                <span className={`ml-1 font-bold ${enabled ? 'text-emerald-700' : 'text-stone-500'}`}>
                  {enabled ? 'Active Geofencing' : 'Disabled (Open Access)'}
                </span>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              Attendance location will be changed to this point with a radius of{' '}
              <strong>{radiusMeters} meters</strong>. All new student manual and automatic check-ins will
              be validated against this boundary.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={isSaving}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-700 hover:bg-amber-600 rounded-xl shadow-md transition cursor-pointer"
              >
                {isSaving ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Distance calculation utility function
function computeDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

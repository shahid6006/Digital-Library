import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { LocationData, SessionLocationPoint } from '../types';
import { Crosshair, Navigation2, ShieldCheck, MapPin } from 'lucide-react';

interface LiveTrackingMapProps {
  currentLocation: LocationData | null;
  route: SessionLocationPoint[];
  studentName: string;
  sessionStartTime?: string;
  isTrackingActive: boolean;
  className?: string;
}

export function LiveTrackingMap({
  currentLocation,
  route,
  studentName,
  sessionStartTime,
  isTrackingActive,
  className = 'h-[360px] sm:h-[440px]',
}: LiveTrackingMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const liveMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = currentLocation?.latitude ?? 34.0522;
    const initialLng = currentLocation?.longitude ?? -118.2437;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView([initialLat, initialLng], 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Polyline for active route
    const polyline = L.polyline([], {
      color: '#d97706', // amber-600
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: undefined,
    }).addTo(map);
    polylineRef.current = polyline;

    mapInstanceRef.current = map;

    // Invalidate size after layout completes
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update route polyline and start marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    const polyline = polylineRef.current;
    if (!map || !polyline) return;

    const latLngs: L.LatLngExpression[] = route
      .filter((p) => typeof p.latitude === 'number' && typeof p.longitude === 'number')
      .map((p) => [p.latitude, p.longitude]);

    polyline.setLatLngs(latLngs);

    // Create or update start marker at first point
    if (route.length > 0) {
      const firstPt = route[0];
      const startLatLng: L.LatLngExpression = [firstPt.latitude, firstPt.longitude];

      if (!startMarkerRef.current) {
        const startIcon = L.divIcon({
          className: 'custom-start-marker',
          html: `
            <div style="
              background: #059669;
              color: white;
              font-size: 11px;
              font-weight: 800;
              padding: 4px 8px;
              border-radius: 9999px;
              border: 2px solid white;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              gap: 4px;
              white-space: nowrap;
            ">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: white;"></span>
              IN START
            </div>
          `,
          iconSize: [80, 26],
          iconAnchor: [40, 13],
        });

        startMarkerRef.current = L.marker(startLatLng, { icon: startIcon })
          .addTo(map)
          .bindPopup(`<strong>${studentName}</strong><br/>Session Started (IN)`);
      } else {
        startMarkerRef.current.setLatLng(startLatLng);
      }
    }
  }, [route, studentName]);

  // Update moving live GPS marker and accuracy circle
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentLocation) return;

    const latLng: L.LatLngExpression = [currentLocation.latitude, currentLocation.longitude];

    // 1. Moving Marker
    if (!liveMarkerRef.current) {
      const liveIcon = L.divIcon({
        className: 'custom-live-marker',
        html: `
          <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
            <div style="
              position: absolute;
              width: 32px;
              height: 32px;
              border-radius: 50%;
              background: rgba(217, 119, 6, 0.35);
              animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
            "></div>
            <div style="
              position: relative;
              width: 16px;
              height: 16px;
              border-radius: 50%;
              background: #d97706;
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            "></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      liveMarkerRef.current = L.marker(latLng, { icon: liveIcon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(
          `<strong>${studentName} (Current Location)</strong><br/>Accuracy: &plusmn;${Math.round(
            currentLocation.accuracy || 10
          )}m`
        );
    } else {
      liveMarkerRef.current.setLatLng(latLng);
      liveMarkerRef.current.setPopupContent(
        `<strong>${studentName} (Current Location)</strong><br/>Accuracy: &plusmn;${Math.round(
          currentLocation.accuracy || 10
        )}m`
      );
    }

    // 2. Accuracy circle
    const acc = Math.max(5, currentLocation.accuracy || 15);
    if (!accuracyCircleRef.current) {
      accuracyCircleRef.current = L.circle(latLng, {
        radius: acc,
        color: '#d97706',
        fillColor: '#f59e0b',
        fillOpacity: 0.15,
        weight: 1.5,
      }).addTo(map);
    } else {
      accuracyCircleRef.current.setLatLng(latLng);
      accuracyCircleRef.current.setRadius(acc);
    }

    // Pan map to follow student if autoFollow is on
    if (autoFollow) {
      map.panTo(latLng, { animate: true, duration: 0.6 });
    }
  }, [currentLocation, autoFollow, studentName]);

  const handleCenterNow = () => {
    if (!mapInstanceRef.current || !currentLocation) return;
    setAutoFollow(true);
    mapInstanceRef.current.setView([currentLocation.latitude, currentLocation.longitude], 17, {
      animate: true,
    });
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-stone-300 shadow-md bg-stone-900">
      {/* Map Container */}
      <div ref={mapContainerRef} className={`w-full ${className} z-0`} />

      {/* Top HUD Overlay */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto bg-stone-900/85 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-xl border border-stone-700/60 shadow-lg flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isTrackingActive ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
            }`}
          />
          <span className="font-semibold text-stone-100">
            {isTrackingActive ? 'LIVE GPS TRACKING' : 'SESSION TRACKING'}
          </span>
          {currentLocation?.accuracy && (
            <span className="text-[11px] text-amber-300/90 font-mono">
              &plusmn;{Math.round(currentLocation.accuracy)}m
            </span>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCenterNow}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md transition cursor-pointer ${
              autoFollow
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-stone-900/80 backdrop-blur-md text-stone-200 hover:bg-stone-800 border border-stone-700'
            }`}
            title="Keep camera centered on moving GPS dot"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Follow Me</span>
          </button>
        </div>
      </div>

      {/* Bottom HUD Bar */}
      <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-none">
        <div className="pointer-events-auto bg-stone-900/90 backdrop-blur-md text-white px-3.5 py-2.5 rounded-xl border border-stone-700/60 shadow-xl flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-stone-300">
            <Navigation2 className="w-4 h-4 text-amber-400 animate-pulse" />
            <span>
              Route Waypoints: <strong className="text-white font-mono">{route.length}</strong>
            </span>
            {sessionStartTime && (
              <>
                <span className="text-stone-500">&bull;</span>
                <span>
                  IN at: <strong className="text-stone-200 font-mono">{sessionStartTime}</strong>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Active IN-to-OUT Session Only</span>
          </div>
        </div>
      </div>
    </div>
  );
}

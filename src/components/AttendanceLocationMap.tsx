import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { ActivityEvent } from '../types';

interface AttendanceLocationMapProps {
  events: ActivityEvent[];
  selectedEventId?: string;
  onSelectEvent?: (eventId: string) => void;
  studentName?: string;
  className?: string;
  showPolyline?: boolean;
}

export function AttendanceLocationMap({
  events,
  selectedEventId,
  onSelectEvent,
  studentName,
  className = 'h-[360px] sm:h-[460px] lg:h-[500px]',
  showPolyline = true,
}: AttendanceLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());

  // Filter events that have location coordinates
  const eventsWithLoc = events.filter(
    (e) =>
      e.location &&
      typeof e.location.latitude === 'number' &&
      typeof e.location.longitude === 'number'
  );

  // Initialize map once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const defaultCenter: L.LatLngExpression = [34.0522, -118.2437];
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView(defaultCenter, 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const layerGroup = L.layerGroup().addTo(map);
      layerGroupRef.current = layerGroup;
      mapInstanceRef.current = map;
    }

    // Force map size invalidation on render/resize
    const timer = setTimeout(() => {
      mapInstanceRef.current?.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Update markers, circles, polylines, and bounds when events or selection change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    // Clear previous dynamic layers
    layerGroup.clearLayers();
    markersMapRef.current.clear();

    if (eventsWithLoc.length === 0) {
      return;
    }

    const bounds = L.latLngBounds([]);
    const pathCoordinates: L.LatLngExpression[] = [];

    eventsWithLoc.forEach((evt, index) => {
      const { latitude, longitude, accuracy } = evt.location!;
      const latLng = L.latLng(latitude, longitude);
      bounds.extend(latLng);
      pathCoordinates.push(latLng);

      const isSelected = evt.id === selectedEventId;
      const isIN = evt.action === 'IN';

      // Visual distinction for IN (green) and OUT (red) with explicit text and sequence indicator
      const customIcon = L.divIcon({
        className: 'custom-attendance-marker',
        html: `
          <div style="
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: ${isSelected ? '38px' : '32px'};
            height: ${isSelected ? '38px' : '32px'};
            background-color: ${isIN ? '#059669' : '#e11d48'};
            color: #ffffff;
            border-radius: 50%;
            border: ${isSelected ? '3px solid #fbbf24' : '2.5px solid #ffffff'};
            box-shadow: 0 4px 12px rgba(0,0,0,0.35);
            font-weight: 800;
            font-size: ${isSelected ? '11px' : '10px'};
            letter-spacing: -0.5px;
            cursor: pointer;
            transition: transform 0.15s ease;
          ">
            <span>${evt.action}</span>
            <span style="
              position: absolute;
              bottom: -4px;
              right: -4px;
              width: 14px;
              height: 14px;
              background-color: #1c1917;
              color: #f5f5f4;
              border-radius: 50%;
              font-size: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
              border: 1px solid #ffffff;
            ">${index + 1}</span>
          </div>
        `,
        iconSize: isSelected ? [38, 38] : [32, 32],
        iconAnchor: isSelected ? [19, 19] : [16, 16],
      });

      // Visual representation of accuracy circle around the GPS marker
      if (accuracy && accuracy > 0) {
        const accuracyCircle = L.circle(latLng, {
          radius: accuracy,
          color: isIN ? '#059669' : '#e11d48',
          fillColor: isIN ? '#10b981' : '#f43f5e',
          fillOpacity: isSelected ? 0.22 : 0.12,
          weight: isSelected ? 2 : 1.2,
          dashArray: isIN ? undefined : '4, 4',
        });
        accuracyCircle.addTo(layerGroup);
      }

      // Marker popup content formatted according to user specifications
      const popupContent = `
        <div style="font-family: inherit; min-width: 200px; padding: 2px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span style="
              display: inline-flex;
              align-items: center;
              gap: 4px;
              background: ${isIN ? '#ecfdf5' : '#fff1f2'};
              color: ${isIN ? '#065f46' : '#9f1239'};
              border: 1px solid ${isIN ? '#a7f3d0' : '#fecdd3'};
              padding: 2px 8px;
              border-radius: 6px;
              font-weight: 700;
              font-size: 11px;
            ">
              ${isIN ? '🟢 IN' : '🔴 OUT'}
            </span>
            <span style="font-weight: 700; font-family: monospace; font-size: 11px; color: #1c1917;">
              ${evt.timeFormatted}
            </span>
          </div>
          ${studentName ? `<div style="font-weight: 600; font-size: 12px; color: #292524; margin-bottom: 4px;">${studentName}</div>` : ''}
          <div style="font-size: 11px; color: #57534e; line-height: 1.5; border-top: 1px solid #f5f5f4; padding-top: 4px;">
            <div><strong>GPS location</strong> — accuracy &plusmn;${accuracy ? Math.round(accuracy) : 'N/A'} meters</div>
            <div style="font-family: monospace; font-size: 10px; color: #78716c; margin-top: 2px;">
              Lat: ${latitude.toFixed(6)}<br/>
              Lng: ${longitude.toFixed(6)}
            </div>
          </div>
        </div>
      `;

      const marker = L.marker(latLng, { icon: customIcon });
      marker.bindPopup(popupContent, { maxWidth: 280 });

      marker.on('click', () => {
        onSelectEvent?.(evt.id);
      });

      marker.addTo(layerGroup);
      markersMapRef.current.set(evt.id, marker);

      if (isSelected) {
        marker.openPopup();
      }
    });

    // Optional directional route connection line if multiple events exist
    if (showPolyline && pathCoordinates.length > 1) {
      const polyline = L.polyline(pathCoordinates, {
        color: '#d97706',
        weight: 2,
        dashArray: '5, 8',
        opacity: 0.7,
      });
      polyline.addTo(layerGroup);
    }

    // Auto-fit bounds or center on single location
    if (eventsWithLoc.length === 1) {
      const single = eventsWithLoc[0].location!;
      map.setView([single.latitude, single.longitude], 16, { animate: true });
    } else if (eventsWithLoc.length > 1 && bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [45, 45],
        maxZoom: 17,
        animate: true,
      });
    }
  }, [events, selectedEventId, studentName, showPolyline, onSelectEvent]);

  // Highlight and center on selected event when selection changes
  useEffect(() => {
    if (!selectedEventId || !mapInstanceRef.current) return;
    const targetMarker = markersMapRef.current.get(selectedEventId);
    if (targetMarker) {
      targetMarker.openPopup();
      const pos = targetMarker.getLatLng();
      mapInstanceRef.current.panTo(pos, { animate: true, duration: 0.4 });
    }
  }, [selectedEventId]);

  return (
    <div className="relative w-full rounded-xl border border-stone-300 shadow-sm overflow-hidden bg-stone-100">
      <div ref={mapContainerRef} className={`w-full ${className} z-0`} />

      {eventsWithLoc.length === 0 && (
        <div className="absolute inset-0 bg-stone-50/80 backdrop-blur-2xs flex flex-col items-center justify-center p-6 text-center text-stone-500 z-10">
          <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center text-stone-400 mb-2">
            📍
          </div>
          <p className="font-semibold text-sm text-stone-700">Location not available</p>
          <p className="text-xs text-stone-400 max-w-xs mt-1">
            No GPS location coordinates were recorded for these attendance records.
          </p>
        </div>
      )}

      {/* Map Legend Overlay */}
      {eventsWithLoc.length > 0 && (
        <div className="absolute bottom-2 left-2 z-[400] bg-white/95 backdrop-blur-xs px-2.5 py-1.5 rounded-lg border border-stone-200 text-[10px] font-medium text-stone-700 shadow-md flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
            <span>🟢 IN</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" />
            <span>🔴 OUT</span>
          </span>
          <span className="text-stone-400 hidden sm:inline">
            Circles indicate GPS accuracy bounds
          </span>
        </div>
      )}
    </div>
  );
}

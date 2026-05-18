"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LeafletMouseEvent, Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import type { LatLng } from "@/lib/geo";

// Default icon assets ship under /node_modules/leaflet/dist/images and are
// not picked up by Next's bundler; point Leaflet at the unpkg CDN so the pin
// renders without us copying assets into /public.
const ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Props {
  center: LatLng;
  pin: LatLng | null;
  onPin: (loc: LatLng) => void;
}

function ClickHandler({ onPin }: { onPin: (loc: LatLng) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPin({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function Recenter({ to }: { to: LatLng }) {
  const map = useMap();
  const last = useRef<string>("");
  useEffect(() => {
    const key = `${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    if (last.current === key) return;
    last.current = key;
    map.setView([to.lat, to.lng], map.getZoom() < 14 ? 15 : map.getZoom(), {
      animate: true,
    });
  }, [to, map]);
  return null;
}

export default function MapPicker({ center, pin, onPin }: Props) {
  const markerRef = useRef<LeafletMarker | null>(null);
  const initialCenter = useMemo<[number, number]>(
    () => [center.lat, center.lng],
    // Only used on first mount; Recenter handles updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="h-64 w-full overflow-hidden rounded-xl border border-gray-200">
      <MapContainer
        center={initialCenter}
        zoom={15}
        scrollWheelZoom
        className="h-full w-full"
        ref={(m: LeafletMap | null) => {
          // Force a tile refresh after mount because the container starts at
          // 0px during the initial paint inside a hidden parent.
          if (m) m.invalidateSize();
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <ClickHandler onPin={onPin} />
        <Recenter to={pin ?? center} />
        {pin && (
          <Marker
            position={[pin.lat, pin.lng]}
            icon={ICON}
            draggable
            ref={(m: LeafletMarker | null) => {
              markerRef.current = m;
            }}
            eventHandlers={{
              dragend() {
                const m = markerRef.current;
                if (!m) return;
                const ll = m.getLatLng();
                onPin({ lat: ll.lat, lng: ll.lng });
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}

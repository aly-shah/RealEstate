"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip } from "react-leaflet";
import type { MapMarker } from "./MapView";

// Status → marker colour (matches the app's status palette).
const COLOR: Record<string, string> = {
  AVAILABLE: "#2b7e5c",
  SOLD: "#c9a03d",
  RENTED: "#2c5f8a",
  RESERVED: "#c0842c",
  UNDER_NEGOTIATION: "#3b82f6",
  PENDING_VERIFICATION: "#8a99ae",
  INACTIVE: "#8a99ae",
};

const KARACHI: [number, number] = [24.86, 67.01];

function center(markers: MapMarker[]): [number, number] {
  if (markers.length === 0) return KARACHI;
  const lat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
  const lng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
  return [lat, lng];
}

interface LeafletMapProps {
  markers: MapMarker[];
  zoom?: number;
  single?: boolean;
}

export function LeafletMap({ markers, zoom, single = false }: LeafletMapProps) {
  return (
    <MapContainer
      center={center(markers)}
      zoom={zoom ?? (single ? 15 : 11)}
      scrollWheelZoom={!single}
      style={{ height: "100%", width: "100%" }}
      className="z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {markers.map((m) => (
        <CircleMarker
          key={m.id}
          center={[m.lat, m.lng]}
          radius={9}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: COLOR[m.status] ?? "#5a6a7e", fillOpacity: 0.95 }}
        >
          {!single && (
            <Tooltip direction="top" offset={[0, -6]}>
              {m.title}
            </Tooltip>
          )}
          <Popup>
            <div style={{ minWidth: 180 }}>
              <p style={{ margin: 0, fontWeight: 600, color: "#1a1f36" }}>{m.title}</p>
              <p style={{ margin: "2px 0", fontSize: 12, color: "#5a6a7e" }}>
                {m.reference} · {m.status.replace(/_/g, " ").toLowerCase()}
              </p>
              {m.price && <p style={{ margin: "2px 0", fontWeight: 600, color: "#2c5f8a" }}>{m.price}</p>}
              <Link href={m.href} style={{ fontSize: 12, color: "#2c5f8a", fontWeight: 600 }}>
                View property →
              </Link>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip } from "react-leaflet";
import type { MapMarker } from "./MapView";
import { COLORS, STATUS_COLOR } from "@/lib/theme";

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
          pathOptions={{
            color: COLORS.paper,
            weight: 2,
            fillColor: STATUS_COLOR[m.status] ?? COLORS.slate,
            fillOpacity: 0.95,
          }}
        >
          {!single && (
            <Tooltip direction="top" offset={[0, -6]}>
              {m.title}
            </Tooltip>
          )}
          <Popup>
            <div style={{ minWidth: 180 }}>
              <p style={{ margin: 0, fontWeight: 600, color: COLORS.ink }}>{m.title}</p>
              <p style={{ margin: "2px 0", fontSize: 12, color: COLORS.slate }}>
                {m.reference} · {m.status.replace(/_/g, " ").toLowerCase()}
              </p>
              {m.price && <p style={{ margin: "2px 0", fontWeight: 600, color: COLORS.accent }}>{m.price}</p>}
              <Link href={m.href} style={{ fontSize: 12, color: COLORS.accent, fontWeight: 600 }}>
                View property →
              </Link>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

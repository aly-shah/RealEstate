"use client";

import dynamic from "next/dynamic";

export interface MapMarker {
  id: string;
  title: string;
  reference: string;
  lat: number;
  lng: number;
  status: string;
  price: string;
  href: string;
}

// Leaflet touches `window` at import time, so load it client-only.
const LeafletMap = dynamic(() => import("./LeafletMap").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-subtle" />,
});

interface MapViewProps {
  markers: MapMarker[];
  height?: number | string;
  zoom?: number;
  single?: boolean;
}

export function MapView({ markers, height = 520, zoom, single }: MapViewProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-line" style={{ height }}>
      <LeafletMap markers={markers} zoom={zoom} single={single} />
    </div>
  );
}

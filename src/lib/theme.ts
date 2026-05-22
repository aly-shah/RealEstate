/**
 * Single source of truth for raw color values used outside Tailwind classes
 * (chart libraries, Leaflet, inline SVG fills). Tailwind utilities still drive
 * everything else — keep these in sync with `:root` tokens in globals.css.
 */
export const COLORS = {
  // Brand / accent
  accent: "#4f46e5",
  accentSoft: "#4338ca",
  accentWash: "#eef2ff",
  accentLine: "#c7d2fe",
  cyan: "#0ea5e9", // gradient end-stop

  // Ink / text
  ink: "#0f172a",
  inkSoft: "#1e293b",
  slate: "#475569",
  muted: "#94a3b8",

  // Surfaces / borders
  paper: "#ffffff",
  canvas: "#f6f7fb",
  subtle: "#eff1f6",
  line: "#e6e8ef",

  // Status
  ok: "#15803d",
  okBg: "#ecfdf5",
  warn: "#b45309",
  warnBg: "#fff7ed",
  danger: "#b91c1c",
  dangerBg: "#fef2f2",
  gold: "#b88a2a",
  goldBg: "#fdf3d9",
} as const;

/** Status-enum → hex (for Leaflet markers and similar). */
export const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: COLORS.ok,
  UNDER_NEGOTIATION: COLORS.accent,
  RESERVED: COLORS.warn,
  RENTED: COLORS.accentSoft,
  SOLD: COLORS.gold,
  PENDING_VERIFICATION: COLORS.muted,
  INACTIVE: COLORS.muted,
};

/** Map legend (uses the same hexes the markers do). */
export const MAP_LEGEND: ReadonlyArray<{ label: string; color: string }> = [
  { label: "Available",         color: STATUS_COLOR.AVAILABLE },
  { label: "Under negotiation", color: STATUS_COLOR.UNDER_NEGOTIATION },
  { label: "Reserved",          color: STATUS_COLOR.RESERVED },
  { label: "Rented",            color: STATUS_COLOR.RENTED },
  { label: "Sold",              color: STATUS_COLOR.SOLD },
];

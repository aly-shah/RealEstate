import type { SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "home"
  | "map-pin"
  | "target"
  | "exchange"
  | "calendar"
  | "flag"
  | "percent"
  | "banknote"
  | "users"
  | "store"
  | "document"
  | "bar-chart"
  | "activity"
  | "bell"
  | "settings"
  | "building"
  | "search"
  | "check"
  | "alert"
  | "plus"
  | "trophy"
  | "wallet"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "power"
  | "arrow-right"
  | "refresh"
  | "menu";

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  home: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M12 21s-7-7.2-7-12a7 7 0 1 1 14 0c0 4.8-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  exchange: (
    <>
      <path d="M4 8h14" />
      <path d="m15 5 3 3-3 3" />
      <path d="M20 16H6" />
      <path d="m9 13-3 3 3 3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <circle cx="8" cy="15" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="15" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12.5l-2 3.5L17.5 11H5" />
    </>
  ),
  percent: (
    <>
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
      <path d="M19 5 5 19" />
    </>
  ),
  banknote: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v.01" />
      <path d="M18 14.5v.01" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20.5c0-3.3 3-5.5 6.5-5.5s6.5 2.2 6.5 5.5" />
      <path d="M16 12.5a3.5 3.5 0 0 0 0-7" />
      <path d="M21.5 20.5c0-2.4-1.8-4.2-4.5-4.9" />
    </>
  ),
  store: (
    <>
      <path d="M3.5 6.5 5 3.5h14l1.5 3" />
      <path d="M3.5 6.5v2a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 1.5-.5V6.5" />
      <path d="M5 11v9.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V11" />
      <path d="M10 21.5V15h4v6.5" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  "bar-chart": (
    <>
      <path d="M4 21V4" />
      <path d="M4 21h17" />
      <rect x="7"  y="11" width="3" height="7" rx="0.5" />
      <rect x="12" y="7"  width="3" height="11" rx="0.5" />
      <rect x="17" y="14" width="3" height="4" rx="0.5" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l2.5-7 5 14 2.5-7H21" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0v4l1.5 3h-15L6 13V9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 7h2 M14 7h2 M8 11h2 M14 11h2 M8 15h2 M14 15h2" />
      <path d="M10 21v-3h4v3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 3h8v4a4 4 0 0 1-8 0z" />
      <path d="M8 5H5a2 2 0 0 0 0 4h3" />
      <path d="M16 5h3a2 2 0 0 1 0 4h-3" />
      <path d="M10 13h4v4l-2 2-2-2z" />
      <path d="M9 21h6" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12.5h3" />
      <path d="M3 9h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5" />
    </>
  ),
  "chevron-left":  <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "chevron-down":  <path d="m6 9 6 6 6-6" />,
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M18.4 5.6a9 9 0 1 1-12.7 0" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  className?: string;
}

/**
 * Single-source SVG icon set. Stroke-based, inherits `currentColor`,
 * sized via Tailwind classes from the caller.
 */
export function Icon({ name, className = "h-[1.1em] w-[1.1em]", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Heading shown in the drawer's sticky header. */
  title?: ReactNode;
  /** Optional sub-line under the title. */
  description?: ReactNode;
  /** Panel width on desktop. Mobile is always full-width. */
  width?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
}

const WIDTHS: Record<NonNullable<DrawerProps["width"]>, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
};

/**
 * A right-side sliding panel (drawer) used for all the app's create/edit forms.
 *
 * Slides in from the inline-end edge — physically the right in LTR, the left in
 * RTL (Urdu) — so it always enters from the side the user reads toward. Handles
 * the full modal contract: a fading backdrop, Escape-to-close, and background
 * scroll-lock while open. Portalled to <body> so parent stacking contexts never
 * clip it. The slide-in is a pure CSS animation (see .pz-drawer in globals.css).
 */
export function Drawer({ open, onClose, title, description, width = "md", children }: DrawerProps) {
  // Escape to close + lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Forms always start closed, so this never renders on the server.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div onClick={onClose} aria-hidden className="pz-overlay absolute inset-0 bg-ink/40 backdrop-blur-sm" />

      {/* Panel — pinned to the inline-end edge, slides in from off-screen. */}
      <div className={`pz-drawer absolute inset-y-0 end-0 flex w-full ${WIDTHS[width]} flex-col bg-paper shadow-[var(--shadow-pop)]`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h3 className="truncate text-base font-semibold text-ink">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="btn-ghost h-8 w-8 shrink-0 p-0">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="pz-scroll flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

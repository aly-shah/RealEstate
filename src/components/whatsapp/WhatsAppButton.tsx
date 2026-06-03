import { waMeLink } from "@/lib/whatsapp";

/** Brand-green when clickable; muted/disabled when no phone or no message. */
const ACTIVE = "border-[#25D366]/30 bg-[#25D36610] text-[#0a8a4a] hover:bg-[#25D36625]";
const DISABLED = "border-line bg-line-soft text-muted cursor-not-allowed";

interface WhatsAppButtonProps {
  phone: string | null | undefined;
  message: string;
  /** Default label is "WhatsApp"; override for "WhatsApp client" etc. */
  label?: string;
  size?: "sm" | "md";
}

/**
 * Server component that renders a wa.me link with a WhatsApp glyph + label.
 * Opens in a new tab. When the phone can't be normalised, the button still
 * renders (so the UI doesn't shift around) but is visually disabled and the
 * tooltip explains why.
 */
export function WhatsAppButton({ phone, message, label = "WhatsApp", size = "sm" }: WhatsAppButtonProps) {
  const href = waMeLink(phone, message);
  const sizing = size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs";

  if (!href) {
    return (
      <span
        title="No usable phone number on file"
        className={`inline-flex items-center gap-1.5 rounded-full border ${sizing} ${DISABLED}`}
      >
        <WhatsAppGlyph />
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium transition ${sizing} ${ACTIVE}`}
    >
      <WhatsAppGlyph />
      {label}
    </a>
  );
}

/** Inline SVG glyph — avoids adding it to the project icon set since it's
 *  the only place we render a brand mark from a third party. */
function WhatsAppGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.5 1.33 5.01L2 22l5.16-1.35a9.96 9.96 0 0 0 4.88 1.27c5.52 0 10-4.48 10-10s-4.48-10-10-9.92Zm5.86 14.13c-.25.7-1.22 1.34-1.83 1.43-.49.07-1.12.1-1.81-.11-.42-.13-.95-.31-1.64-.6-2.88-1.25-4.76-4.16-4.9-4.35-.14-.19-1.17-1.55-1.17-2.96 0-1.41.74-2.1.99-2.39.26-.29.56-.36.74-.36h.54c.17 0 .4-.06.62.47.25.6.85 2.07.93 2.22.07.15.12.32.02.51-.1.19-.15.31-.29.48-.14.17-.3.39-.43.52-.14.14-.29.29-.13.57.16.29.74 1.22 1.59 1.98 1.09.97 2 1.27 2.29 1.41.29.14.46.12.63-.07.18-.2.73-.85.92-1.14.19-.29.39-.24.65-.14.27.1 1.72.81 2.02.96.29.14.49.22.56.34.07.13.07.74-.18 1.45Z" />
    </svg>
  );
}

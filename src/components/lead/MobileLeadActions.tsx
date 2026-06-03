import { waMeLink } from "@/lib/whatsapp";

/**
 * Fixed bottom action bar shown on the lead detail page on phones only
 * (`<lg`). Three primary tasks an agent does in the field:
 *   1. Call the client
 *   2. WhatsApp them (uses the same prefilled template as the header button)
 *   3. Record a visit (deep-link to /visits, which pre-fills the property
 *      via the lead's linked property when available)
 *
 * Sits *above* the AgentBottomNav (z-30) at z-25 so the nav stays in click
 * range. Each button is full-width-divided so thumb reach is even.
 */
export function MobileLeadActions({
  phone,
  whatsappMessage,
  propertyId,
}: {
  phone: string | null | undefined;
  whatsappMessage: string;
  propertyId: string | null;
}) {
  const tel = phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : null;
  const wa = waMeLink(phone, whatsappMessage);

  return (
    <nav
      // Sit above the agent bottom-nav (which is z-30) so we don't collide;
      // pb-14 on the page main is enough headroom for both stacked bars.
      aria-label="Lead quick actions"
      className="fixed inset-x-0 bottom-[3.75rem] z-30 border-t border-line/70 bg-paper/90 backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-3 divide-x divide-line">
        <ActionLink
          href={tel}
          label="Call"
          glyph={
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />
            </svg>
          }
        />
        <ActionLink
          href={wa}
          label="WhatsApp"
          openInNewTab
          accent="ok"
          glyph={
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.5 1.33 5.01L2 22l5.16-1.35a9.96 9.96 0 0 0 4.88 1.27c5.52 0 10-4.48 10-10s-4.48-10-10-9.92Z" />
            </svg>
          }
        />
        <ActionLink
          href={propertyId ? `/visits?property=${propertyId}` : "/visits"}
          label="Visit"
          glyph={
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 21V4" />
              <path d="M5 4h12.5l-2 3.5L17.5 11H5" />
            </svg>
          }
        />
      </div>
    </nav>
  );
}

function ActionLink({
  href,
  label,
  glyph,
  openInNewTab,
  accent = "default",
}: {
  href: string | null;
  label: string;
  glyph: React.ReactNode;
  openInNewTab?: boolean;
  accent?: "default" | "ok";
}) {
  const colour = accent === "ok" ? "text-ok" : "text-ink";
  if (!href) {
    return (
      <span
        title="Not available"
        className="flex flex-col items-center justify-center gap-0.5 py-3 text-xs text-muted"
      >
        {glyph}
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      {...(openInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`flex flex-col items-center justify-center gap-0.5 py-3 text-xs font-medium ${colour} transition active:bg-line-soft`}
    >
      {glyph}
      {label}
    </a>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { money, compactMoney, humanize, fmtDate } from "@/lib/format";
import { waMeLink, normalizePhone } from "@/lib/whatsapp";
import { publicMediaUrl } from "@/lib/share";
import { requestOrigin } from "@/lib/request-meta";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { MapView } from "@/components/map/MapView";
import { PublicGallery } from "@/components/property/PublicGallery";
import { CopyLinkButton } from "@/components/property/CopyLinkButton";
import { PropertyTelemetry } from "@/components/share/PropertyTelemetry";

// Client-safe projection: everything here is shown publicly. Note the absence
// of dealer/owner, leads, showings, deals, documents, agents, activity and
// commission — those never leave the office. `companyId` is selected only to
// fetch sibling listings for "You may also like"; it is never rendered.
const PUBLIC_SELECT = {
  id: true,
  companyId: true,
  reference: true,
  title: true,
  description: true,
  type: true,
  listingType: true,
  status: true,
  city: true,
  area: true,
  address: true,
  landmarks: true,
  latitude: true,
  longitude: true,
  salePrice: true,
  monthlyRent: true,
  deposit: true,
  negotiable: true,
  coveredArea: true,
  plotSize: true,
  areaUnit: true,
  bedrooms: true,
  bathrooms: true,
  floors: true,
  parking: true,
  yearBuilt: true,
  amenities: true,
  availableFrom: true,
  sharedById: true,
  media: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, caption: true } },
  company: { select: { name: true, logoUrl: true } },
} as const;

async function getShared(slug: string) {
  return prisma.property.findFirst({
    where: { shareSlug: slug, shareEnabled: true },
    select: PUBLIC_SELECT,
  });
}

type Shared = NonNullable<Awaited<ReturnType<typeof getShared>>>;

/** The one headline figure for a listing — sale price, monthly rent, or POR. */
function priceLineFor(p: Pick<Shared, "salePrice" | "monthlyRent">): string {
  if (p.salePrice != null) return money(p.salePrice);
  if (p.monthlyRent != null) return `${money(p.monthlyRent)} / month`;
  return "Price on request";
}

function areaLabel(p: Pick<Shared, "coveredArea" | "areaUnit">): string | null {
  if (p.coveredArea == null) return null;
  return `${p.coveredArea} ${humanize(p.areaUnit ?? "SQFT").toLowerCase()}`;
}

/**
 * The image a social/Open-Graph preview should lead with: the first photo,
 * else the first floor plan. Returned as the tokenised public proxy path so a
 * crawler can fetch it without a session. Null when the listing has no imagery.
 */
function coverMediaUrl(slug: string, media: Shared["media"]): string | null {
  const cover = media.find((m) => m.kind === "PHOTO") ?? media.find((m) => m.kind === "FLOOR_PLAN");
  return cover ? publicMediaUrl(slug, cover.id) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getShared(slug);
  if (!p) return { title: "Listing unavailable", robots: { index: false, follow: false }, description: null };

  // Listings are public, so let them be indexed — good for SEO. The <title>
  // leads with the property name (what people search for and what shows in the
  // browser tab / search result), followed by location and agency for context.
  const where = [p.area, p.city].filter(Boolean).join(", ");
  const title = [p.title, where].filter(Boolean).join(" — ");
  const description = [priceLineFor(p), where, p.title].filter(Boolean).join(" — ");
  const robots = { index: true, follow: true };

  // og:image / metadataBase need absolute URLs; there's no site-URL env var, so
  // derive the origin from the request. The cover goes through the public proxy,
  // which crawlers can fetch without a session.
  const origin = await requestOrigin();
  const cover = coverMediaUrl(slug, p.media);

  return {
    title,
    description,
    robots,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: {
      type: "website",
      title,
      description,
      siteName: p.company.name,
      ...(cover ? { images: [{ url: cover, alt: p.title }] } : {}),
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title,
      description,
      ...(cover ? { images: [cover] } : {}),
    },
  };
}

/** A single icon + value + label pill in the specs strip. */
function SpecPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{value}</span>
        <span className="block text-xs text-muted">{label}</span>
      </span>
    </div>
  );
}

/** A labelled fact in the "Good to know" card. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

/** Sibling listings for "You may also like". Scoped to the same company (so the
 *  tenant guard passes) and to publicly-shared, photographed listings only. */
async function getRelated(companyId: string, excludeId: string) {
  const rows = await prisma.property.findMany({
    where: {
      companyId,
      shareEnabled: true,
      id: { not: excludeId },
      shareSlug: { not: null },
      media: { some: { kind: "PHOTO" } },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      reference: true,
      title: true,
      type: true,
      listingType: true,
      city: true,
      area: true,
      salePrice: true,
      monthlyRent: true,
      bedrooms: true,
      bathrooms: true,
      coveredArea: true,
      areaUnit: true,
      shareSlug: true,
      media: { where: { kind: "PHOTO" }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
    },
  });
  return rows;
}

type Related = Awaited<ReturnType<typeof getRelated>>[number];

function RelatedCard({ p }: { p: Related }) {
  const slug = p.shareSlug!;
  const cover = p.media[0] ? publicMediaUrl(slug, p.media[0].id) : null;
  const location = [p.area, p.city].filter(Boolean).join(", ");
  const tag = `${humanize(p.type)} for ${humanize(p.listingType).toLowerCase()}${location ? ` · ${location}` : ""}`;
  const area = areaLabel(p);
  return (
    <Link
      href={`/p/${slug}`}
      className="group overflow-hidden rounded-2xl border border-line bg-paper transition hover:shadow-lg"
    >
      <div className="aspect-[16/10] w-full overflow-hidden bg-canvas">
        {cover ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={cover} alt={p.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted">
            <Icon name="building" className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{tag}</p>
        <h3 className="truncate text-sm font-semibold text-ink">{p.title}</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {p.bedrooms != null && <span>{p.bedrooms} bed</span>}
          {p.bathrooms != null && <span>{p.bathrooms} bath</span>}
          {area && <span>{area}</span>}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-semibold text-slate-900">{priceLineFor(p)}</span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate">
            View details <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default async function PublicPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { slug } = await params;
  // Personalised share links may carry a client token (?c=<clientId>) so a view
  // can be attributed to a known contact. Validated server-side in the track
  // endpoint against the listing's tenant before it's persisted.
  const { c: clientId } = await searchParams;
  const p = await getShared(slug);

  if (!p) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas px-6">
        <div className="surface max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-ink">This listing isn’t available</h1>
          <p className="mt-2 text-sm text-muted">
            The link may have been turned off or has expired. Please ask the agent who shared it for an updated link.
          </p>
        </div>
      </div>
    );
  }

  const [agent, related] = await Promise.all([
    p.sharedById
      ? prisma.user.findUnique({ where: { id: p.sharedById }, select: { name: true, phone: true } })
      : Promise.resolve(null),
    getRelated(p.companyId, p.id),
  ]);

  const location = [p.area, p.city].filter(Boolean).join(", ");
  const priceLine = priceLineFor(p);
  const subtitle = `${humanize(p.type)} · For ${humanize(p.listingType).toLowerCase()}`;

  // All media goes through the token proxy by id — the raw upload URL is never
  // sent to the client. Photos & floor plans show in the gallery; videos &
  // brochures (external links or PDFs) show as "open" attachments.
  const images = p.media
    .filter((m) => m.kind === "PHOTO" || m.kind === "FLOOR_PLAN")
    .map((m) => ({ id: m.id, src: publicMediaUrl(slug, m.id), caption: m.caption }));
  const attachments = p.media
    .filter((m) => m.kind === "VIDEO" || m.kind === "BROCHURE")
    .map((m) => ({ id: m.id, kind: m.kind, caption: m.caption, href: publicMediaUrl(slug, m.id) }));

  const contactMsg = `Hi, I'm interested in "${p.title}" (${p.reference}).`;
  const wa = agent?.phone ? waMeLink(agent.phone, contactMsg) : null;
  const tel = agent?.phone ? normalizePhone(agent.phone) : null;

  const hasGoodToKnow =
    p.deposit != null || p.availableFrom != null || p.yearBuilt != null || p.floors != null || p.plotSize != null;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Invisible, deferred view beacon — records a tracked view after a dwell. */}
      <PropertyTelemetry slug={slug} clientId={clientId ?? null} />
      <div className="h-1 w-full bg-slate-900" aria-hidden />

      {/* Branded header */}
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {p.company.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={p.company.logoUrl} alt={p.company.name} className="h-9 w-auto" />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
                {p.company.name.charAt(0)}
              </span>
            )}
            <span className="truncate text-lg font-semibold tracking-tight text-ink">{p.company.name}</span>
          </div>
          <CopyLinkButton title={`${p.title}${location ? ` — ${location}` : ""}`} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* ── Main column ─────────────────────────────────────────── */}
          <div className="space-y-6 lg:col-span-2">
            {images.length > 0 ? (
              <PublicGallery images={images} />
            ) : (
              <div className="grid aspect-[16/10] w-full place-items-center rounded-2xl border border-line bg-paper text-muted">
                <div className="text-center">
                  <Icon name="building" className="mx-auto h-10 w-10" />
                  <p className="mt-2 text-sm">No photos yet</p>
                </div>
              </div>
            )}

            {/* Specs strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SpecPill icon={<BedIcon />} label="Bedrooms" value={p.bedrooms} />
              <SpecPill icon={<BathIcon />} label="Bathrooms" value={p.bathrooms} />
              <SpecPill icon={<AreaIcon />} label="Covered area" value={areaLabel(p)} />
              <SpecPill icon={<CarIcon />} label="Parking" value={p.parking} />
            </div>

            {/* Good to know */}
            {hasGoodToKnow && (
              <section className="rounded-2xl border border-line bg-paper p-5">
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Fact label="Deposit" value={p.deposit != null ? money(p.deposit) : null} />
                  <Fact label="Negotiable" value={p.salePrice != null || p.monthlyRent != null ? (p.negotiable ? "Yes" : "No") : null} />
                  <Fact label="Plot size" value={p.plotSize != null ? `${p.plotSize} ${humanize(p.areaUnit ?? "SQFT").toLowerCase()}` : null} />
                  <Fact label="Floors" value={p.floors} />
                  <Fact label="Year built" value={p.yearBuilt} />
                  <Fact label="Available from" value={p.availableFrom ? fmtDate(p.availableFrom) : null} />
                </div>
              </section>
            )}

            {/* About */}
            <section>
              <h2 className="text-xl font-semibold tracking-tight text-ink">{p.title}</h2>
              {location && <p className="mt-1 text-sm text-slate">{location}</p>}
              {p.description && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate">{p.description}</p>
              )}
              {p.landmarks && (
                <p className="mt-3 text-sm text-muted">
                  <span className="font-medium text-slate">Nearby:</span> {p.landmarks}
                </p>
              )}
            </section>

            {/* Amenities */}
            {p.amenities.length > 0 && (
              <section>
                <h2 className="mb-3 text-base font-semibold text-ink">What this place offers</h2>
                <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                  {p.amenities.map((a) => (
                    <div key={a} className="flex items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                        <Icon name="check" className="h-4 w-4" />
                      </span>
                      <span className="text-sm text-slate">{a}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {attachments.map((a) => (
                  <a
                    key={a.id}
                    href={a.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="surface flex items-center gap-3 p-3 transition hover:border-slate-300"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700">
                      <Icon name={a.kind === "VIDEO" ? "activity" : "document"} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{a.caption || humanize(a.kind)}</span>
                      <span className="block text-xs text-muted">{a.kind === "VIDEO" ? "Watch video" : "View brochure"}</span>
                    </span>
                  </a>
                ))}
              </div>
            )}

            {/* Location / map */}
            {p.latitude != null && p.longitude != null && (
              <section>
                <h2 className="mb-3 text-base font-semibold text-ink">Location</h2>
                {location && <p className="mb-3 text-sm text-muted">{location}</p>}
                <div className="overflow-hidden rounded-2xl border border-line">
                  <MapView
                    single
                    height={300}
                    markers={[{
                      id: p.id,
                      title: p.title,
                      reference: p.reference,
                      lat: p.latitude,
                      lng: p.longitude,
                      status: p.status,
                      price: p.salePrice != null ? compactMoney(p.salePrice) : p.monthlyRent != null ? `${compactMoney(p.monthlyRent)}/mo` : "",
                      href: "#",
                    }]}
                  />
                </div>
              </section>
            )}
          </div>

          {/* ── Sticky contact / price rail ─────────────────────────── */}
          <aside className="lg:col-span-1">
            <div className="lg:sticky lg:top-6">
              <div className="rounded-2xl border border-line bg-paper p-5 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{p.reference}</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">{location || p.title}</h1>
                <p className="mt-1 text-sm text-muted">{subtitle}</p>
                <div className="mt-3">
                  <StatusBadge status={p.status} />
                </div>

                <div className="my-4 border-t border-line" />

                <p className="text-2xl font-semibold text-slate-900">{priceLine}</p>
                {p.negotiable && (p.salePrice != null || p.monthlyRent != null) && (
                  <p className="mt-0.5 text-xs text-muted">Negotiable</p>
                )}

                <div className="my-4 border-t border-line" />

                <h2 className="text-sm font-semibold text-ink">Interested in this property?</h2>
                <p className="mt-1 text-sm text-muted">
                  {agent?.name ? `Reach out to ${agent.name} to arrange a viewing.` : "Contact the agent to arrange a viewing."}
                </p>

                <div className="mt-4 grid gap-2">
                  {wa && (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      <WhatsAppIcon /> WhatsApp
                    </a>
                  )}
                  {tel && (
                    <a
                      href={`tel:${tel}`}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      <PhoneIcon /> Call
                    </a>
                  )}
                  <CopyLinkButton title={`${p.title}${location ? ` — ${location}` : ""}`} fullWidth />
                  {!wa && !tel && (
                    <p className="rounded-xl border border-line bg-canvas px-3 py-2 text-center text-xs text-muted">
                      Contact details available from the agent who shared this link.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* ── You may also like ───────────────────────────────────── */}
        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold tracking-tight text-ink">You may also like</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <RelatedCard key={r.id} p={r} />
              ))}
            </div>
          </section>
        )}

        <footer className="pb-8 pt-10 text-center text-xs text-muted">
          {p.company.name}
        </footer>
      </main>
    </div>
  );
}

/* ── Inline icons (kept local; the shared Icon set has no domestic/contact set) ── */
const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-4 w-4",
};

function BedIcon() {
  return (
    <svg {...svgProps}>
      <path d="M2 8v9M2 17h20M22 12v5M2 12h20a0 0 0 0 1 0 0" />
      <path d="M2 12v-1a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v1" />
      <path d="M7 8V7a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1M12.5 8V7a1 1 0 0 1 1-1H16a1 1 0 0 1 1 1v1" />
    </svg>
  );
}
function BathIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 12V6a2 2 0 0 1 2-2h.5a2 2 0 0 1 2 2M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-2ZM6 12h3M6.5 19l-1 2M17.5 19l1 2" />
    </svg>
  );
}
function AreaIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}
function CarIcon() {
  return (
    <svg {...svgProps}>
      <path d="M5 11l1.6-3.9A2 2 0 0 1 8.45 6h7.1a2 2 0 0 1 1.85 1.1L19 11M4 11h16v5h-2v1a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H9v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1H4v-5Z" />
      <path d="M7 14h.01M17 14h.01" />
    </svg>
  );
}
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.16c-.24.68-1.42 1.32-1.96 1.36-.5.05-.98.24-3.3-.69-2.78-1.09-4.55-3.94-4.69-4.12-.14-.18-1.12-1.49-1.12-2.84 0-1.35.71-2.02.96-2.29.24-.27.53-.34.71-.34.18 0 .36 0 .51.01.16.01.39-.06.6.46.24.57.79 1.96.86 2.1.07.14.12.3.02.48-.09.18-.14.29-.28.45-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.27.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.21 1.37.27.14.43.12.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.6-.14.24.09 1.55.73 1.82.86.27.14.45.2.51.32.07.11.07.64-.17 1.32Z" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg {...svgProps}>
      <path d="M6.5 3.5A1.6 1.6 0 0 0 5 4.5C4 5.5 3.4 7 4.4 9.8a15.6 15.6 0 0 0 9.8 9.8c2.8 1 4.3.4 5.3-.6.4-.4.7-1 .5-1.6l-.5-2a1.4 1.4 0 0 0-1.6-1l-2.2.4a1.4 1.4 0 0 1-1.3-.4l-2.6-2.6a1.4 1.4 0 0 1-.4-1.3l.4-2.2a1.4 1.4 0 0 0-1-1.6l-2-.5a1.5 1.5 0 0 0-.3 0Z" />
    </svg>
  );
}

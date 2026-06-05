import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { money, compactMoney, humanize, fmtDate } from "@/lib/format";
import { waMeLink, normalizePhone } from "@/lib/whatsapp";
import { publicMediaUrl } from "@/lib/share";
import { requestOrigin } from "@/lib/request-meta";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { MapView } from "@/components/map/MapView";
import { PublicGallery } from "@/components/property/PublicGallery";

// Client-safe projection: everything here is shown publicly. Note the absence
// of dealer/owner, leads, showings, deals, documents, agents, activity and
// commission — those never leave the office.
const PUBLIC_SELECT = {
  id: true,
  reference: true,
  title: true,
  description: true,
  type: true,
  listingType: true,
  status: true,
  city: true,
  area: true,
  address: true,
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
  availableFrom: true,
  sharedById: true,
  media: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, caption: true } },
  company: { select: { name: true, logoUrl: true, brandColor: true } },
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
  // Private share links: never let search engines index a client's listing.
  const robots = { index: false, follow: false };
  if (!p) return { title: "Listing unavailable", robots, description: null };

  // Override the platform's default SaaS description with this listing's own.
  // Lead the preview with the price — it's what makes a pasted WhatsApp/social
  // link worth tapping.
  const where = [p.area, p.city].filter(Boolean).join(", ");
  const title = `${p.title} · ${p.company.name}`;
  const description = [priceLineFor(p), where, p.title].filter(Boolean).join(" — ");

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

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

export default async function PublicPropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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

  const agent = p.sharedById
    ? await prisma.user.findUnique({ where: { id: p.sharedById }, select: { name: true, phone: true } })
    : null;

  const accent = p.company.brandColor || "#4f46e5";
  const location = [p.area, p.city].filter(Boolean).join(", ");
  const priceLine = priceLineFor(p);

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

  return (
    <div className="min-h-screen bg-canvas">
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden />

      {/* Branded header */}
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          {p.company.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={p.company.logoUrl} alt={p.company.name} className="h-9 w-auto" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ backgroundColor: accent }}>
              {p.company.name.charAt(0)}
            </span>
          )}
          <span className="text-lg font-semibold tracking-tight text-ink">{p.company.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-5 py-6">
        {/* Title + price */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{p.reference}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">{p.title}</h1>
            {location && <p className="mt-1 text-sm text-slate">{location}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold" style={{ color: accent }}>{priceLine}</p>
            <div className="mt-1 flex items-center justify-end gap-2">
              {p.negotiable && p.salePrice != null && <span className="text-xs text-muted">Negotiable</span>}
              <StatusBadge status={p.status} />
            </div>
          </div>
        </div>

        {images.length > 0 && <PublicGallery images={images} />}

        {attachments.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {attachments.map((a) => (
              <a
                key={a.id}
                href={a.href}
                target="_blank"
                rel="noopener noreferrer"
                className="surface flex items-center gap-3 p-3 transition hover:border-accent/40"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-wash text-accent">
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

        {/* Key specs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Spec label="Type" value={humanize(p.type)} />
          <Spec label="Purpose" value={humanize(p.listingType)} />
          <Spec label="Bedrooms" value={p.bedrooms} />
          <Spec label="Bathrooms" value={p.bathrooms} />
          <Spec label="Covered area" value={p.coveredArea ? `${p.coveredArea} ${humanize(p.areaUnit ?? "SQFT").toLowerCase()}` : null} />
          <Spec label="Parking" value={p.parking} />
          <Spec label="Floors" value={p.floors} />
          <Spec label="Year built" value={p.yearBuilt} />
          <Spec label="Deposit" value={p.deposit != null ? money(p.deposit) : null} />
          <Spec label="Available from" value={p.availableFrom ? fmtDate(p.availableFrom) : null} />
        </div>

        {p.description && (
          <section className="surface p-5">
            <h2 className="mb-2 text-sm font-semibold text-ink">About this property</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate">{p.description}</p>
          </section>
        )}

        {p.latitude != null && p.longitude != null && (
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Location</h2>
            {location && <p className="mb-3 text-sm text-muted">{location}</p>}
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
          </section>
        )}

        {/* Contact */}
        {(wa || tel) && (
          <section className="surface flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="text-sm font-semibold text-ink">Interested?</h2>
              <p className="text-sm text-muted">{agent?.name ? `Contact ${agent.name}` : "Contact the agent"} about this property.</p>
            </div>
            <div className="flex gap-2">
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-primary">WhatsApp</a>
              )}
              {tel && (
                <a href={`tel:${tel}`} className="btn-ghost">Call</a>
              )}
            </div>
          </section>
        )}

        <footer className="pb-8 pt-2 text-center text-xs text-muted">
          {p.company.name}
        </footer>
      </main>
    </div>
  );
}

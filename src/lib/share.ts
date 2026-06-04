import { randomBytes } from "node:crypto";
import type { PropertyMedia } from "@prisma/client";

/**
 * An unguessable token for a property's public share link. 12 random bytes →
 * 16 url-safe chars (~96 bits), so links can't be enumerated or brute-forced.
 * Distinct from the property id, which we never expose publicly.
 */
export function newShareSlug(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * Rewrites a stored media URL to its tokenised public proxy. Stored URLs look
 * like `/api/files/<companyId>/<...>` and require an authenticated, same-tenant
 * session; the proxy at `/api/public/property-media/<slug>/<mediaId>` instead
 * authorises purely by the share token, so a client can load only the photos of
 * the one property that was shared with them.
 */
export function publicMediaUrl(slug: string, mediaId: string): string {
  return `/api/public/property-media/${slug}/${mediaId}`;
}

/** Client-safe shape of a media item for the public listing gallery. */
export interface PublicMedia {
  id: string;
  url: string;
  kind: PropertyMedia["kind"];
  caption: string | null;
}

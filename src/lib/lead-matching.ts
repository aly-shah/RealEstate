import type { Prisma, ListingType, PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/activity";
import { toNumber } from "@/lib/format";

export interface PropertyMatch {
  id: string;
  reference: string;
  title: string;
  area: string | null;
  type: PropertyType;
  listingType: ListingType;
  salePrice: number;
  monthlyRent: number;
  /** 0-100 strength tag — sum of matched signals scaled to %. */
  score: number;
  /** Short chips for the UI ("Same area", "Within budget"). */
  reasons: string[];
}

interface MatchableLead {
  companyId: string;
  prefType: PropertyType | null;
  prefArea: string | null;
  budgetMin: Prisma.Decimal | number | null;
  budgetMax: Prisma.Decimal | number | null;
  /** Already-linked property id; surfaced so the caller can filter it out. */
  propertyId: string | null;
}

/**
 * Suggest up to `take` properties that fit the lead's preferences. The query
 * intentionally OVER-fetches (no hard filter on budget) so we can score
 * fuzzily and surface "almost" matches — a 5%-over-budget property is more
 * useful than nothing when nothing-exact matches.
 *
 * Status filter limits to actively sellable inventory: AVAILABLE plus the
 * transitional UNDER_NEGOTIATION / RESERVED in case the deal in progress
 * falls through.
 */
export async function findPropertyMatches(
  lead: MatchableLead,
  take = 5,
): Promise<PropertyMatch[]> {
  const min = lead.budgetMin != null ? toNumber(lead.budgetMin) : null;
  const max = lead.budgetMax != null ? toNumber(lead.budgetMax) : null;

  // Pre-filter cheaply at the DB layer; final ranking happens in JS where the
  // scoring rules live (easier to read + tweak than equivalent SQL).
  const candidates = await prisma.property.findMany({
    where: {
      companyId: lead.companyId,
      status: { in: ["AVAILABLE", "UNDER_NEGOTIATION", "RESERVED"] },
      ...(lead.propertyId ? { NOT: { id: lead.propertyId } } : {}),
      ...(lead.prefType ? { type: lead.prefType } : {}),
    },
    select: {
      id: true,
      reference: true,
      title: true,
      area: true,
      type: true,
      listingType: true,
      salePrice: true,
      monthlyRent: true,
    },
    // Wider than `take` so the in-JS scorer has room to discard duds.
    take: take * 6,
    orderBy: { createdAt: "desc" },
  });

  const wantArea = lead.prefArea?.trim().toLowerCase();
  const scored = candidates.map((p): PropertyMatch => {
    const reasons: string[] = [];
    let pts = 0;

    if (lead.prefType && p.type === lead.prefType) {
      pts += 30;
      reasons.push("Same type");
    }

    if (wantArea && p.area?.toLowerCase().includes(wantArea)) {
      pts += 30;
      reasons.push(`In ${p.area}`);
    }

    // Budget check: prefer salePrice when listing supports SALE; otherwise
    // compare against monthlyRent.
    const price = toNumber(p.salePrice) || toNumber(p.monthlyRent);
    if (price > 0 && (min || max)) {
      const lo = min ?? 0;
      const hi = max ?? Number.POSITIVE_INFINITY;
      if (price >= lo && price <= hi) {
        pts += 30;
        reasons.push("Within budget");
      } else if (max && price <= max * 1.1) {
        // 10% over the ceiling — surface but tag it.
        pts += 12;
        reasons.push("Slightly above budget");
      } else if (min && price >= min * 0.85) {
        pts += 8;
        reasons.push("Below typical budget");
      }
    }

    // Bonus when the listing type lines up with the lead's likely intent —
    // budgetMax > 1cr looks like a sale buyer; smaller budgets often rent.
    // Cheap heuristic but useful when no explicit purpose is captured.
    const likelyIntent: ListingType | null =
      max != null ? (max >= 10_000_000 ? "SALE" : "RENT") : null;
    if (likelyIntent && (p.listingType === likelyIntent || p.listingType === "BOTH")) {
      pts += 8;
      reasons.push(`${likelyIntent === "SALE" ? "For sale" : "For rent"}`);
    }

    return {
      id: p.id,
      reference: p.reference,
      title: p.title,
      area: p.area,
      type: p.type,
      listingType: p.listingType,
      salePrice: toNumber(p.salePrice),
      monthlyRent: toNumber(p.monthlyRent),
      score: Math.min(100, pts),
      reasons,
    };
  });

  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, take);
}

// ─────────────────────────────────────────── reverse: new-listing → leads

export interface LeadMatch {
  leadId: string;
  agentId: string;
  clientName: string | null;
  score: number;
  reasons: string[];
}

interface MatchableProperty {
  companyId: string;
  type: PropertyType;
  area: string | null;
  listingType: ListingType;
  salePrice: Prisma.Decimal | number | null;
  monthlyRent: Prisma.Decimal | number | null;
}

// Only alert on genuinely strong matches (≈ two full signals) so a new listing
// doesn't spam every agent with a loosely-related lead.
const NEW_LISTING_ALERT_THRESHOLD = 50;

/**
 * The inverse of findPropertyMatches: given a freshly-added property, find the
 * ASSIGNED leads whose preferences it fits, using the same scoring weights.
 * Returns only matches at or above the alert threshold, best first.
 */
export async function findLeadMatchesForProperty(
  property: MatchableProperty,
  take = 10,
): Promise<LeadMatch[]> {
  const price = toNumber(property.salePrice) || toNumber(property.monthlyRent);
  const propArea = property.area?.trim().toLowerCase();

  const leads = await prisma.lead.findMany({
    where: {
      companyId: property.companyId,
      agentId: { not: null },
      stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
      // Cheap pre-filter: the lead either wants this type or has no type pref.
      OR: [{ prefType: property.type }, { prefType: null }],
    },
    select: {
      id: true,
      agentId: true,
      prefType: true,
      prefArea: true,
      budgetMin: true,
      budgetMax: true,
      client: { select: { name: true } },
    },
    take: 200,
  });

  const scored: LeadMatch[] = [];
  for (const l of leads) {
    const reasons: string[] = [];
    let pts = 0;

    if (l.prefType && l.prefType === property.type) {
      pts += 30;
      reasons.push("Type match");
    }

    const wantArea = l.prefArea?.trim().toLowerCase();
    if (wantArea && propArea && propArea.includes(wantArea)) {
      pts += 30;
      reasons.push("Area match");
    }

    const min = l.budgetMin != null ? toNumber(l.budgetMin) : null;
    const max = l.budgetMax != null ? toNumber(l.budgetMax) : null;
    if (price > 0 && (min || max)) {
      const lo = min ?? 0;
      const hi = max ?? Number.POSITIVE_INFINITY;
      if (price >= lo && price <= hi) {
        pts += 30;
        reasons.push("Within budget");
      } else if (max && price <= max * 1.1) {
        pts += 12;
        reasons.push("Slightly above budget");
      } else if (min && price >= min * 0.85) {
        pts += 8;
        reasons.push("Below typical budget");
      }
    }

    const likelyIntent: ListingType | null =
      max != null ? (max >= 10_000_000 ? "SALE" : "RENT") : null;
    if (likelyIntent && (property.listingType === likelyIntent || property.listingType === "BOTH")) {
      pts += 8;
    }

    const score = Math.min(100, pts);
    if (score >= NEW_LISTING_ALERT_THRESHOLD) {
      scored.push({ leadId: l.id, agentId: l.agentId!, clientName: l.client?.name ?? null, score, reasons });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, take);
}

/**
 * Fire-and-forget: when a property is added, notify the agents of any active
 * leads it strongly matches. Best-effort — swallows its own errors so it can't
 * fail property creation. Only alerts for sellable inventory.
 */
export async function alertAgentsOfNewListing(propertyId: string): Promise<number> {
  try {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        companyId: true,
        title: true,
        type: true,
        area: true,
        listingType: true,
        salePrice: true,
        monthlyRent: true,
        status: true,
      },
    });
    if (!property) return 0;
    if (!["AVAILABLE", "UNDER_NEGOTIATION", "RESERVED"].includes(property.status)) return 0;

    const matches = await findLeadMatchesForProperty(property);
    await Promise.all(
      matches.map((m) =>
        notify({
          companyId: property.companyId,
          userId: m.agentId,
          type: "GENERAL",
          title: `New listing matches ${m.clientName ?? "a lead"}`,
          body: `${property.title} fits their requirements (${m.reasons.join(", ")}).`,
          link: `/leads/${m.leadId}`,
        }),
      ),
    );
    return matches.length;
  } catch (err) {
    console.error(`[lead-matching] alertAgentsOfNewListing ${propertyId} failed:`, err);
    return 0;
  }
}

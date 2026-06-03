import type { Prisma, ListingType, PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

import { runAi } from "@/lib/ai/run";
import { tolerantJsonParse } from "@/lib/ai/handlers/whatsapp-classify";

/**
 * Generate a listing TITLE + DESCRIPTION for the Add-property form from the
 * attributes the agent has entered (type, purpose, area, rooms, size,
 * amenities, price). Routed through runAi so it inherits the per-plan budget
 * gate, the input-hash cache (re-clicking "Write with AI" with the same fields
 * is a free cache hit), and token accounting.
 *
 * Output is a single JSON object `{ title, description }`; we parse it with the
 * tolerant parser shared with the WhatsApp classifier (handles bare JSON,
 * fenced blocks, and prose-wrapped objects).
 */

const SYSTEM = `You write listing copy for a Pakistani real-estate brokerage CRM (Proptimizr).

Given a property's attributes, produce an accurate, appealing listing TITLE and DESCRIPTION.

Respond with a SINGLE JSON object and nothing else — no prose, no Markdown, no code fences:
  { "title": string, "description": string }

Rules:
- title: <= 70 characters, specific and attractive. Lead with the standout feature and include the type + location when known. Example: "Brand-New 3-Bed Apartment in DHA Phase 6, Karachi".
- description: 2-4 short sentences (<= 90 words), plain text only (no Markdown, no bullet points). Mention the type, location, size, rooms, and notable amenities. Professional, concrete Pakistani-market tone — not salesy clickbait.
- Use ONLY the attributes provided. NEVER invent prices, sizes, room counts, or amenities that were not given. Omit what isn't provided rather than guessing.
- Currency is PKR; keep areas in the unit provided (MARLA / KANAL / SQFT / etc.) — do not convert.
- If very little is provided, still write a natural, shorter title and description from what's there.`;

export interface PropertyCopyInput {
  companyId: string;
  type: string;
  listingType: string;
  city?: string | null;
  area?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  coveredArea?: number | null;
  plotSize?: number | null;
  areaUnit?: string | null;
  salePrice?: number | null;
  monthlyRent?: number | null;
  amenities?: string[];
}

export type PropertyCopyResult =
  | { ok: true; title: string; description: string }
  | { ok: false; reason: string };

export async function generatePropertyCopy(input: PropertyCopyInput): Promise<PropertyCopyResult> {
  // Only include fields that are actually set — empties would pollute both the
  // prompt and the cache key.
  const inputs: Record<string, unknown> = { type: input.type, purpose: input.listingType };
  if (input.city) inputs.city = input.city;
  if (input.area) inputs.area = input.area;
  if (input.bedrooms != null) inputs.bedrooms = input.bedrooms;
  if (input.bathrooms != null) inputs.bathrooms = input.bathrooms;
  if (input.coveredArea != null) inputs.coveredAreaSqft = input.coveredArea;
  if (input.plotSize != null) inputs.totalArea = `${input.plotSize} ${input.areaUnit ?? ""}`.trim();
  if (input.salePrice != null) inputs.salePricePKR = input.salePrice;
  if (input.monthlyRent != null) inputs.monthlyRentPKR = input.monthlyRent;
  if (input.amenities && input.amenities.length) inputs.amenities = input.amenities.join(", ");

  const res = await runAi({
    companyId: input.companyId,
    type: "PROPERTY_COPY",
    // No persisted property yet — key the cache on the company; the input hash
    // differentiates distinct attribute sets within it.
    entity: { type: "PROPERTY_DRAFT", id: input.companyId },
    system: SYSTEM,
    prompt: "Write a listing title and description for this property. Return JSON {title, description} only.",
    inputs,
    maxTokens: 500,
    cacheTtlMs: 10 * 60_000,
  });
  if (!res.ok) return res;

  const parsed = tolerantJsonParse(res.content) as { title?: unknown; description?: unknown } | null;
  const title = parsed && typeof parsed.title === "string" ? parsed.title.trim().slice(0, 120) : "";
  const description = parsed && typeof parsed.description === "string" ? parsed.description.trim().slice(0, 1200) : "";
  if (!title && !description) return { ok: false, reason: "AI returned an unexpected response — please try again." };
  return { ok: true, title, description };
}

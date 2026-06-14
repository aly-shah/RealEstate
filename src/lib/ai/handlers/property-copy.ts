import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AI_BUDGET } from "@/lib/ai/budget";
import { isAiConfigured, aiComplete } from "@/lib/ai/provider";

/**
 * Generate a listing TITLE + DESCRIPTION for the Add-property form from the
 * attributes the agent has entered (type, purpose, area, rooms, size,
 * amenities, price). Backed by OpenAI (see lib/ai/openai.ts).
 *
 * Self-contained — it does its own provider check, per-plan budget gate
 * (reusing AI_BUDGET), input-hash cache (re-clicking "Write with AI" with the
 * same fields is a free cache hit), and AiSuggestion persistence (which is the
 * budget counter). The Anthropic runAi pipeline and the other AI handlers are
 * left untouched.
 */

const SYSTEM = `You write listing copy for a Pakistani real-estate brokerage CRM (Proptimizr).

Given a property's attributes, produce an accurate, appealing listing TITLE and DESCRIPTION.

Respond with a SINGLE JSON object and nothing else:
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

const TTL_MS = 10 * 60_000;

export async function generatePropertyCopy(input: PropertyCopyInput): Promise<PropertyCopyResult> {
  // 1. Provider + master switch + plan-includes-AI gate.
  if (!isAiConfigured()) return { ok: false, reason: "AI features are not configured on this server." };
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { plan: true, aiEnabled: true },
  });
  if (!company) return { ok: false, reason: "Company not found." };
  if (!company.aiEnabled) return { ok: false, reason: "AI features are turned off for your workspace." };
  const limit = AI_BUDGET[company.plan];
  if (limit <= 0) return { ok: false, reason: "Your plan doesn't include AI features — upgrade to enable them." };

  // 2. Build the attribute map — only fields that are set (empties would
  //    pollute both the prompt and the cache key).
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

  const inputHash = createHash("sha256")
    .update(JSON.stringify({ s: SYSTEM, i: inputs }))
    .digest("hex");

  // 3. Cache: identical attributes within the freshness window reuse the row
  //    (no re-call, no budget burn).
  const cached = await prisma.aiSuggestion.findFirst({
    where: {
      companyId: input.companyId,
      type: "PROPERTY_COPY",
      entityType: "PROPERTY_DRAFT",
      entityId: input.companyId,
      inputHash,
      createdAt: { gte: new Date(Date.now() - TTL_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (cached) return parseCopy(cached.content);

  // 4. Monthly budget check (cache hits above don't count).
  if (Number.isFinite(limit)) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const used = await prisma.aiSuggestion.count({
      where: { companyId: input.companyId, createdAt: { gte: monthStart } },
    });
    if (used >= limit) {
      return { ok: false, reason: `Monthly AI limit reached (${used}/${limit}). It resets on the 1st.` };
    }
  }

  // 5. Call the model (Anthropic or OpenAI — see lib/ai/provider.ts). JSON mode
  //    on OpenAI; the SYSTEM prompt already instructs JSON-only either way.
  const context = Object.entries(inputs)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
  const res = await aiComplete({
    system: SYSTEM,
    user: `Write a listing title and description for this property. Return JSON {title, description} only.\n\n<context>\n${context}\n</context>`,
    maxTokens: 500,
    json: true,
  });
  if (!res.ok) return res;

  // 6. Persist (caches + counts toward the monthly budget).
  const content = res.text.length > 4_000 ? res.text.slice(0, 4_000) : res.text;
  await prisma.aiSuggestion.create({
    data: {
      companyId: input.companyId,
      type: "PROPERTY_COPY",
      entityType: "PROPERTY_DRAFT",
      entityId: input.companyId,
      content,
      inputHash,
      promptTokens: res.usage.promptTokens,
      completionTokens: res.usage.completionTokens,
      cachedTokens: res.usage.cachedTokens,
    },
  });

  return parseCopy(content);
}

/** Parse the model's JSON reply into a clamped {title, description}. */
function parseCopy(raw: string): PropertyCopyResult {
  let obj: { title?: unknown; description?: unknown } | null = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
  }
  const title = obj && typeof obj.title === "string" ? obj.title.trim().slice(0, 120) : "";
  const description = obj && typeof obj.description === "string" ? obj.description.trim().slice(0, 1200) : "";
  if (!title && !description) return { ok: false, reason: "AI returned an unexpected response — please try again." };
  return { ok: true, title, description };
}

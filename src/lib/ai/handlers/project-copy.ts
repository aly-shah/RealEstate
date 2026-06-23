import { runAi } from "@/lib/ai/run";

/**
 * AI description writer for the create-project wizard. Given what the developer
 * has entered — name, location, status, floors, amenities, the unit mix — it
 * drafts a concise, accurate marketing description the user can edit. Cached +
 * budget-gated via runAi (re-clicking with the same details is a free hit).
 */

export interface ProjectCopyInput {
  companyId: string;
  name: string;
  status?: string;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  totalFloors?: number | null;
  isOffPlan?: boolean;
  amenities?: string[];
  unitTypes?: { name: string; basePrice?: number | null }[];
  launchDate?: string | null;
  completionDate?: string | null;
}

export type ProjectCopyResult =
  | { ok: true; description: string; fromCache: boolean }
  | { ok: false; reason: string };

const SYSTEM = `You write marketing descriptions for a Pakistani real-estate DEVELOPER's project (a housing society, apartment tower, or mixed development) in the Proptimizr CRM.

Given the project's attributes, write ONE appealing, accurate description.

Respond with ONLY the description text — no Markdown, no headings, no bullet points, no quotes.

Rules:
- 3–5 short sentences (<= 110 words). Professional, concrete Pakistani-market tone — not salesy clickbait.
- Lead with what stands out (location, scale/floors, standout amenities, off-plan vs ready).
- Naturally weave in the location, the unit mix, and 2–4 notable amenities when provided.
- Use ONLY the attributes given. NEVER invent prices, unit counts, amenities, or facilities that were not provided. Omit what isn't given rather than guessing.
- Currency is PKR. If little is provided, still write a natural, shorter description from what's there.`;

export async function generateProjectCopy(input: ProjectCopyInput): Promise<ProjectCopyResult> {
  if (!input.name.trim()) return { ok: false, reason: "Add a project name first." };

  const facts = {
    name: input.name,
    status: input.status ?? null,
    location: [input.address, input.area, input.city].filter(Boolean).join(", ") || null,
    total_floors: input.totalFloors ?? null,
    off_plan: input.isOffPlan ? "under construction" : "ready",
    construction_start: input.launchDate ?? null,
    expected_completion: input.completionDate ?? null,
    amenities: input.amenities?.length ? input.amenities : null,
    unit_types: input.unitTypes?.length ? input.unitTypes.map((t) => ({ name: t.name, base_price_pkr: t.basePrice ?? null })) : null,
  };

  const res = await runAi({
    companyId: input.companyId,
    type: "PROPERTY_COPY",
    entity: { type: "PROJECT_COPY", id: input.name.slice(0, 60) },
    system: SYSTEM,
    prompt: "Write the project description from these attributes.",
    inputs: { project: JSON.stringify(facts) },
    maxTokens: 400,
    cacheTtlMs: 10 * 60_000,
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  const description = res.content.replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (!description) return { ok: false, reason: "AI returned an empty description — try again." };
  return { ok: true, description, fromCache: res.fromCache };
}

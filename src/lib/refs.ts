import { prisma } from "@/lib/prisma";

/**
 * Derive a property-reference prefix from a company name when no explicit
 * `Company.refPrefix` is set. Picks initials for multi-word names
 * ("Clifton Heights Realty" → "CHR"), or the first 3 letters of a
 * single-word name ("UrbanEdge" → "URB"). Strips non-Latin characters;
 * falls back to "PROP" (matches the Proptimizr platform default) if
 * nothing usable remains.
 */
export function derivePrefix(name: string | null | undefined): string {
  const words = (name ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "PROP";
  if (words.length === 1) {
    return (words[0].slice(0, 4) || "PROP").toUpperCase();
  }
  return words.map((w) => w[0]).join("").slice(0, 4).toUpperCase();
}

/**
 * Returns the company's effective property prefix. Reads `Company.refPrefix`
 * first; falls back to the derived value from the company name. Trimmed +
 * uppercased so input variations don't break uniqueness.
 */
export async function getCompanyPrefix(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { refPrefix: true, name: true },
  });
  const explicit = company?.refPrefix?.trim();
  if (explicit) return explicit.toUpperCase();
  return derivePrefix(company?.name);
}

/**
 * Allocates the next sequential property reference for the company. Picks the
 * MAX existing reference matching the current prefix (lexicographic sort works
 * because numbers are zero-padded), then increments. Callers should wrap the
 * subsequent `prisma.property.create()` in a retry loop on P2002 to handle the
 * narrow race window between read and write.
 */
export async function nextPropertyReference(companyId: string): Promise<string> {
  const prefix = await getCompanyPrefix(companyId);
  const last = await prisma.property.findFirst({
    where: { companyId, reference: { startsWith: `${prefix}-` } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  let next = 1;
  if (last) {
    const m = last.reference.match(/-(\d+)$/);
    if (m) next = Number(m[1]) + 1;
  }
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

/**
 * Allocates the next invoice number for the company in the form
 * `<PREFIX>-INV-####`. Numbering is per-company (so two tenants can both have
 * `INV-0001`), enforced by the `@@unique([companyId, number])` constraint on
 * `Invoice`. Same MAX-based lookup + same caller-side retry pattern as
 * `nextPropertyReference`.
 */
export async function nextInvoiceReference(companyId: string): Promise<string> {
  const prefix = await getCompanyPrefix(companyId);
  const stem = `${prefix}-INV-`;
  const last = await prisma.invoice.findFirst({
    where: { companyId, number: { startsWith: stem } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  let next = 1;
  if (last) {
    const m = last.number.match(/-(\d+)$/);
    if (m) next = Number(m[1]) + 1;
  }
  return `${stem}${String(next).padStart(4, "0")}`;
}

/**
 * Allocates the next deal reference for the company in the form
 * `<PREFIX>-D-####`. Same pattern as property + invoice references — replaces
 * the old global `DEAL-####` so two tenants don't both end up with DEAL-0001
 * (which was technically OK under `@@unique([companyId, reference])` but read
 * confusingly in cross-tenant Super Admin views).
 *
 * Falls back gracefully on existing data: a tenant that already has
 * `DEAL-0001..DEAL-0005` from the seed will pick up at `<PREFIX>-D-0001`
 * (separate stem, no collision). The old refs keep working unchanged.
 */
export async function nextDealReference(companyId: string): Promise<string> {
  const prefix = await getCompanyPrefix(companyId);
  const stem = `${prefix}-D-`;
  const last = await prisma.deal.findFirst({
    where: { companyId, reference: { startsWith: stem } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  let next = 1;
  if (last) {
    const m = last.reference.match(/-(\d+)$/);
    if (m) next = Number(m[1]) + 1;
  }
  return `${stem}${String(next).padStart(4, "0")}`;
}

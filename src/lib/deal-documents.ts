import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureContractForDeal } from "@/lib/contract-service";

/**
 * The generated document pack for a deal. Each kind renders as a printable HTML
 * page (the /deal-documents/[id]/[kind] route) and is tracked as a Document row
 * so it surfaces in the Documents tab. Everything auto-fills from the Contract —
 * including the CNIC identities captured by the verify links.
 *
 * The pack covers the standard documents a Pakistan property transaction needs;
 * the set differs by deal type (a sale needs the deed, payment plan & affidavit
 * a lease doesn't).
 */
export type DealDocKind =
  | "agreement"
  | "sale-deed"
  | "payment-plan"
  | "receipt"
  | "possession"
  | "noc"
  | "affidavit"
  | "power-of-attorney"
  | "tax-certificate";

/** Canonical order — also used to sort the pack in the UI. */
export const ALL_DEAL_DOC_KINDS: DealDocKind[] = [
  "agreement",
  "sale-deed",
  "payment-plan",
  "receipt",
  "possession",
  "noc",
  "affidavit",
  "power-of-attorney",
  "tax-certificate",
];

/** The documents generated for a deal, in order — varies by type. */
export function dealDocKinds(isSale: boolean): DealDocKind[] {
  return isSale
    ? ["agreement", "sale-deed", "payment-plan", "receipt", "possession", "noc", "affidavit", "power-of-attorney", "tax-certificate"]
    : ["agreement", "receipt", "possession", "noc", "affidavit"];
}

export function dealDocMeta(kind: DealDocKind, isSale: boolean): { type: DocumentType; name: string } {
  switch (kind) {
    case "agreement":
      return isSale
        ? { type: "SALE_AGREEMENT", name: "Agreement to Sell" }
        : { type: "RENTAL_AGREEMENT", name: "Rental Agreement" };
    case "sale-deed":
      return { type: "OWNERSHIP_DOCUMENT", name: "Sale Deed (Transfer)" };
    case "payment-plan":
      return { type: "OTHER", name: "Payment Schedule" };
    case "receipt":
      return { type: "PAYMENT_RECEIPT", name: isSale ? "Token / Booking Receipt" : "Security Deposit Receipt" };
    case "possession":
      return { type: "OTHER", name: "Possession / Handover Note" };
    case "noc":
      return { type: "OTHER", name: "No Objection Certificate" };
    case "affidavit":
      return { type: "OTHER", name: isSale ? "Seller's Affidavit" : "Tenant Undertaking" };
    case "power-of-attorney":
      return { type: "OTHER", name: "Power of Attorney" };
    case "tax-certificate":
      return { type: "OTHER", name: "Tax / FBR Certificate" };
  }
}

export function dealDocRoute(dealId: string, kind: DealDocKind): string {
  return `/deal-documents/${dealId}/${kind}`;
}

/**
 * Generate (or refresh) the deal's document pack as Document rows pointing at the
 * printable routes. Idempotent: reconciles by the generated-url prefix so
 * re-running updates existing rows (preserving ids / verification), adds any new
 * ones, and prunes generated rows no longer in the pack (e.g. after a type
 * change). Never touches manually-uploaded documents.
 */
export async function syncDealDocuments(dealId: string): Promise<number> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, companyId: true, type: true },
  });
  if (!deal) throw new Error("Deal not found.");

  // A contract must exist — it holds the term snapshot + the CNIC identities the
  // documents render from.
  await ensureContractForDeal(dealId);
  const isSale = deal.type === "SALE";
  const kinds = dealDocKinds(isSale);

  const prefix = `/deal-documents/${dealId}/`;
  const existing = await prisma.document.findMany({
    where: { dealId, url: { startsWith: prefix } },
    select: { id: true, url: true },
  });
  const byUrl = new Map(existing.map((d) => [d.url, d.id]));
  const wantedUrls = new Set(kinds.map((k) => dealDocRoute(dealId, k)));

  let count = 0;
  for (const kind of kinds) {
    const meta = dealDocMeta(kind, isSale);
    const url = dealDocRoute(dealId, kind);
    const id = byUrl.get(url);
    if (id) {
      await prisma.document.update({ where: { id }, data: { name: meta.name, type: meta.type } });
    } else {
      await prisma.document.create({
        data: { companyId: deal.companyId, dealId, name: meta.name, type: meta.type, url, verification: "PENDING" },
      });
    }
    count++;
  }

  // Prune generated rows no longer part of the pack.
  const stale = existing.filter((d) => !wantedUrls.has(d.url)).map((d) => d.id);
  if (stale.length) await prisma.document.deleteMany({ where: { id: { in: stale } } });

  return count;
}

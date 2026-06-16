import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureContractForDeal } from "@/lib/contract-service";

/**
 * The generated document pack for a deal. Each kind renders as a printable HTML
 * page (the /deal-documents/[id]/[kind] route) and is tracked as a Document row
 * so it surfaces in the Documents tab. The agreement auto-fills from the
 * Contract — including the CNIC identities captured by the verify links.
 */
export type DealDocKind = "agreement" | "receipt" | "possession";

export const DEAL_DOC_KINDS: DealDocKind[] = ["agreement", "receipt", "possession"];

export function dealDocMeta(kind: DealDocKind, isSale: boolean): { type: DocumentType; name: string } {
  switch (kind) {
    case "agreement":
      return isSale
        ? { type: "SALE_AGREEMENT", name: "Sale Agreement" }
        : { type: "RENTAL_AGREEMENT", name: "Rental Agreement" };
    case "receipt":
      return { type: "PAYMENT_RECEIPT", name: isSale ? "Token / Booking Receipt" : "Security Deposit Receipt" };
    case "possession":
      return { type: "OTHER", name: "Possession / Handover Note" };
  }
}

export function dealDocRoute(dealId: string, kind: DealDocKind): string {
  return `/deal-documents/${dealId}/${kind}`;
}

/**
 * Generate (or refresh) the deal's document pack as Document rows pointing at the
 * printable routes. Idempotent: reconciles by the generated-url prefix so
 * re-running updates the existing rows (preserving ids / verification) instead
 * of duplicating, and never touches manually-uploaded documents.
 */
export async function syncDealDocuments(dealId: string): Promise<number> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, companyId: true, type: true },
  });
  if (!deal) throw new Error("Deal not found.");

  // A contract must exist — it holds the term snapshot + the CNIC identities the
  // agreement renders from.
  await ensureContractForDeal(dealId);
  const isSale = deal.type === "SALE";

  const prefix = `/deal-documents/${dealId}/`;
  const existing = await prisma.document.findMany({
    where: { dealId, url: { startsWith: prefix } },
    select: { id: true, url: true },
  });
  const byUrl = new Map(existing.map((d) => [d.url, d.id]));

  let count = 0;
  for (const kind of DEAL_DOC_KINDS) {
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
  return count;
}

/**
 * Demo seed for the generated deal-documents feature — produces the document
 * pack (agreement, receipt, possession note) on a deal so the printable
 * /deal-documents/[id]/[doc] pages and the deal's Documents list have content.
 *
 * Mirrors lib/deal-documents.ts (syncDealDocuments) + lib/contract-service.ts
 * (ensureContractForDeal): ensures the deal's Contract exists, fills a few
 * editable agreement fields when they're still empty, and reconciles the three
 * Document rows by their generated-url prefix (idempotent — re-running updates
 * the same rows, never duplicates, never touches uploaded files).
 *
 * Usage:
 *
 *   DATABASE_URL="..." npx tsx scripts/seed-deal-documents.ts [--deal="REF"]
 *
 *   --deal="REF"  target a deal by reference. Omit to use the newest deal that
 *                 has a client (so both parties render).
 *
 * ⚠️ DEV / local-testing helper. It writes a Contract + Document rows against a
 * real tenant's deal. The generated docs carry CNIC identities and are
 * office-only to view. Don't run it against a production tenant. Remove with
 * prisma.document.deleteMany({ where: { dealId, url: { startsWith: "/deal-documents/" } } }).
 */

import { PrismaClient, type DocumentType } from "@prisma/client";

type DocKind = "agreement" | "receipt" | "possession";
const KINDS: DocKind[] = ["agreement", "receipt", "possession"];

function docMeta(kind: DocKind, isSale: boolean): { type: DocumentType; name: string } {
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

function parseDealArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--deal"));
  if (!arg) return null;
  const eq = arg.indexOf("=");
  return eq >= 0 ? arg.slice(eq + 1).trim() : null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const wantRef = parseDealArg();
    const deals = await prisma.deal.findMany({
      where: { ...(wantRef ? { reference: wantRef } : { clientId: { not: null } }) },
      include: { property: true, client: true, sale: true, rental: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    const deal = deals.find((d) => d.client) || deals[0];
    if (!deal) {
      console.error(wantRef ? `No deal with reference "${wantRef}".` : "No deals found — create one first.");
      process.exit(1);
    }
    const isSale = deal.type === "SALE";

    // ensureContractForDeal — create the snapshot if missing (no WhatsApp send).
    let contract = await prisma.contract.findUnique({ where: { dealId: deal.id } });
    if (!contract) {
      const base = {
        companyId: deal.companyId,
        dealId: deal.id,
        landlordId: deal.property?.ownerPhone ?? null,
        renterId: deal.clientId ?? null,
        status: "AWAITING_CNIC_LANDLORD" as const,
      };
      contract = isSale
        ? await prisma.contract.create({
            data: {
              ...base,
              type: "SALE",
              salePrice: deal.sale?.salePrice ?? 0,
              tokenAmount: deal.sale?.tokenAmount ?? null,
              downPayment: deal.sale?.downPayment ?? null,
            },
          })
        : await prisma.contract.create({
            data: {
              ...base,
              type: "RENTAL",
              monthlyRent: deal.rental?.monthlyRent ?? 0,
              deposit: deal.rental?.deposit ?? null,
              leaseMonths: deal.rental?.leaseMonths ?? 11,
              startDate: new Date(),
              endDate: (() => {
                const d = new Date();
                d.setMonth(d.getMonth() + (deal.rental?.leaseMonths ?? 11));
                return d;
              })(),
            },
          });
    }

    // Fill a few editable agreement fields when empty so the docs render complete.
    await prisma.contract.update({
      where: { dealId: deal.id },
      data: {
        possessionDate: contract.possessionDate ?? new Date(),
        customClauses:
          contract.customClauses ??
          (isSale
            ? "Transfer/registry within 60 days of this agreement. Society transfer fee shared equally."
            : "Annual rent increase as mutually agreed. One month's notice for termination by either party."),
      },
    });

    // syncDealDocuments — reconcile the three Document rows by url prefix.
    const prefix = `/deal-documents/${deal.id}/`;
    const existing = await prisma.document.findMany({
      where: { dealId: deal.id, url: { startsWith: prefix } },
      select: { id: true, url: true },
    });
    const byUrl = new Map(existing.map((d) => [d.url, d.id]));
    for (const kind of KINDS) {
      const meta = docMeta(kind, isSale);
      const url = `${prefix}${kind}`;
      const id = byUrl.get(url);
      if (id) await prisma.document.update({ where: { id }, data: { name: meta.name, type: meta.type } });
      else
        await prisma.document.create({
          data: { companyId: deal.companyId, dealId: deal.id, name: meta.name, type: meta.type, url, verification: "PENDING" },
        });
    }

    console.log("");
    console.log(`Generated document pack on "${deal.reference}" (${deal.property?.title ?? "—"}) — ${deal.type}`);
    console.log("Open these (prefix with your origin, e.g. http://localhost:3000):");
    for (const kind of KINDS) console.log(`  ${kind.padEnd(11)} ${prefix}${kind}`);
    console.log(`Or from the deal page: /deals/${deal.id}  → Documents list (clickable).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

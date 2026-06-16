/**
 * Demo seed for the sale-agreement e-signature feature — creates a Contract on a
 * SALE deal in a realistic mid-flow state (seller verified, buyer still pending)
 * so the deal page's "Sale agreement verification" panel and the public CNIC
 * verify links have something to render.
 *
 * Usage:
 *
 *   DATABASE_URL="..." npx tsx scripts/seed-demo-sale-contract.ts [--deal="REF"]
 *
 *   --deal="REF"  target a specific deal by reference. Omit to auto-pick the
 *                 newest SALE deal that has both a client (buyer) and an owner
 *                 phone (seller).
 *
 * Idempotent: a deal can have only one contract (dealId is unique), so this
 * clears any existing contract on the chosen deal and recreates it.
 *
 * ⚠️ DEV / local-testing helper. It writes a Contract against a real tenant's
 * deal and mints LIVE verify tokens — the printed /verify-identity links work
 * for anyone who opens them. Don't run it against a production tenant. To remove
 * the demo, delete the contract (e.g. prisma.contract.deleteMany where dealId),
 * or finalise/terminate it from the app.
 */

import { PrismaClient, type ContractStatus } from "@prisma/client";

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
      where: { type: "SALE", ...(wantRef ? { reference: wantRef } : {}) },
      include: { property: true, client: true, sale: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    // Prefer a deal with both parties identifiable; fall back progressively.
    const deal =
      deals.find((d) => d.client && d.property?.ownerPhone) ||
      deals.find((d) => d.client) ||
      deals[0];

    if (!deal) {
      console.error(
        wantRef ? `No SALE deal with reference "${wantRef}".` : "No SALE deal found — create one first.",
      );
      process.exit(1);
    }

    // Idempotent: one contract per deal.
    const removed = await prisma.contract.deleteMany({ where: { dealId: deal.id } });
    if (removed.count > 0) console.log(`Removed ${removed.count} existing contract on ${deal.reference}.`);

    // Mid-flow demo state: seller (landlord slot) verified, buyer (renter slot)
    // pending — mirrors what initiateContractPipelines + one verification yields.
    const now = new Date();
    const status: ContractStatus = "AWAITING_CNIC_RENTER";
    const contract = await prisma.contract.create({
      data: {
        companyId: deal.companyId,
        dealId: deal.id,
        type: "SALE",
        salePrice: deal.sale?.salePrice ?? 0,
        landlordId: deal.property?.ownerPhone ?? null, // seller
        renterId: deal.clientId ?? null, // buyer
        landlordCnic: "35202-1234567-1",
        landlordCnicName: deal.property?.ownerName ?? "Demo Seller",
        landlordVerifiedAt: now,
        status,
      },
    });

    console.log("");
    console.log(`Seeded demo SALE contract on "${deal.reference}" (${deal.property?.title ?? "—"})`);
    console.log(`  sale price: ${contract.salePrice}`);
    console.log(`  seller:     ${contract.landlordCnicName} — VERIFIED`);
    console.log(`  buyer:      ${deal.client?.name ?? "—"} — AWAITING`);
    console.log(`  status:     ${contract.status}`);
    console.log("");
    console.log(`Deal page:  /deals/${deal.id}  → "Sale agreement verification" panel`);
    console.log("Verify links (prefix with your origin, e.g. http://localhost:3000):");
    console.log(`  buyer:  /verify-identity/${contract.renterToken}`);
    console.log(`  seller: /verify-identity/${contract.landlordToken}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

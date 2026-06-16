/**
 * Demo seed for the Documents tab — inserts a varied set of placeholder Document
 * rows so /documents shows a realistic spread of types, statuses and expiry
 * badges (Expired / Soon are derived from expiryDate, exactly as the page
 * renders them, so those rows are VERIFIED with a past / near-future expiry).
 *
 * Usage:
 *
 *   DATABASE_URL="..." npx tsx scripts/seed-demo-documents.ts [--company="Name"]
 *
 *   --company="Name"  target a company by name. Omit to use the company with the
 *                     most properties (so there's something to link to).
 *
 * Mapping notes:
 *   - Display types collapse onto the DocumentType enum (Token Receipt ->
 *     PAYMENT_RECEIPT, Possession Note -> OTHER, etc.).
 *   - Uploader first-names resolve to a real company User by name match, else
 *     round-robin over users (so "by <name>" shows a real person).
 *   - SKY-#### references resolve to a real Property by reference, else
 *     round-robin a real property; "—" entries stay unlinked.
 *
 * Idempotent: clears prior demo docs (url prefix /demo-docs/) for the company and
 * reinserts. ⚠️ DEV / local helper — these are PLACEHOLDER rows whose url points
 * at /demo-docs/<file> (no real file behind it). Remove with
 * prisma.document.deleteMany({ where: { url: { startsWith: "/demo-docs/" } } }).
 */

import { PrismaClient, type DocumentType, type VerificationStatus } from "@prisma/client";

interface Entry {
  file: string;
  uploader: string; // first name
  type: DocumentType;
  propRef: string | null;
  expiryDays: number | null; // relative to now; <0 past (Expired), small + (Soon)
  status: VerificationStatus;
}

const ENTRIES: Entry[] = [
  { file: "sale agreement 42.pdf", uploader: "Omar", type: "SALE_AGREEMENT", propRef: "SKY-0042", expiryDays: -124, status: "VERIFIED" },
  { file: "rental agreement 17.pdf", uploader: "Nida", type: "RENTAL_AGREEMENT", propRef: "SKY-0017", expiryDays: -47, status: "VERIFIED" },
  { file: "cnic passport 88.pdf", uploader: "Ali", type: "CNIC_PASSPORT", propRef: "SKY-0088", expiryDays: -162, status: "VERIFIED" },
  { file: "cnic passport 23.pdf", uploader: "Hira", type: "CNIC_PASSPORT", propRef: "SKY-0023", expiryDays: 12, status: "VERIFIED" },
  { file: "sale agreement 61.pdf", uploader: "Bilal", type: "SALE_AGREEMENT", propRef: "SKY-0061", expiryDays: 23, status: "VERIFIED" },
  { file: "rental agreement 35.pdf", uploader: "Maria", type: "RENTAL_AGREEMENT", propRef: "SKY-0035", expiryDays: 28, status: "VERIFIED" },
  { file: "payment receipt 09.pdf", uploader: "Usman", type: "PAYMENT_RECEIPT", propRef: "SKY-0009", expiryDays: null, status: "PENDING" },
  { file: "token receipt 74.pdf", uploader: "Fatima", type: "PAYMENT_RECEIPT", propRef: "SKY-0074", expiryDays: null, status: "PENDING" },
  { file: "client document 11.pdf", uploader: "Ahmed", type: "CLIENT_DOCUMENT", propRef: null, expiryDays: null, status: "PENDING" },
  { file: "property document 50.pdf", uploader: "Sara", type: "PROPERTY_DOCUMENT", propRef: "SKY-0050", expiryDays: null, status: "PENDING" },
  { file: "dealer document 16.pdf", uploader: "Omar", type: "DEALER_DOCUMENT", propRef: null, expiryDays: null, status: "PENDING" },
  { file: "payment receipt 12.pdf", uploader: "Nida", type: "PAYMENT_RECEIPT", propRef: "SKY-0012", expiryDays: null, status: "VERIFIED" },
  { file: "property document 67.pdf", uploader: "Ali", type: "PROPERTY_DOCUMENT", propRef: "SKY-0067", expiryDays: null, status: "VERIFIED" },
  { file: "ownership document 29.pdf", uploader: "Hira", type: "OWNERSHIP_DOCUMENT", propRef: "SKY-0029", expiryDays: null, status: "VERIFIED" },
  { file: "token receipt 95.pdf", uploader: "Bilal", type: "PAYMENT_RECEIPT", propRef: "SKY-0095", expiryDays: null, status: "VERIFIED" },
  { file: "possession note 44.pdf", uploader: "Maria", type: "OTHER", propRef: "SKY-0044", expiryDays: null, status: "VERIFIED" },
  { file: "sale agreement 06.pdf", uploader: "Usman", type: "SALE_AGREEMENT", propRef: "SKY-0006", expiryDays: 187, status: "VERIFIED" },
  { file: "client document 81.pdf", uploader: "Fatima", type: "CLIENT_DOCUMENT", propRef: "SKY-0081", expiryDays: null, status: "VERIFIED" },
  { file: "ownership document 33.pdf", uploader: "Ahmed", type: "OWNERSHIP_DOCUMENT", propRef: "SKY-0033", expiryDays: null, status: "VERIFIED" },
  { file: "possession note 58.pdf", uploader: "Sara", type: "OTHER", propRef: "SKY-0058", expiryDays: null, status: "VERIFIED" },
  { file: "dealer document 70.pdf", uploader: "Omar", type: "DEALER_DOCUMENT", propRef: "SKY-0070", expiryDays: null, status: "REJECTED" },
  { file: "payment receipt 19.pdf", uploader: "Nida", type: "PAYMENT_RECEIPT", propRef: "SKY-0019", expiryDays: null, status: "REJECTED" },
  { file: "cnic passport 48.pdf", uploader: "Ali", type: "CNIC_PASSPORT", propRef: "SKY-0048", expiryDays: null, status: "REJECTED" },
  { file: "property document 90.pdf", uploader: "Hira", type: "PROPERTY_DOCUMENT", propRef: "SKY-0090", expiryDays: null, status: "REJECTED" },
  { file: "token receipt 27.pdf", uploader: "Bilal", type: "PAYMENT_RECEIPT", propRef: "SKY-0027", expiryDays: null, status: "REJECTED" },
];

function parseCompanyArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--company"));
  if (!arg) return null;
  const eq = arg.indexOf("=");
  return eq >= 0 ? arg.slice(eq + 1).trim() : null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const wantCompany = parseCompanyArg();
    const company = wantCompany
      ? await prisma.company.findFirst({ where: { name: wantCompany }, select: { id: true, name: true } })
      : (
          await prisma.company.findMany({
            select: { id: true, name: true, _count: { select: { properties: true } } },
            orderBy: { properties: { _count: "desc" } },
            take: 1,
          })
        )[0];
    if (!company) {
      console.error(wantCompany ? `No company named "${wantCompany}".` : "No companies found.");
      process.exit(1);
    }

    const [users, properties] = await Promise.all([
      prisma.user.findMany({ where: { companyId: company.id }, select: { id: true, name: true } }),
      prisma.property.findMany({ where: { companyId: company.id }, select: { id: true, reference: true } }),
    ]);

    const resolveUploader = (firstName: string, i: number) => {
      const match = users.find((u) => (u.name ?? "").toLowerCase().includes(firstName.toLowerCase()));
      if (match) return match.id;
      return users.length ? users[i % users.length].id : null;
    };
    const resolveProperty = (ref: string | null, i: number) => {
      if (!ref) return null;
      const exact = properties.find((p) => p.reference === ref);
      if (exact) return exact.id;
      return properties.length ? properties[i % properties.length].id : null;
    };

    // Idempotent: clear prior demo docs for this company.
    const removed = await prisma.document.deleteMany({
      where: { companyId: company.id, url: { startsWith: "/demo-docs/" } },
    });
    if (removed.count > 0) console.log(`Removed ${removed.count} existing demo documents.`);

    let inserted = 0;
    for (let i = 0; i < ENTRIES.length; i++) {
      const e = ENTRIES[i];
      await prisma.document.create({
        data: {
          companyId: company.id,
          name: e.file,
          type: e.type,
          url: `/demo-docs/${e.file.replace(/\s+/g, "-")}`,
          verification: e.status,
          expiryDate: e.expiryDays == null ? null : new Date(Date.now() + e.expiryDays * 86_400_000),
          uploadedById: resolveUploader(e.uploader, i),
          propertyId: resolveProperty(e.propRef, i),
        },
      });
      inserted++;
    }

    console.log("");
    console.log(`Inserted ${inserted} demo documents into "${company.name}".`);
    console.log("Open /documents to see them (filter by type / status).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

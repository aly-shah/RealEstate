/* eslint-disable no-console */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PASSWORD = "password";

// ── Deterministic PRNG so re-seeds are reproducible ──────────
function makeRng(seed: number) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
  return {
    rnd,
    int: (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1)),
    pick: <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)],
    chance: (p: number) => rnd() < p,
    sample: <T,>(arr: T[], n: number): T[] => {
      const copy = [...arr];
      const out: T[] = [];
      while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
      return out;
    },
  };
}

const D = (n: number) => new Prisma.Decimal(Math.round(n));
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);
const daysAhead = (d: number) => new Date(Date.now() + d * 86400000);

const FIRST = ["Ayesha", "Usman", "Zara", "Bilal", "Hira", "Imran", "Sana", "Faisal", "Ali", "Fatima", "Hassan", "Maria", "Ahmed", "Sara", "Omar", "Nida", "Kamran", "Rabia", "Tariq", "Mehwish", "Asad", "Sadia", "Junaid", "Amna", "Yousuf", "Komal", "Adeel", "Iqra", "Saad", "Hina", "Bilawal", "Mahnoor"];
const LAST = ["Khan", "Ahmed", "Malik", "Sheikh", "Riaz", "Hussain", "Iqbal", "Qureshi", "Butt", "Chaudhry", "Siddiqui", "Raza", "Farooq", "Javed", "Aslam", "Nawaz", "Baig", "Mirza", "Shah", "Ansari"];
const AREAS = ["DHA Phase 2", "DHA Phase 5", "DHA Phase 6", "DHA Phase 8", "Clifton Block 2", "Clifton Block 5", "Bahria Town", "Gulshan-e-Iqbal", "PECHS", "Bath Island", "Gulberg", "North Nazimabad", "Tariq Road", "Bukhari Commercial", "Khayaban-e-Ittehad"];
const PROP_TYPES = ["APARTMENT", "VILLA", "RESIDENTIAL", "PLOT", "SHOP", "OFFICE", "COMMERCIAL"] as const;
const SOURCES = ["REFERRAL", "WALK_IN", "SOCIAL_MEDIA", "PORTAL", "CALL", "REPEAT_CLIENT", "OTHER"] as const;
const LOST_REASONS = ["Budget too low for available inventory.", "Chose a competitor.", "Decided to delay purchase.", "Could not arrange financing.", "Location did not match needs.", "Went cold — stopped responding."];
const EVENT_TYPES = ["SHOWING", "MEETING", "FOLLOW_UP", "OPEN_HOUSE", "PAYMENT_REMINDER", "DOCUMENT_REMINDER", "RENTAL_RENEWAL", "DEAL_CLOSING"] as const;
const DOC_TYPES = ["CNIC_PASSPORT", "PROPERTY_DOCUMENT", "OWNERSHIP_DOCUMENT", "SALE_AGREEMENT", "RENTAL_AGREEMENT", "PAYMENT_RECEIPT", "DEALER_DOCUMENT", "CLIENT_DOCUMENT"] as const;
const FEEDBACK = ["Loved the layout, considering an offer.", "Concerned about the price.", "Wants to see more options first.", "Very interested — asked for the agreement.", "Liked it but needs family approval.", "Found it smaller than expected.", "Great location, will revert soon."];

interface UserDef { email: string; name: string; phone: string; role: "OWNER" | "ADMIN" | "AGENT" | "DEALER" }

type SeedPlan = "FREE" | "TRIAL" | "STARTER" | "GROWTH" | "PRO";

interface CompanyCfg {
  name: string;
  plan: SeedPlan;
  refPrefix: string;
  seed: number;
  users: UserDef[];
  counts: { dealers: number; projects: number; properties: number; clients: number; leads: number; showings: number; events: number; deals: number; documents: number };
}

async function seedCompany(cfg: CompanyCfg, hash: string) {
  const r = makeRng(cfg.seed);
  const company = await prisma.company.create({
    data: { name: cfg.name, plan: cfg.plan, status: "ACTIVE", settings: { currency: "PKR", locale: "en-PK" } },
  });

  const rule = await prisma.commissionRule.create({
    data: { companyId: company.id, name: "Company Default 50 / 25 / 25", isDefault: true, mainAgentPct: D(50), companyPct: D(25), otherAgentPct: D(25), dealerPct: D(0) },
  });

  // Users
  const created = await Promise.all(
    cfg.users.map((u) =>
      prisma.user.create({ data: { companyId: company.id, email: u.email, name: u.name, phone: u.phone, passwordHash: hash, role: u.role } }),
    ),
  );
  const owner = created.find((u) => u.role === "OWNER")!;
  const admin = created.find((u) => u.role === "ADMIN") ?? owner;
  const agents = created.filter((u) => u.role === "AGENT");
  const dealerUser = created.find((u) => u.role === "DEALER");

  // Dealers
  const dealers = [];
  for (let i = 0; i < cfg.counts.dealers; i++) {
    const name = `${r.pick(["Clifton Heights", "UrbanEdge", "Capital Crest", "Bahria", "Gulberg", "Metro", "Crown", "Horizon", "Summit"])} ${r.pick(["Builders", "Estates", "Realty", "Marketing", "Property Group", "Associates"])}`;
    dealers.push(
      await prisma.dealer.create({
        data: {
          companyId: company.id,
          userId: i === 0 && dealerUser ? dealerUser.id : null,
          name: i === 0 && dealerUser ? dealerUser.name : name,
          contact: `+92 3${r.int(10, 49)} ${r.int(1000000, 9999999)}`,
          companyName: name,
          areaOfOperation: r.pick(AREAS),
          defaultSharePct: D(r.pick([10, 15, 20, 25, 30])),
        },
      }),
    );
  }

  // Projects
  const projects = [];
  for (let i = 0; i < cfg.counts.projects; i++) {
    projects.push(
      await prisma.project.create({
        data: { companyId: company.id, name: `${r.pick(["Crescent Bay", "Emaar Oceanfront", "Bahria Heights", "Grand Towers", "Pearl Residency", "Eden Gardens"])}`, city: "Karachi", area: r.pick(AREAS), isOffPlan: r.chance(0.5), description: "Multi-unit development." },
      }),
    );
  }

  const logs: Prisma.ActivityLogCreateManyInput[] = [];
  const notifications: Prisma.NotificationCreateManyInput[] = [];

  // ── Properties ──────────────────────────────────────────
  const properties: { id: string; type: string; listingType: string; status: string; salePrice: number; monthlyRent: number; dealerId: string | null; agentIds: string[] }[] = [];
  for (let i = 0; i < cfg.counts.properties; i++) {
    const type = r.pick([...PROP_TYPES]);
    const area = r.pick(AREAS);
    const beds = ["APARTMENT", "VILLA", "RESIDENTIAL"].includes(type) ? r.int(1, 6) : 0;
    const rentable = ["APARTMENT", "SHOP", "OFFICE", "COMMERCIAL"].includes(type);
    const listingType = type === "PLOT" ? "SALE" : rentable ? r.pick(["SALE", "RENT", "BOTH"]) : "SALE";
    const statusRoll = r.rnd();
    const status = statusRoll < 0.5 ? "AVAILABLE" : statusRoll < 0.62 ? "UNDER_NEGOTIATION" : statusRoll < 0.72 ? "RESERVED" : statusRoll < 0.82 ? "SOLD" : statusRoll < 0.9 ? "RENTED" : statusRoll < 0.96 ? "PENDING_VERIFICATION" : "INACTIVE";
    const salePrice = { APARTMENT: r.int(120, 900), VILLA: r.int(500, 2500), RESIDENTIAL: r.int(300, 1500), PLOT: r.int(80, 600), SHOP: r.int(200, 800), OFFICE: r.int(150, 700), COMMERCIAL: r.int(300, 1200) }[type] * 100000;
    const monthlyRent = (listingType === "SALE" ? 0 : { APARTMENT: r.int(80, 350), SHOP: r.int(150, 600), OFFICE: r.int(120, 500), COMMERCIAL: r.int(200, 700) }[type as "APARTMENT"] ?? r.int(80, 200)) * 1000;
    const typeLabel = type.charAt(0) + type.slice(1).toLowerCase();
    const title = beds ? `${beds}-Bed ${typeLabel} in ${area}` : `${typeLabel} in ${area}`;
    const useDealer = r.chance(0.45) && dealers.length;
    const dealer = useDealer ? r.pick(dealers) : null;
    const propAgents = r.sample(agents, r.int(1, 2));

    const photos = r.chance(0.5)
      ? Array.from({ length: r.int(1, 3) }, (_, k) => ({ kind: "PHOTO" as const, url: `https://picsum.photos/seed/${cfg.refPrefix}${i}_${k}/640/420`, caption: r.pick(["Living area", "Master bedroom", "Exterior", "Kitchen", "View"]) }))
      : [];

    const p = await prisma.property.create({
      data: {
        companyId: company.id,
        reference: `${cfg.refPrefix}-${String(i + 1).padStart(4, "0")}`,
        title,
        type: type as Prisma.PropertyCreateInput["type"],
        listingType: listingType as Prisma.PropertyCreateInput["listingType"],
        status: status as Prisma.PropertyCreateInput["status"],
        projectId: r.chance(0.25) && projects.length ? r.pick(projects).id : null,
        dealerId: dealer?.id ?? null,
        ownerName: dealer ? null : `${r.pick(FIRST)} ${r.pick(LAST)}`,
        ownerPhone: dealer ? null : `+92 3${r.int(10, 49)} ${r.int(1000000, 9999999)}`,
        city: "Karachi",
        area,
        address: `${r.int(1, 400)}-${r.pick(["A", "B", "C"])}, ${area}`,
        latitude: 24.8 + r.rnd() * 0.15,
        longitude: 66.98 + r.rnd() * 0.15,
        salePrice: listingType === "RENT" ? null : D(salePrice),
        monthlyRent: monthlyRent ? D(monthlyRent) : null,
        deposit: monthlyRent ? D(monthlyRent * 2) : null,
        bedrooms: beds || null,
        bathrooms: beds ? r.int(1, beds + 1) : null,
        coveredArea: r.int(600, 4000),
        parking: r.int(0, 4),
        yearBuilt: r.int(2008, 2025),
        availableFrom: daysAgo(r.int(0, 120)),
        commissionRuleId: rule.id,
        agents: { create: propAgents.map((a) => ({ agentId: a.id })) },
        media: { create: photos },
      },
    });
    properties.push({ id: p.id, type, listingType, status, salePrice, monthlyRent, dealerId: dealer?.id ?? null, agentIds: propAgents.map((a) => a.id) });
    logs.push({ companyId: company.id, userId: r.pick([owner, admin]).id, action: "property.created", entityType: "PROPERTY", entityId: p.id, summary: `Added property ${p.reference} — ${title}`, createdAt: daysAgo(r.int(1, 170)) });
  }

  // ── Clients ─────────────────────────────────────────────
  const clients = [];
  for (let i = 0; i < cfg.counts.clients; i++) {
    clients.push(
      await prisma.client.create({
        data: { companyId: company.id, name: `${r.pick(FIRST)} ${r.pick(LAST)}`, phone: `+92 3${r.int(10, 49)} ${r.int(1000000, 9999999)}`, email: r.chance(0.6) ? `client${i}@example.com` : null },
      }),
    );
  }

  // ── Leads (all stages) ──────────────────────────────────
  const STAGE_WEIGHTS: [string, number][] = [["NEW", 0.16], ["CONTACTED", 0.14], ["INTERESTED", 0.13], ["SITE_VISIT", 0.1], ["PROPERTY_SHOWN", 0.09], ["NEGOTIATION", 0.08], ["TOKEN_BOOKING", 0.05], ["PAYMENT", 0.04], ["CLOSED_WON", 0.11], ["CLOSED_LOST", 0.1]];
  const pickStage = () => { let x = r.rnd(); for (const [s, w] of STAGE_WEIGHTS) { if ((x -= w) <= 0) return s; } return "NEW"; };
  for (let i = 0; i < cfg.counts.leads; i++) {
    const stage = pickStage();
    const agent = r.chance(0.88) ? r.pick(agents) : null;
    const client = r.pick(clients);
    const budgetMax = r.int(40, 1500) * 100000;
    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        clientId: client.id,
        agentId: agent?.id ?? null,
        propertyId: r.chance(0.5) ? r.pick(properties).id : null,
        stage: stage as Prisma.LeadCreateInput["stage"],
        source: r.pick([...SOURCES]) as Prisma.LeadCreateInput["source"],
        budgetMin: D(budgetMax * 0.7),
        budgetMax: D(budgetMax),
        prefType: r.pick([...PROP_TYPES]) as Prisma.LeadCreateInput["prefType"],
        prefArea: r.pick(AREAS),
        requirements: r.pick(["Sea-facing preferred.", "Needs parking for two cars.", "Furnished, ready to move.", "Close to schools.", "Corner unit, high floor.", "Budget is firm."]),
        lostReason: stage === "CLOSED_LOST" ? r.pick(LOST_REASONS) : null,
        createdAt: daysAgo(r.int(1, 160)),
      },
    });
    if (agent) notifications.push({ companyId: company.id, userId: agent.id, type: "LEAD_ASSIGNED", title: "New lead assigned", body: client.name, link: `/leads/${lead.id}`, read: r.chance(0.6), createdAt: daysAgo(r.int(0, 30)) });
    logs.push({ companyId: company.id, userId: (agent ?? admin).id, action: "lead.created", entityType: "LEAD", entityId: lead.id, summary: `New lead: ${client.name}`, createdAt: daysAgo(r.int(0, 160)) });
  }

  // ── Calendar events (spread around now) ─────────────────
  for (let i = 0; i < cfg.counts.events; i++) {
    const offset = r.int(-14, 21);
    const start = offset < 0 ? daysAgo(-offset) : daysAhead(offset);
    start.setHours(r.int(9, 18), r.chance(0.5) ? 0 : 30, 0, 0);
    const type = r.pick([...EVENT_TYPES]);
    const prop = r.pick(properties);
    await prisma.calendarEvent.create({
      data: {
        companyId: company.id,
        agentId: r.pick(agents).id,
        propertyId: r.chance(0.7) ? prop.id : null,
        type: type as Prisma.CalendarEventCreateInput["type"],
        status: offset < 0 ? (r.chance(0.8) ? "DONE" : "MISSED") : "SCHEDULED",
        title: `${type === "SHOWING" ? "Showing" : type === "FOLLOW_UP" ? "Follow up" : type === "MEETING" ? "Client meeting" : type.charAt(0) + type.slice(1).toLowerCase().replace("_", " ")} — ${r.pick(FIRST)}`,
        startAt: start,
      },
    });
  }

  // ── Showings ────────────────────────────────────────────
  for (let i = 0; i < cfg.counts.showings; i++) {
    const prop = r.pick(properties);
    const when = daysAgo(r.int(0, 45));
    const useGps = r.chance(0.7);
    await prisma.showing.create({
      data: {
        companyId: company.id,
        agentId: prop.agentIds.length ? r.pick(prop.agentIds) : r.pick(agents).id,
        clientId: r.chance(0.85) ? r.pick(clients).id : null,
        propertyId: prop.id,
        checkInAt: when,
        checkOutAt: new Date(when.getTime() + r.int(20, 70) * 60000),
        checkInLat: useGps ? 24.8 + r.rnd() * 0.15 : null,
        checkInLng: useGps ? 66.98 + r.rnd() * 0.15 : null,
        manualLocation: useGps ? null : r.pick(AREAS),
        clientFeedback: r.chance(0.8) ? r.pick(FEEDBACK) : null,
        interestLevel: r.pick(["HIGH", "MEDIUM", "LOW", "NONE", null]) as Prisma.ShowingCreateInput["interestLevel"],
        verification: r.pick(["VERIFIED", "VERIFIED", "PENDING", "FLAGGED"]) as Prisma.ShowingCreateInput["verification"],
      },
    });
  }

  // ── Deals + payments + commissions ──────────────────────
  for (let i = 0; i < cfg.counts.deals; i++) {
    const prop = r.pick(properties);
    const type = prop.listingType === "RENT" ? "RENTAL" : prop.listingType === "BOTH" ? r.pick(["SALE", "RENTAL"]) : "SALE";
    const roll = r.rnd();
    const status = roll < 0.55 ? "CLOSED_WON" : roll < 0.7 ? "NEGOTIATION" : roll < 0.8 ? "TOKEN" : roll < 0.9 ? "BOOKED" : roll < 0.95 ? "AGREEMENT" : "CLOSED_LOST";
    const won = status === "CLOSED_WON";
    const closeDate = won ? (() => { const m = r.int(0, 5); const d = new Date(); d.setMonth(d.getMonth() - m); d.setDate(r.int(1, 27)); return d; })() : null;
    const value = type === "SALE" ? (prop.salePrice || r.int(120, 900) * 100000) : (prop.monthlyRent || r.int(80, 350) * 1000);
    const main = prop.agentIds.length ? r.pick(prop.agentIds) : r.pick(agents).id;
    const cos = r.sample(agents.filter((a) => a.id !== main), r.chance(0.4) ? r.int(1, 2) : 0);
    const dealerId = prop.dealerId;
    const client = r.pick(clients);

    const deal = await prisma.deal.create({
      data: {
        companyId: company.id,
        reference: `${cfg.refPrefix}-D${String(i + 1).padStart(4, "0")}`,
        type: type as Prisma.DealCreateInput["type"],
        status: status as Prisma.DealCreateInput["status"],
        agreement: won ? "SIGNED" : status === "AGREEMENT" ? "DRAFT" : "NONE",
        propertyId: prop.id,
        clientId: client.id,
        dealerId,
        closeDate,
        createdAt: closeDate ?? daysAgo(r.int(1, 60)),
        agents: { create: [{ agentId: main, role: "MAIN" }, ...cos.map((c) => ({ agentId: c.id, role: "CO_AGENT" as const }))] },
        ...(type === "SALE"
          ? { sale: { create: { salePrice: D(value), tokenAmount: D(value * 0.02), bookingAmount: D(value * 0.1), downPayment: D(value * 0.3) } } }
          : { rental: { create: { monthlyRent: D(value), deposit: D(value * 2), leaseMonths: 12, renewalDate: daysAhead(r.int(120, 360)) } } }),
      },
    });
    logs.push({ companyId: company.id, userId: admin.id, action: "deal.created", entityType: "DEAL", entityId: deal.id, summary: `Created ${type.toLowerCase()} deal ${deal.reference}`, createdAt: deal.createdAt });

    if (won) {
      await prisma.property.update({ where: { id: prop.id }, data: { status: type === "SALE" ? "SOLD" : "RENTED" } });

      // Payments
      if (type === "SALE") {
        await prisma.payment.createMany({
          data: [
            { companyId: company.id, dealId: deal.id, type: "TOKEN", amount: D(value * 0.02), status: "PAID", paidAt: daysAgo(r.int(40, 120)), receiptNo: `RCPT-${deal.reference}-1` },
            { companyId: company.id, dealId: deal.id, type: "BOOKING", amount: D(value * 0.1), status: "PAID", paidAt: daysAgo(r.int(20, 60)), receiptNo: `RCPT-${deal.reference}-2` },
            { companyId: company.id, dealId: deal.id, type: "DOWN_PAYMENT", amount: D(value * 0.3), status: "PAID", paidAt: daysAgo(r.int(5, 30)), receiptNo: `RCPT-${deal.reference}-3` },
            { companyId: company.id, dealId: deal.id, type: "INSTALMENT", amount: D(value * 0.28), status: "PENDING", dueDate: daysAhead(r.int(5, 40)) },
            ...(r.chance(0.4) ? [{ companyId: company.id, dealId: deal.id, type: "INSTALMENT" as const, amount: D(value * 0.3), status: "OVERDUE" as const, dueDate: daysAgo(r.int(2, 20)) }] : []),
          ],
        });
      } else {
        const paidMonths = r.int(1, 6);
        const data: Prisma.PaymentCreateManyInput[] = [{ companyId: company.id, dealId: deal.id, type: "DEPOSIT", amount: D(value * 2), status: "PAID", paidAt: daysAgo(r.int(30, 90)), receiptNo: `RCPT-${deal.reference}-D` }];
        for (let m = 0; m < paidMonths; m++) data.push({ companyId: company.id, dealId: deal.id, type: "RENT", amount: D(value), status: "PAID", paidAt: daysAgo((m + 1) * 30), receiptNo: `RCPT-${deal.reference}-R${m}` });
        data.push({ companyId: company.id, dealId: deal.id, type: "RENT", amount: D(value), status: r.chance(0.5) ? "OVERDUE" : "PENDING", dueDate: r.chance(0.5) ? daysAgo(r.int(1, 10)) : daysAhead(r.int(1, 20)) });
        await prisma.payment.createMany({ data });
      }

      // Commission
      const total = Math.round(value * (0.015 + r.rnd() * 0.01));
      const cstatusRoll = r.rnd();
      const cstatus = cstatusRoll < 0.4 ? "PAID" : cstatusRoll < 0.75 ? "APPROVED" : "PENDING_APPROVAL";
      const approved = cstatus !== "PENDING_APPROVAL";
      const allPaid = cstatus === "PAID";
      const shares: Prisma.CommissionShareCreateManyCommissionInput[] = [];
      if (dealerId) {
        shares.push({ party: "AGENT_MAIN", userId: main, label: "Main agent", pct: D(45), amount: D(total * 0.45), paid: allPaid, paidAt: allPaid ? daysAgo(r.int(1, 20)) : null });
        shares.push({ party: "COMPANY", label: "Company", pct: D(25), amount: D(total * 0.25), paid: allPaid });
        shares.push({ party: "DEALER", dealerId, label: "Dealer share", pct: D(30), amount: D(total * 0.3), paid: allPaid });
      } else if (cos.length) {
        shares.push({ party: "AGENT_MAIN", userId: main, label: "Main agent", pct: D(50), amount: D(total * 0.5), paid: allPaid, paidAt: allPaid ? daysAgo(r.int(1, 20)) : null });
        shares.push({ party: "COMPANY", label: "Company", pct: D(25), amount: D(total * 0.25), paid: allPaid });
        const each = 25 / cos.length;
        cos.forEach((c) => shares.push({ party: "AGENT_OTHER", userId: c.id, label: "Co-agent", pct: D(each), amount: D((total * each) / 100), paid: allPaid && r.chance(0.7) }));
      } else {
        shares.push({ party: "AGENT_MAIN", userId: main, label: "Main agent", pct: D(75), amount: D(total * 0.75), paid: allPaid });
        shares.push({ party: "COMPANY", label: "Company", pct: D(25), amount: D(total * 0.25), paid: allPaid });
      }
      const commission = await prisma.commission.create({
        data: { companyId: company.id, dealId: deal.id, totalAmount: D(total), status: cstatus as Prisma.CommissionCreateInput["status"], approvedById: approved ? owner.id : null, approvedAt: approved ? daysAgo(r.int(1, 25)) : null, createdAt: closeDate ?? new Date(), shares: { create: shares } },
      });
      if (!approved) notifications.push({ companyId: company.id, userId: owner.id, type: "COMMISSION_APPROVAL", title: `Commission to approve — ${deal.reference}`, body: `${D(total)} pending approval`, link: `/commissions/${commission.id}`, read: false, createdAt: closeDate ?? new Date() });
    } else {
      // Open deals: a token or pending payment for variety.
      if (r.chance(0.5)) await prisma.payment.create({ data: { companyId: company.id, dealId: deal.id, type: "TOKEN", amount: D(value * 0.02), status: r.chance(0.5) ? "PAID" : "PENDING", paidAt: r.chance(0.5) ? daysAgo(r.int(1, 15)) : null, dueDate: daysAhead(r.int(3, 14)) } });
    }
  }

  // ── Documents ───────────────────────────────────────────
  for (let i = 0; i < cfg.counts.documents; i++) {
    const type = r.pick([...DOC_TYPES]);
    const prop = r.pick(properties);
    await prisma.document.create({
      data: {
        companyId: company.id,
        type: type as Prisma.DocumentCreateInput["type"],
        name: `${type.replace(/_/g, " ").toLowerCase()} ${i + 1}.pdf`,
        url: "/placeholder/document.pdf",
        verification: r.pick(["VERIFIED", "VERIFIED", "PENDING", "REJECTED"]) as Prisma.DocumentCreateInput["verification"],
        verifiedById: r.chance(0.6) ? admin.id : null,
        uploadedById: r.pick(agents.length ? agents : [admin]).id,
        expiryDate: r.chance(0.4) ? daysAhead(r.int(-10, 90)) : null,
        propertyId: r.chance(0.6) ? prop.id : null,
      },
    });
  }

  // Bulk-insert logs & notifications.
  if (logs.length) await prisma.activityLog.createMany({ data: logs });
  if (notifications.length) await prisma.notification.createMany({ data: notifications });

  return company;
}

async function main() {
  console.log("Seeding rich dataset…");

  await prisma.$transaction([
    prisma.commissionShare.deleteMany(), prisma.commission.deleteMany(), prisma.payment.deleteMany(), prisma.invoice.deleteMany(),
    prisma.sale.deleteMany(), prisma.rental.deleteMany(), prisma.dealAgent.deleteMany(), prisma.gpsLog.deleteMany(), prisma.showing.deleteMany(),
    prisma.calendarEvent.deleteMany(), prisma.document.deleteMany(), prisma.deal.deleteMany(), prisma.lead.deleteMany(),
    prisma.propertyAgent.deleteMany(), prisma.propertyMedia.deleteMany(), prisma.property.deleteMany(), prisma.project.deleteMany(),
    prisma.commissionRule.deleteMany(), prisma.client.deleteMany(), prisma.dealer.deleteMany(),
    prisma.notification.deleteMany(), prisma.activityLog.deleteMany(), prisma.user.deleteMany(), prisma.company.deleteMany(),
  ]);

  const hash = await bcrypt.hash(PASSWORD, 10);

  // SUPER_ADMIN lives outside any tenant — uses the platform domain.
  await prisma.user.create({
    data: {
      email: "support@proptimizr.com",
      name: "Proptimizr Support",
      passwordHash: hash,
      role: "SUPER_ADMIN",
    },
  });

  await seedCompany(
    {
      // Primary demo tenant — Pakistan-market realistic.
      name: "Clifton Heights Realty",
      plan: "GROWTH",
      refPrefix: "CHR",
      seed: 20260521,
      users: [
        { email: "owner@proptimizr.test", name: "Imran Khanani", phone: "+92 300 1112233", role: "OWNER" },
        { email: "admin@proptimizr.test", name: "Sana Riaz", phone: "+92 301 2223344", role: "ADMIN" },
        { email: "agent@proptimizr.test", name: "Bilal Ahmed", phone: "+92 302 3334455", role: "AGENT" },
        { email: "agent2@proptimizr.test", name: "Hira Sheikh", phone: "+92 303 4445566", role: "AGENT" },
        { email: "agent3@proptimizr.test", name: "Ali Raza", phone: "+92 305 5556677", role: "AGENT" },
        { email: "agent4@proptimizr.test", name: "Maria Qureshi", phone: "+92 306 6667788", role: "AGENT" },
        { email: "agent5@proptimizr.test", name: "Omar Farooq", phone: "+92 307 7778899", role: "AGENT" },
        { email: "agent6@proptimizr.test", name: "Nida Baig", phone: "+92 308 8889900", role: "AGENT" },
        { email: "dealer@proptimizr.test", name: "Faisal Property Group", phone: "+92 304 5556677", role: "DEALER" },
      ],
      counts: { dealers: 6, projects: 3, properties: 64, clients: 48, leads: 80, showings: 50, events: 64, deals: 36, documents: 38 },
    },
    hash,
  );

  await seedCompany(
    {
      name: "UrbanEdge Properties",
      plan: "STARTER",
      refPrefix: "UEP",
      seed: 77777,
      users: [
        { email: "owner@urbanedge.test", name: "Tariq Mehmood", phone: "+92 311 1234567", role: "OWNER" },
        { email: "admin@urbanedge.test", name: "Komal Javed", phone: "+92 312 2345678", role: "ADMIN" },
        { email: "agent@urbanedge.test", name: "Saad Mirza", phone: "+92 313 3456789", role: "AGENT" },
        { email: "agent2@urbanedge.test", name: "Iqra Shah", phone: "+92 314 4567890", role: "AGENT" },
        { email: "dealer@urbanedge.test", name: "Crown Builders", phone: "+92 315 5678901", role: "DEALER" },
      ],
      counts: { dealers: 3, projects: 2, properties: 22, clients: 18, leads: 28, showings: 16, events: 20, deals: 12, documents: 12 },
    },
    hash,
  );

  const [companies, props, leads, deals, payments] = await Promise.all([
    prisma.company.count(), prisma.property.count(), prisma.lead.count(), prisma.deal.count(), prisma.payment.count(),
  ]);
  console.log(`Done · ${companies} companies, ${props} properties, ${leads} leads, ${deals} deals, ${payments} payments.`);
  console.log(
    "Login (password: 'password'): owner@proptimizr.test · admin@proptimizr.test · agent@proptimizr.test · dealer@proptimizr.test · support@proptimizr.com",
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

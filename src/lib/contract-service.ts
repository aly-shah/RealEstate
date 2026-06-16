import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/wa-business";
import { sendAutomationTemplate } from "@/lib/wa-automation";
import { decryptSecret } from "@/lib/crypto";

/**
 * Contract pipeline: create the e-sign Contract for a deal — sale or rental
 * (idempotent — one per deal) — and dispatch the two public CNIC-verify links
 * over WhatsApp. Sale snapshots the price + seller/buyer; rental snapshots the
 * lease terms + landlord/renter. The verification flow is identical either way.
 *
 * Delivery caveat (important): the Meta Cloud API only allows free-form text
 * inside the 24-hour customer-service window (i.e. after the recipient has
 * messaged the business). A cold outbound link will usually be REJECTED by Meta
 * and requires an approved template instead. So this never throws on a failed
 * send — it records the outcome and ALWAYS returns the links, letting the caller
 * fall back to sharing them manually (e.g. a wa.me deep link or copy-paste).
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.proptimizr.com";

export interface ContractDispatchResult {
  contractId: string;
  landlordLink: string;
  renterLink: string;
  landlordSent: boolean;
  renterSent: boolean;
  /** Human-readable notes for anything that didn't deliver cleanly. */
  warnings: string[];
}

export async function initiateContractPipelines(dealId: string): Promise<ContractDispatchResult> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { client: true, property: true, rental: true, sale: true },
  });
  if (!deal) throw new Error("Deal not found.");

  // The two parties read as seller/buyer for a sale, landlord/renter for a lease.
  const isSale = deal.type === "SALE";
  const partyA = isSale ? "Seller" : "Landlord";
  const partyB = isSale ? "Buyer" : "Renter";

  // Deduplicate: one contract per deal (dealId is unique).
  let contract = await prisma.contract.findUnique({ where: { dealId } });
  if (!contract) {
    // Snapshot the deal's terms so later edits don't rewrite the legal record.
    // Best-available identifiers (see schema note): party A = owner phone,
    // party B = Client id.
    const base = {
      companyId: deal.companyId,
      dealId: deal.id,
      landlordId: deal.property.ownerPhone ?? null,
      renterId: deal.clientId ?? null,
      status: "AWAITING_CNIC_LANDLORD" as const,
    };
    if (isSale) {
      contract = await prisma.contract.create({
        data: { ...base, type: "SALE", salePrice: deal.sale?.salePrice ?? new Prisma.Decimal(0) },
      });
    } else {
      const rental = deal.rental;
      const months = rental?.leaseMonths ?? 11; // common Pakistan lease length
      const start = new Date();
      const end = new Date(start);
      end.setMonth(end.getMonth() + months);
      contract = await prisma.contract.create({
        data: {
          ...base,
          type: "RENTAL",
          monthlyRent: rental?.monthlyRent ?? new Prisma.Decimal(0),
          deposit: rental?.deposit ?? new Prisma.Decimal(0),
          leaseMonths: months,
          startDate: start,
          endDate: end,
        },
      });
    }
  }

  const landlordLink = `${APP_URL}/verify-identity/${contract.landlordToken}`;
  const renterLink = `${APP_URL}/verify-identity/${contract.renterToken}`;
  const warnings: string[] = [];

  // Resolve the tenant's Meta credentials once (token is stored encrypted).
  const company = await prisma.company.findUnique({
    where: { id: deal.companyId },
    select: { whatsappPhoneId: true, whatsappAccessToken: true },
  });
  const phoneNumberId = company?.whatsappPhoneId ?? null;
  const accessToken = decryptSecret(company?.whatsappAccessToken);
  const waReady = !!phoneNumberId && !!accessToken;
  if (!waReady) {
    warnings.push("WhatsApp isn't configured for this company — share the links manually.");
  }

  // Per-party send: try the company's approved CONTRACT_VERIFY template first
  // (the ONLY thing that delivers outside Meta's 24h window — the whole point
  // for a cold contract link), then fall back to free-form text inside the
  // window, then leave the link for manual sharing. Template body params are
  // positional: {{1}} recipient name, {{2}} property title, {{3}} verify link.
  const sendLink = async (
    party: string,
    phone: string,
    name: string,
    link: string,
    fallbackBody: string,
  ): Promise<boolean> => {
    const tpl = await sendAutomationTemplate({
      companyId: deal.companyId,
      event: "CONTRACT_VERIFY",
      toPhone: phone,
      bodyParams: [name, deal.property.title, link],
    });
    if (tpl.ok) return true;
    // A configured mapping that failed is a real error worth surfacing; an
    // unconfigured one just means "no template yet" → try free-form.
    if (tpl.configured) warnings.push(`${party} template send failed (${tpl.reason}).`);
    if (waReady) {
      const r = await sendWhatsAppText({ phoneNumberId: phoneNumberId!, accessToken: accessToken!, toPhone: phone, body: fallbackBody });
      if (r.ok) return true;
      warnings.push(`${party} WhatsApp not delivered (${r.error}).`);
    }
    return false;
  };

  let landlordSent = false;
  let renterSent = false;
  const agreementNoun = isSale ? "sale agreement" : "lease";

  if (!deal.property.ownerPhone) {
    warnings.push(`No ${partyA.toLowerCase()} phone on the property — ${partyA.toLowerCase()} link not sent.`);
  } else {
    landlordSent = await sendLink(
      partyA,
      deal.property.ownerPhone,
      deal.property.ownerName ?? "there",
      landlordLink,
      `Assalam-o-Alaikum,\n\nTo complete the ${agreementNoun} for "${deal.property.title}", please tap this secure link ` +
        `and photograph your CNIC for verification:\n\n${landlordLink}`,
    );
  }

  if (!deal.client?.phone) {
    warnings.push(`No ${partyB.toLowerCase()} phone on the client — ${partyB.toLowerCase()} link not sent.`);
  } else {
    renterSent = await sendLink(
      partyB,
      deal.client.phone,
      deal.client.name ?? "there",
      renterLink,
      `Assalam-o-Alaikum,\n\nTo complete your ${agreementNoun} verification, please tap this secure link ` +
        `and photograph your CNIC:\n\n${renterLink}`,
    );
  }

  return { contractId: contract.id, landlordLink, renterLink, landlordSent, renterSent, warnings };
}

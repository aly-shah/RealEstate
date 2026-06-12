import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/wa-business";
import { decryptSecret } from "@/lib/crypto";

/**
 * Contract pipeline: create the rental e-sign Contract for a deal (idempotent —
 * one per deal) and dispatch the two public CNIC-verify links over WhatsApp.
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
    include: { client: true, property: true, rental: true },
  });
  if (!deal) throw new Error("Deal not found.");
  if (deal.type !== "RENTAL") throw new Error("Contracts can only run for rental deals.");

  // Deduplicate: one contract per deal (dealId is unique).
  let contract = await prisma.contract.findUnique({ where: { dealId } });
  if (!contract) {
    const rental = deal.rental;
    const months = rental?.leaseMonths ?? 11; // common Pakistan lease length
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);

    contract = await prisma.contract.create({
      data: {
        companyId: deal.companyId,
        dealId: deal.id,
        // Snapshot the rental terms so later deal edits don't rewrite the record.
        monthlyRent: rental?.monthlyRent ?? new Prisma.Decimal(0),
        deposit: rental?.deposit ?? new Prisma.Decimal(0),
        leaseMonths: months,
        startDate: start,
        endDate: end,
        // Best-available identifiers (see schema note): landlord = owner phone,
        // renter = Client id.
        landlordId: deal.property.ownerPhone ?? null,
        renterId: deal.clientId ?? null,
        status: "AWAITING_CNIC_LANDLORD",
      },
    });
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

  let landlordSent = false;
  let renterSent = false;

  // Landlord link.
  if (!deal.property.ownerPhone) {
    warnings.push("No landlord phone on the property — landlord link not sent.");
  } else if (waReady) {
    const r = await sendWhatsAppText({
      phoneNumberId: phoneNumberId!,
      accessToken: accessToken!,
      toPhone: deal.property.ownerPhone,
      body:
        `Assalam-o-Alaikum,\n\nTo complete the lease for "${deal.property.title}", please tap this secure link ` +
        `and photograph your CNIC for verification:\n\n${landlordLink}`,
    });
    landlordSent = r.ok;
    if (!r.ok) warnings.push(`Landlord WhatsApp not delivered (${r.error}).`);
  }

  // Renter link.
  if (!deal.client?.phone) {
    warnings.push("No renter phone on the client — renter link not sent.");
  } else if (waReady) {
    const r = await sendWhatsAppText({
      phoneNumberId: phoneNumberId!,
      accessToken: accessToken!,
      toPhone: deal.client.phone,
      body:
        `Assalam-o-Alaikum,\n\nTo complete your rental lease verification, please tap this secure link ` +
        `and photograph your CNIC:\n\n${renterLink}`,
    });
    renterSent = r.ok;
    if (!r.ok) warnings.push(`Renter WhatsApp not delivered (${r.error}).`);
  }

  return { contractId: contract.id, landlordLink, renterLink, landlordSent, renterSent, warnings };
}

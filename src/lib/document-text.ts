import type { DealDocKind } from "@/lib/deal-documents";
import { money, fmtDate, toNumber } from "@/lib/format";

/**
 * Plain-text rendering of each generated document's standard body. Used to
 * PRE-FILL the on-page editor so an operator edits the existing text in place
 * (tweak a clause, a figure, a name) instead of rewriting from scratch. Saving
 * stores the edited text as a replace override; the document then renders that
 * text verbatim.
 */
export interface DocTextParty {
  name: string;
  cnic: string;
  phone: string;
}

export interface DocTextData {
  isSale: boolean;
  partyA: DocTextParty;
  partyB: DocTextParty;
  t: {
    salePrice: unknown;
    tokenAmount: unknown;
    downPayment: unknown;
    monthlyRent: unknown;
    deposit: unknown;
    leaseMonths: number | null;
    startDate: Date | null;
    endDate: Date | null;
    possessionDate: Date | null;
    clauses: string | null;
  };
  property: { title: string; reference: string };
  propLine: string;
}

const m = (v: unknown) => (v == null ? "—" : money(v as never));
const dt = (v: Date | null) => (v ? fmtDate(v) : "____________");

export function documentPlainText(kind: DealDocKind, d: DocTextData): string {
  const { partyA, partyB, t, property, propLine, isSale } = d;
  const propBlock = `PROPERTY: ${property.title}${propLine ? `\n${propLine}` : ""}\nRef: ${property.reference}`;
  const clauses = t.clauses ? `\n\nSPECIAL CLAUSES:\n${t.clauses}` : "";
  const sign = (a: string, b: string) =>
    `\n\n_____________________________          _____________________________\n` +
    `${partyA.name} (${a})          ${partyB.name} (${b})\n` +
    `CNIC: ${partyA.cnic}          CNIC: ${partyB.cnic}\n\n` +
    `Witness 1: ____________________          Witness 2: ____________________`;

  switch (kind) {
    case "agreement": {
      if (isSale) {
        const balance =
          toNumber(t.salePrice as never) - toNumber((t.tokenAmount ?? 0) as never) - toNumber((t.downPayment ?? 0) as never);
        return (
          `This Agreement to Sell is made between the parties named below for the property described herein.\n\n` +
          `SELLER (First Party): ${partyA.name}, CNIC ${partyA.cnic}, Phone ${partyA.phone}\n` +
          `BUYER (Second Party): ${partyB.name}, CNIC ${partyB.cnic}, Phone ${partyB.phone}\n\n` +
          `${propBlock}\n\n` +
          `TERMS:\n` +
          `- Total sale price: ${m(t.salePrice)}\n` +
          `- Token / bayana paid: ${m(t.tokenAmount)}\n` +
          `- Down payment: ${m(t.downPayment)}\n` +
          `- Balance payable: ${money(balance as never)}\n` +
          `- Possession date: ${dt(t.possessionDate)}\n\n` +
          `TERMS & CONDITIONS:\n` +
          `1. The Seller agrees to sell and the Buyer agrees to purchase the property at the total price stated.\n` +
          `2. The token / bayana is paid as earnest money and adjusted against the total sale price.\n` +
          `3. The balance shall be paid at transfer / registry, against which vacant possession is handed over.\n` +
          `4. All taxes, transfer fees and utility dues up to the date of transfer are settled as agreed.\n` +
          `5. On Buyer default the token may be forfeited; on Seller default it shall be returned, subject to settlement.` +
          clauses +
          sign("Seller", "Buyer")
        );
      }
      return (
        `This Rental / Lease Agreement is made between the parties named below for the property described herein.\n\n` +
        `LANDLORD (First Party): ${partyA.name}, CNIC ${partyA.cnic}, Phone ${partyA.phone}\n` +
        `TENANT (Second Party): ${partyB.name}, CNIC ${partyB.cnic}, Phone ${partyB.phone}\n\n` +
        `${propBlock}\n\n` +
        `TERMS:\n` +
        `- Monthly rent: ${m(t.monthlyRent)}\n` +
        `- Security deposit: ${m(t.deposit)}\n` +
        `- Lease term: ${t.leaseMonths != null ? `${t.leaseMonths} months` : "____"}\n` +
        `- Start date: ${dt(t.startDate)}\n` +
        `- End date: ${dt(t.endDate)}\n\n` +
        `TERMS & CONDITIONS:\n` +
        `1. The Landlord lets and the Tenant takes the property on rent for the term stated.\n` +
        `2. Rent is payable monthly in advance; the deposit is refundable at the end of the term less lawful deductions.\n` +
        `3. Utility bills and routine maintenance during the tenancy are borne by the Tenant unless agreed otherwise.\n` +
        `4. The Tenant shall not sublet or structurally alter the property without the Landlord's written consent.\n` +
        `5. Either party may terminate by serving the agreed notice; the property is returned in its original condition.` +
        clauses +
        sign("Landlord", "Tenant")
      );
    }

    case "sale-deed":
      return (
        `This Sale Deed is executed between the Seller (First Party) and the Buyer (Second Party) named below, ` +
        `transferring absolute ownership of the property described herein.\n\n` +
        `SELLER: ${partyA.name}, CNIC ${partyA.cnic}\n` +
        `BUYER: ${partyB.name}, CNIC ${partyB.cnic}\n\n` +
        `${propBlock}\n\n` +
        `WHEREAS the Seller is the lawful and absolute owner in peaceful possession of the said property, free from all ` +
        `encumbrances, charges, liens, litigation and disputes; AND WHEREAS the Seller has agreed to sell and the Buyer ` +
        `to purchase it for a total consideration of ${m(t.salePrice)}.\n\n` +
        `NOW THIS DEED WITNESSES that in consideration of the said sum, the receipt of which the Seller acknowledges, the ` +
        `Seller hereby sells, transfers and conveys unto the Buyer all rights, title and interest in the said property, ` +
        `to have and to hold the same absolutely and forever.\n\n` +
        `1. The Seller has delivered / shall deliver vacant physical possession to the Buyer.\n` +
        `2. The Seller warrants clear title and shall indemnify the Buyer against any third-party claim.\n` +
        `3. All taxes, utility dues and society charges up to the date of transfer are cleared by the Seller.\n` +
        `4. Transfer / registration costs shall be borne as agreed between the parties.\n` +
        `5. This transfer shall be recorded with the relevant authority / society / sub-registrar.` +
        clauses +
        sign("Seller", "Buyer")
      );

    case "payment-plan": {
      const total = toNumber(t.salePrice as never);
      const token = toNumber((t.tokenAmount ?? 0) as never);
      const down = toNumber((t.downPayment ?? 0) as never);
      const balance = Math.max(0, total - token - down);
      return (
        `Payment schedule for ${partyB.name} against the purchase of ${property.title} (Ref: ${property.reference}).\n\n` +
        `STAGE                     MILESTONE                       AMOUNT          STATUS\n` +
        `Token / Bayana            On booking                      ${m(t.tokenAmount)}          Paid\n` +
        `Down payment              On signing the agreement        ${m(t.downPayment)}          Due\n` +
        `Balance on transfer       At transfer & possession        ${money(balance as never)}          Due\n` +
        `Total sale price                                          ${m(t.salePrice)}\n\n` +
        `Amounts are derived from the contract terms. Dates and instalments may be adjusted by mutual agreement.` +
        clauses
      );
    }

    case "receipt": {
      const amount = isSale ? (t.tokenAmount ?? t.downPayment) : t.deposit;
      const purpose = isSale ? "token / booking amount" : "security deposit";
      return (
        `Received with thanks from ${partyB.name} the sum of ${m(amount)} towards the ${purpose} for the property ` +
        `${property.title} (Ref: ${property.reference}).\n\n` +
        `Received from: ${partyB.name}\n` +
        `Amount: ${m(amount)}\n` +
        `Towards: ${isSale ? "Token / Booking" : "Security Deposit"}\n` +
        `Property: ${property.title}\n` +
        `Reference: ${property.reference}\n\n\n` +
        `_____________________________\n${partyA.name}\nReceived by`
      );
    }

    case "possession": {
      const recipient = isSale ? "Buyer" : "Tenant";
      return (
        `This note confirms that vacant physical possession of the property described below has been handed over by ` +
        `${partyA.name} to ${partyB.name} (${recipient})${t.possessionDate ? ` on ${fmtDate(t.possessionDate)}` : ""}.\n\n` +
        `${propBlock}\n\n` +
        `1. The ${recipient} acknowledges receiving possession in acceptable condition, with keys and access handed over.\n` +
        `2. Meter readings and utility accounts are recorded as of the possession date.\n` +
        `3. Any pending items noted by the parties are listed in the special clauses / annexure.` +
        clauses +
        sign(isSale ? "Seller" : "Landlord", recipient)
      );
    }

    case "noc":
      return (
        `TO WHOM IT MAY CONCERN\n\n` +
        `I, ${partyA.name} (CNIC ${partyA.cnic}), the lawful owner of the property described below, hereby state that I ` +
        `have NO OBJECTION to the ${isSale ? "sale and transfer" : "tenancy"} of the said property ` +
        `${isSale ? "to" : "in favour of"} ${partyB.name} (CNIC ${partyB.cnic}).\n\n` +
        `${propBlock}\n\n` +
        `This certificate is issued for the purpose of ${isSale ? "transfer / registration of the property" : "lease registration and tenant verification"} ` +
        `on the request of the concerned party. I confirm that, to the best of my knowledge, the property is free from any ` +
        `dispute or encumbrance.\n\n\n` +
        `_____________________________\n${partyA.name}\nOwner — CNIC ${partyA.cnic}`
      );

    case "affidavit": {
      const deponent = isSale ? partyA : partyB;
      const body = isSale
        ? `1. That I am the lawful and absolute owner of the property described below.\n` +
          `2. That the said property is free from all encumbrances, mortgages, charges, litigation and disputes.\n` +
          `3. That I have full authority to sell and transfer it, and no other person has any right, title or interest therein.\n` +
          `4. That I have received the agreed consideration and shall indemnify the purchaser against any loss arising from a defect in title.\n` +
          `5. That the contents of this affidavit are true and correct to the best of my knowledge and belief.`
        : `1. That I have taken the property described below on rent from the Landlord on the agreed terms.\n` +
          `2. That I shall use the premises for lawful purposes only and pay the rent regularly.\n` +
          `3. That I shall not sublet or structurally alter the premises without the Landlord's written consent.\n` +
          `4. That I shall bear the utility charges and vacate the premises on expiry / termination as per the agreement.\n` +
          `5. That the contents of this undertaking are true and correct to the best of my knowledge.`;
      return (
        `AFFIDAVIT\n(On stamp paper of the requisite value)\n\n` +
        `I, ${deponent.name}, holder of CNIC ${deponent.cnic}, do hereby solemnly affirm and declare as under:\n\n` +
        `${body}\n\n` +
        `${propBlock}\n\n\n` +
        `_____________________________          _____________________________\n` +
        `Oath Commissioner / Notary Public          ${deponent.name} (Deponent)\n` +
        `          CNIC: ${deponent.cnic}`
      );
    }

    case "power-of-attorney":
      return (
        `KNOW ALL MEN BY THESE PRESENTS that I, ${partyA.name} (CNIC ${partyA.cnic}) (the "Principal"), do hereby ` +
        `nominate, constitute and appoint ${partyB.name} (CNIC ${partyB.cnic}) (the "Attorney") to be my true and lawful ` +
        `attorney, to act for me and in my name in respect of the property described below.\n\n` +
        `${propBlock}\n\n` +
        `POWERS GRANTED:\n` +
        `1. To represent me before the Sub-Registrar, housing society, development authority and all concerned offices.\n` +
        `2. To sign, execute, present and admit for registration all documents, deeds, transfer and mutation papers.\n` +
        `3. To pay and receive fees, taxes and dues and to obtain receipts, NOCs and possession on my behalf.\n` +
        `4. To appear before authorities, give statements, and do all acts necessary to complete the transfer / management.\n` +
        `5. That all lawful acts done by the Attorney under this authority shall be binding on me as if done by me personally.\n\n` +
        `This Power of Attorney is to be executed on stamp paper of the requisite value and attested before a Notary ` +
        `Public / Oath Commissioner.\n\n\n` +
        `_____________________________          _____________________________\n` +
        `Oath Commissioner / Notary Public          ${partyA.name} (Principal)\n` +
        `          CNIC: ${partyA.cnic}`
      );

    case "tax-certificate":
      return (
        `This certificate records the tax position for the transfer of the property described below between ` +
        `${partyA.name} (Seller) and ${partyB.name} (Buyer).\n\n` +
        `${propBlock}\n` +
        `Declared value: ${m(t.salePrice)}\n\n` +
        `TAX HEAD                       REFERENCE          CHALLAN / CPR NO.          AMOUNT\n` +
        `Advance Tax — Seller           u/s 236C           ____________________          ____________\n` +
        `Advance Tax — Buyer            u/s 236K           ____________________          ____________\n` +
        `Capital Value Tax (CVT)        provincial         ____________________          ____________\n` +
        `Stamp Duty                     provincial         ____________________          ____________\n` +
        `Registration / Transfer Fee    society/registrar  ____________________          ____________\n\n` +
        `Amounts are to be entered from the paid FBR / provincial challans (CPRs), copies of which are attached.\n\n\n` +
        `_____________________________          _____________________________\n` +
        `${partyA.name} (Seller)          ${partyB.name} (Buyer)`
      );
  }
}

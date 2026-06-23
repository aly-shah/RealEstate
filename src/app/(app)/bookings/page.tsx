import { requireCompanyUser, isScopedToSelf } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { money, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewBookingButton } from "./NewBookingButton";
import { BookingActions } from "./BookingActions";

const STATUS_TONE: Record<string, "ok" | "accent" | "warn" | "neutral" | "danger"> = {
  PENDING: "warn",
  APPROVED: "ok",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export default async function BookingsPage() {
  const user = await requireCompanyUser();
  const office = !isScopedToSelf(user.role);
  const canBook = can(user.role, "manageProperties");

  // Scope: office sees all; a dealer sees their own; an agent sees what they booked.
  const dealer = user.role === "DEALER"
    ? await prisma.dealer.findFirst({ where: { companyId: user.companyId, userId: user.id }, select: { id: true } })
    : null;
  const where = office
    ? { companyId: user.companyId }
    : user.role === "DEALER"
      ? { companyId: user.companyId, dealerId: dealer?.id ?? "__none__" }
      : { companyId: user.companyId, bookedById: user.id };

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true, status: true, price: true, discount: true, clientName: true, clientId: true,
      dealerId: true, bookedById: true, version: true, createdAt: true,
      property: { select: { reference: true, project: { select: { name: true } } } },
    },
  });

  // Resolve scalar-FK names in batched lookups (booking keeps these as plain ids).
  const dealerIds = [...new Set(bookings.map((b) => b.dealerId).filter((x): x is string => !!x))];
  const clientIds = [...new Set(bookings.map((b) => b.clientId).filter((x): x is string => !!x))];
  const [dealers, clients, bookableUnits, allClients] = await Promise.all([
    dealerIds.length ? prisma.dealer.findMany({ where: { id: { in: dealerIds } }, select: { id: true, name: true } }) : [],
    clientIds.length ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [],
    // Units this user may book: a dealer's allocated AVAILABLE units, else any AVAILABLE project unit.
    canBook
      ? prisma.property.findMany({
          where: { companyId: user.companyId, status: "AVAILABLE", projectId: { not: null }, ...(dealer ? { dealerId: dealer.id } : {}) },
          orderBy: [{ tower: "asc" }, { floorNumber: "desc" }],
          take: 200,
          select: { id: true, reference: true, salePrice: true, project: { select: { name: true } } },
        })
      : [],
    canBook ? prisma.client.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }) : [],
  ]);
  const plans = canBook
    ? await prisma.paymentPlanTemplate.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const dealerName = new Map(dealers.map((d) => [d.id, d.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const pendingCount = bookings.filter((b) => b.status === "PENDING").length;

  return (
    <div>
      <PageHeader
        eyebrow="Channel sales"
        title="Bookings"
        subtitle={office ? `${pendingCount} pending approval` : "Your unit bookings and their approval status."}
        action={canBook ? <NewBookingButton units={bookableUnits.map((u) => ({ id: u.id, label: `${u.reference}${u.project ? " · " + u.project.name : ""}`, price: u.salePrice ? Number(u.salePrice) : 0 }))} clients={allClients} plans={plans} /> : null}
      />

      {bookings.length === 0 ? (
        <EmptyState title="No bookings yet" hint={canBook ? "Book an available unit for a client to get started." : "Bookings will appear here once your team starts selling."} />
      ) : (
        <Table head={["Unit", "Project", "Buyer", "Dealer", "Price", "Status", "Date", ...(office ? ["Action"] : [])]}>
          {bookings.map((b) => (
            <tr key={b.id} className="hover:bg-line-soft">
              <Td className="font-medium text-ink">{b.property?.reference ?? "—"}</Td>
              <Td className="text-muted">{b.property?.project?.name ?? "—"}</Td>
              <Td>{b.clientId ? clientName.get(b.clientId) ?? "—" : b.clientName ?? "—"}</Td>
              <Td className="text-muted">{b.dealerId ? dealerName.get(b.dealerId) ?? "—" : "Direct"}</Td>
              <Td className="font-medium">{money(b.price)}{b.discount ? <span className="ml-1 text-xs text-muted">(−{money(b.discount)})</span> : null}</Td>
              <Td><Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status}</Badge></Td>
              <Td className="text-xs text-muted">{fmtDate(b.createdAt)}</Td>
              {office && (
                <Td>{b.status === "PENDING" ? <BookingActions bookingId={b.id} /> : <span className="text-xs text-muted">—</span>}</Td>
              )}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

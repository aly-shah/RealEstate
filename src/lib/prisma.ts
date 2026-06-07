import { PrismaClient } from "@prisma/client";
import { recordQuery, detectNPlusOne } from "@/lib/query-optimizer";

/**
 * Tenant-scoped models — a list read on any of these that carries no company
 * reference in its `where` is *probably* a missing scope. We warn (never throw)
 * in development as a safety net for the explicit scope.ts system; production
 * skips the check entirely (zero overhead, no behavioural change).
 */
const TENANT_LIST_MODELS = new Set([
  "Lead", "Property", "Deal", "Payment", "Invoice", "Commission",
  "CommissionShare", "Client", "Document", "CalendarEvent", "Showing",
  "Notification", "AiSuggestion",
]);
const LIST_OP = /^(findMany|count|aggregate|groupBy)$/;

function extend(base: PrismaClient) {
  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (process.env.NODE_ENV !== "production") {
          recordQuery(model, operation);
          detectNPlusOne();
          if (model && TENANT_LIST_MODELS.has(model) && LIST_OP.test(operation)) {
            const where = JSON.stringify((args as { where?: unknown })?.where ?? {});
            // "company" covers both `companyId` and relation filters like
            // `{ commission: { companyId } }` / `{ deal: { companyId } }`.
            if (!where.toLowerCase().includes("company")) {
              console.warn(
                `[tenant-guard] ${model}.${operation} has no company scope in its where — ` +
                  `confirm this isn't a tenant leak (scope via lib/scope.ts).`,
              );
            }
          }
        }
        return query(args);
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof extend> | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  extend(
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    }),
  );

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { recordQuery, detectNPlusOne } from "@/lib/query-optimizer";

/**
 * Tenant-scoped models — a list read on any of these that carries no company
 * reference in its `where` is *probably* a missing scope and a cross-tenant
 * leak. The guard never auto-injects a scope; it only detects a missing one:
 *   - development / test: THROW, so the leak surfaces immediately, and
 *   - production: LOG (console.error, model+op only — no data) so it's alertable
 *     without ever breaking live traffic.
 * Intentionally non-company-scoped reads (anchored by userId or a tenant-owned
 * foreign key, or platform/super-admin reads) opt out via `runUnscoped`.
 */
const TENANT_LIST_MODELS = new Set([
  "Lead", "Property", "Deal", "Payment", "Invoice", "Commission",
  "CommissionShare", "Client", "Document", "CalendarEvent", "Showing",
  "Notification", "AiSuggestion",
]);
const LIST_OP = /^(findMany|count|aggregate|groupBy)$/;

const unscopedCtx = new AsyncLocalStorage<{ reason: string }>();

/**
 * Marks a block as intentionally NOT company-scoped so the tenant guard skips it.
 * Use ONLY when the query is anchored by another tenant-safe key (a userId, or a
 * foreign key to a record that was itself fetched under tenant scope), or for
 * genuine platform/super-admin reads. `reason` documents the intent at the call
 * site for auditing.
 */
export function runUnscoped<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  // The query must be AWAITED inside the ALS scope: a PrismaPromise is lazy, so
  // the guard hook only runs when it's awaited — returning the unawaited promise
  // would move the await into the caller's (scopeless) context and defeat the
  // opt-out. Awaiting here keeps the store active while the hook runs.
  return unscopedCtx.run({ reason }, async () => await fn());
}

/** True when the where references a company scope (companyId or a relation like
 *  `{ commission: { companyId } }` / `{ deal: { companyId } }`). Exported for tests. */
export function isCompanyScoped(args: unknown): boolean {
  const where = (args as { where?: unknown } | null)?.where;
  if (where == null) return false;
  return JSON.stringify(where).toLowerCase().includes("company");
}

function extend(base: PrismaClient) {
  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (process.env.NODE_ENV !== "production") {
          recordQuery(model, operation);
          detectNPlusOne();
        }
        // Tenant guard — runs in every environment (throw in dev, log in prod).
        if (model && TENANT_LIST_MODELS.has(model) && LIST_OP.test(operation)) {
          if (!isCompanyScoped(args) && !unscopedCtx.getStore()) {
            const msg =
              `[tenant-guard] ${model}.${operation} has no company scope in its where — ` +
              `possible cross-tenant leak. Scope via lib/scope.ts, or wrap the call in ` +
              `runUnscoped("reason", () => …) when it's intentionally anchored by another ` +
              `tenant-safe key (userId / a tenant-owned foreign key) or is a platform read.`;
            if (process.env.NODE_ENV === "production") console.error(msg);
            else throw new Error(msg);
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

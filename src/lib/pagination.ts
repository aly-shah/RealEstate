/**
 * URL-state pagination helpers. Server-side pages read `page` + `pageSize`
 * from their searchParams and call `parsePage()` to get clamped values and
 * the Prisma `skip` offset.
 */
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

export interface PageState {
  page: number;
  pageSize: number;
  skip: number;
}

export function parsePage(
  searchParams: { page?: string; pageSize?: string },
  defaultSize: number = DEFAULT_PAGE_SIZE,
): PageState {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const requested = Number(searchParams.pageSize) || defaultSize;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, requested));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/**
 * Keyset (cursor) pagination — for large lists where `OFFSET n` would scan and
 * discard n rows on every deep page. Offset paging (`parsePage`) stays the
 * default for small/admin lists that want page numbers + a total count; reach
 * for keyset on the hot, unbounded lists (leads, properties, payments, activity).
 *
 * The cursor encodes `(createdAt, id)` so a stable secondary sort on `id`
 * breaks ties when two rows share a timestamp — without it, keyset paging can
 * skip or duplicate rows at the boundary. Pairs with the existing
 * `[companyId, createdAt]` indexes, so each page is an index seek, not a scan.
 *
 * Usage:
 *   const { take, cursor } = parseKeyset(sp);
 *   const rows = await prisma.lead.findMany({
 *     where: { AND: [leadScope(user), keysetWhere(cursor)] },
 *     orderBy: [{ createdAt: "desc" }, { id: "desc" }],
 *     take: take + 1,                       // over-fetch one to detect "has next"
 *   });
 *   const { items, nextCursor } = sliceKeyset(rows, take);
 */
export interface Cursor {
  id: string;
  createdAt: Date;
}
export interface KeysetState {
  take: number;
  cursor?: Cursor;
}

/** Decode an opaque `?after=` token (base64url of `ISO|id`); ignores garbage. */
export function parseKeyset(
  searchParams: { after?: string; pageSize?: string },
  defaultSize: number = DEFAULT_PAGE_SIZE,
): KeysetState {
  const requested = Number(searchParams.pageSize) || defaultSize;
  const take = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, requested));
  if (!searchParams.after) return { take };
  try {
    const decoded = Buffer.from(searchParams.after, "base64url").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep <= 0) return { take };
    const createdAt = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (id && !Number.isNaN(createdAt.getTime())) return { take, cursor: { id, createdAt } };
  } catch {
    /* malformed token → first page */
  }
  return { take };
}

/** Encode a row's `(createdAt, id)` into an opaque `after` token. */
export function encodeCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
}

/**
 * Prisma `where` fragment for "strictly after this cursor" under a
 * `[{ createdAt: "desc" }, { id: "desc" }]` ordering. Returns `{}` for the
 * first page so it composes cleanly inside an `AND`.
 */
export function keysetWhere(cursor?: Cursor): {
  OR?: { createdAt: { lt: Date } | Date; id?: { lt: string } }[];
} {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/** Split an over-fetched page (take + 1) into items + the next cursor (or null). */
export function sliceKeyset<T extends { id: string; createdAt: Date }>(
  rows: T[],
  take: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= take) return { items: rows, nextCursor: null };
  const items = rows.slice(0, take);
  return { items, nextCursor: encodeCursor(items[items.length - 1]) };
}

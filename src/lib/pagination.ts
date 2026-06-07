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
 * Bidirectional: `?after=` pages toward older rows, `?before=` pages back
 * toward newer ones — so Prev/Next both work without OFFSET. The inherent
 * trade-off is no total count + no jump-to-page-N (keyset can't cheaply do
 * either). The cursor encodes `(sortValue, id)`; the `id` tiebreak keeps rows
 * that share a sort timestamp from being skipped or duplicated at a boundary.
 *
 * Field-generic: pass the sort column (e.g. "updatedAt" or "createdAt") to
 * keysetWhere / keysetOrderBy. NOTE: with a *mutable* sort column (updatedAt)
 * a row edited mid-paging can shift position — the same staleness offset paging
 * already has, no worse.
 *
 * Usage:
 *   const params = parseKeyset(sp);
 *   const rows = await prisma.lead.findMany({
 *     where: { AND: [leadScope(user), keysetWhere(params, "updatedAt") as Prisma.LeadWhereInput] },
 *     orderBy: keysetOrderBy(params, "updatedAt") as Prisma.LeadOrderByWithRelationInput[],
 *     take: params.take + 1,                 // over-fetch one to detect "has more"
 *   });
 *   const { items, prevCursor, nextCursor } = sliceKeyset(rows, params, (l) => l.updatedAt);
 */
export type KeysetDirection = "forward" | "backward";
export interface Cursor {
  id: string;
  ts: Date;
}
export interface KeysetParams {
  take: number;
  cursor?: Cursor;
  direction: KeysetDirection;
}

function decodeCursor(token: string): Cursor | undefined {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep <= 0) return undefined;
    const ts = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (id && !Number.isNaN(ts.getTime())) return { id, ts };
  } catch {
    /* malformed token */
  }
  return undefined;
}

/** Encode a row's `(sortValue, id)` into an opaque cursor token. */
export function encodeCursor(id: string, ts: Date): string {
  return Buffer.from(`${ts.toISOString()}|${id}`).toString("base64url");
}

/** Read take + cursor + scan direction from `?after=` / `?before=` / `?pageSize=`. */
export function parseKeyset(
  searchParams: { after?: string; before?: string; pageSize?: string },
  defaultSize: number = DEFAULT_PAGE_SIZE,
): KeysetParams {
  const requested = Number(searchParams.pageSize) || defaultSize;
  const take = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, requested));
  if (searchParams.before) {
    const cursor = decodeCursor(searchParams.before);
    if (cursor) return { take, cursor, direction: "backward" };
  }
  if (searchParams.after) {
    const cursor = decodeCursor(searchParams.after);
    if (cursor) return { take, cursor, direction: "forward" };
  }
  return { take, direction: "forward" };
}

/**
 * Prisma `where` fragment selecting rows strictly past the cursor in the scan
 * direction (forward = older, backward = newer). `{}` on the first page, so it
 * composes inside an `AND`. Use the same `field` as keysetOrderBy.
 */
export function keysetWhere(params: KeysetParams, field: string = "createdAt"): Record<string, unknown> {
  const { cursor, direction } = params;
  if (!cursor) return {};
  const op = direction === "backward" ? "gt" : "lt";
  return {
    OR: [
      { [field]: { [op]: cursor.ts } },
      { [field]: cursor.ts, id: { [op]: cursor.id } },
    ],
  };
}

/**
 * orderBy for a keyset scan: forward scans DESC (newest first); backward scans
 * ASC (rows nearest the cursor first) — sliceKeyset re-reverses a backward page
 * back to DESC for display.
 */
export function keysetOrderBy(
  params: KeysetParams,
  field: string = "createdAt",
): Record<string, "asc" | "desc">[] {
  const dir = params.direction === "backward" ? "asc" : "desc";
  return [{ [field]: dir }, { id: dir }];
}

/**
 * Split an over-fetched page (query ran with `take + 1`) into display rows
 * (always newest-first) plus prev/next cursor tokens (`null` = end of list in
 * that direction). `getTs` reads the sort value from a row.
 */
export function sliceKeyset<T extends { id: string }>(
  rows: T[],
  params: KeysetParams,
  getTs: (row: T) => Date,
): { items: T[]; prevCursor: string | null; nextCursor: string | null } {
  const { take, cursor, direction } = params;
  const hasExtra = rows.length > take;
  let items = hasExtra ? rows.slice(0, take) : rows;
  if (direction === "backward") items = [...items].reverse(); // ASC scan → DESC display

  const newest = items[0];
  const oldest = items[items.length - 1];
  const tok = (row: T | undefined) => (row ? encodeCursor(row.id, getTs(row)) : null);

  let prevCursor: string | null;
  let nextCursor: string | null;
  if (direction === "forward") {
    // A previous (newer) page exists iff we arrived here via a cursor.
    prevCursor = cursor ? tok(newest) : null;
    nextCursor = hasExtra ? tok(oldest) : null;
  } else {
    // Arrived from older rows, so a next (older) page always exists.
    nextCursor = tok(oldest);
    prevCursor = hasExtra ? tok(newest) : null;
  }
  return { items, prevCursor, nextCursor };
}

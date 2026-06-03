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

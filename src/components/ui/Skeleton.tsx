/**
 * Tiny shimmer block used by the per-route loading.tsx files. Composes via
 * className so callers can swap height/width/radius per-context. Keeps the
 * pattern consistent without forcing a "PropertySkeleton" / "DealSkeleton"
 * component per page.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-lg bg-line-soft ${className}`}
    />
  );
}

/** Convenience block: a card-shaped skeleton matching `.surface` dimensions. */
export function SkeletonCard({ className = "h-32" }: { className?: string }) {
  return <Skeleton className={`surface ${className} !bg-line-soft`} />;
}

/** Four stat-card placeholders in a 2×4 grid — matches the dashboard pattern. */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[110px]" />
      ))}
    </div>
  );
}

/** Table-row placeholders for list pages. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="surface overflow-hidden">
      <Skeleton className="h-10 rounded-none border-b border-line bg-canvas/60" />
      <div className="divide-y divide-line-soft">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

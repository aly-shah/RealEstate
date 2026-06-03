import { Skeleton, StatGridSkeleton } from "@/components/ui/Skeleton";

// Reports does ~10 parallel Prisma queries; this is the slowest non-detail
// page in the app and the one users feel most. Cheap to fill the layout
// with placeholders so it doesn't look broken during cold-cache renders.
export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <StatGridSkeleton count={4} />
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  );
}

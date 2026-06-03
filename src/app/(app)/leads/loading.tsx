import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function LeadsLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-48" />
      </div>
      {/* Pipeline-tile strip placeholder */}
      <div className="flex gap-1 overflow-x-auto">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-16 min-w-[110px] flex-1" />
        ))}
      </div>
      <Skeleton className="h-12" />
      <TableSkeleton rows={8} />
    </div>
  );
}

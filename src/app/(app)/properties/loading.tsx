import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function PropertiesLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-12" />
      <TableSkeleton rows={8} />
    </div>
  );
}

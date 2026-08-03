import { Skeleton } from "@/components/ui/skeleton";

export default function HistoryLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="mt-4 h-10 w-full rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}

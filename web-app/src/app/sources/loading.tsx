import { Skeleton } from "@/components/ui/skeleton";

export default function SourcesLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-96" />
      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-2">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
        <div className="h-64 rounded-2xl border border-border bg-surface p-5">
          <Skeleton className="h-6 w-1/2" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

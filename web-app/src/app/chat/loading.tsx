import { Skeleton } from "@/components/ui/skeleton";

export default function ChatLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-hidden px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex justify-end">
            <Skeleton className="h-12 w-2/3 rounded-2xl" />
          </div>
          <div className="flex justify-start">
            <Skeleton className="h-32 w-5/6 rounded-2xl" />
          </div>
          <div className="flex justify-start">
            <Skeleton className="h-24 w-3/4 rounded-2xl" />
          </div>
        </div>
      </div>
      <div className="border-t border-border bg-background/80 p-4 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

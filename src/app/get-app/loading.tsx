import { Skeleton } from "@/components/ui/skeleton";

export default function GetAppLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-11 w-full rounded-control" />
          <Skeleton className="h-11 w-full rounded-control" />
        </div>
      </div>
    </div>
  );
}

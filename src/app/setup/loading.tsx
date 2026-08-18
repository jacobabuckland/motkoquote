import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the setup page layout (header → form sections) so content swaps in
// without a layout jump.
export default function SetupLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </header>
      <main className="flex flex-1 justify-center p-6">
        <div className="flex w-full max-w-xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Skeleton className="h-11 w-48 rounded-control" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full rounded-control" />
            <Skeleton className="h-10 w-full rounded-control" />
            <Skeleton className="h-10 w-full rounded-control" />
            <Skeleton className="h-10 w-full rounded-control" />
            <Skeleton className="h-10 w-full rounded-control" />
          </div>
        </div>
      </main>
    </div>
  );
}

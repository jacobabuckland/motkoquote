import { Skeleton } from "@/components/ui/skeleton";

export default function AddCostVoiceLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-32" />
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <Skeleton className="h-48 w-full max-w-sm rounded-lg" />
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Skeleton className="h-32 w-32 rounded-full" />
        </div>
      </main>
    </div>
  );
}

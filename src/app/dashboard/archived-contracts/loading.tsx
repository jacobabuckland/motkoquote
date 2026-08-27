import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the archived-contracts layout (page header → one ruled card of rows).
// Required, not decorative: tests/acceptance/200.test.tsx walks every route
// directory under src/app and holds each authenticated one to having a
// loading.tsx, so a new route without one fails that registry.
export default function ArchivedContractsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-36" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-px overflow-hidden rounded-card border border-line-strong bg-card">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
              {/* Two lines, because the row carries a name and its status date. */}
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

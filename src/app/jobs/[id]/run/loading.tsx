import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the run viewer: back bar, a line of context, then the stacked panes.
// Six blocks rather than one tall one, because the panes are what arrives and a
// single slab would collapse into six and jump. The page reads two jsonb-heavy
// rows, so this is on screen for longer than most.
export default function RunViewerLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-40" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-6">
        <Skeleton className="h-4 w-64" />
        {[0, 1, 2, 3, 4, 5].map((pane) => (
          <div key={pane} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-28 w-full rounded-card" />
          </div>
        ))}
      </main>
    </div>
  );
}

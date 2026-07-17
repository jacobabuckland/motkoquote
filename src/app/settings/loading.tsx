import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the settings layout (header → title → stacked preference cards).
export default function SettingsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
        </div>
      </header>
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <Skeleton className="mb-6 h-8 w-40" />
          <div className="space-y-8">
            {[0, 1].map((i) => (
              <Card key={i} className="flex flex-col gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

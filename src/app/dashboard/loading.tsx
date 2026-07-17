import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the dashboard layout (header → title row → stacked pipeline cards) so
// content swaps in without a layout jump. Not a full-screen spinner.
export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-11 w-28 rounded-control" />
        </div>
        <section className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          {[0, 1].map((i) => (
            <Card key={i} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-4 w-full" />
            </Card>
          ))}
        </section>
        <section className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          {[0, 1].map((i) => (
            <Card key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}

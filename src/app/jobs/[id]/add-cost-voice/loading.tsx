/**
 * Loading skeleton for job-scoped voice cost entry page.
 */
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="h-16 border-b border-border" /> {/* Header skeleton */}
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="h-32 w-32 animate-pulse rounded-full bg-surface-hover" />
      </main>
    </div>
  );
}

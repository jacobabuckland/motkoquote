export default function GetTheAppLoading() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="h-7 bg-surface-secondary rounded animate-pulse mb-1" />
        <div className="h-4 bg-surface-secondary rounded animate-pulse mb-6 w-3/4" />
        <div className="flex flex-col gap-3">
          <div className="h-11 bg-surface-secondary rounded animate-pulse" />
          <div className="h-11 bg-surface-secondary rounded animate-pulse" />
        </div>
      </div>
    </main>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the SoW viewer (back bar → document frame → open-full-screen link) so
// the PDF lands in place without shifting. The frame block matches the 70vh
// object, which is the whole screen on a phone — a short skeleton here would
// collapse and then jump.
export default function SowViewerLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-32" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-6">
        <Skeleton className="h-[70vh] w-full rounded-card" />
        <Skeleton className="h-4 w-44" />
      </main>
    </div>
  );
}

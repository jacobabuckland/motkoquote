import { Skeleton } from "@/components/ui/skeleton";

// Cold launch lands here, so the loading state is the very first thing a
// visitor (and a reviewer) sees. Kept to the shape of the capture screen.
export default function Loading() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <Skeleton className="h-16 w-16 rounded-full" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-11 w-full max-w-sm" />
    </main>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[60vh] w-full" />
      <Skeleton className="h-11 w-full" />
    </main>
  );
}

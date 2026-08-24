import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the set-password layout (title → subtitle → two fields → button).
export default function ResetPasswordLoading() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Skeleton className="mb-1 h-8 w-52" />
        <Skeleton className="mb-6 h-4 w-full" />
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </main>
  );
}

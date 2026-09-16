import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the quote editor layout so the real content lands in place without shifting.
export default function QuoteLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl p-4">
        <Card className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

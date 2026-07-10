import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function AuthErrorPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Sign-in link expired</h1>
        <p className="text-sm text-text-secondary mb-2">
          That link is no longer valid. Request a new one.
        </p>
        <Link href="/login" className={buttonClass("secondary")}>
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

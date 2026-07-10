import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold mb-2">Sign-in link expired</h1>
        <p className="text-sm text-neutral-500 mb-4">
          That link is no longer valid. Request a new one.
        </p>
        <Link href="/login" className="underline text-sm">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

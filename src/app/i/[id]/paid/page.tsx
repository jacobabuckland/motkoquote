export default function InvoicePaidPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-pill bg-primary-light text-2xl font-semibold text-primary"
      >
        ✓
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Payment received</h1>
        <p className="text-sm text-text-secondary">
          Thanks — you&apos;ll get a confirmation shortly.
        </p>
      </div>
    </main>
  );
}

// The loading placeholder. `data-testid` is deliberate rather than incidental:
// tests/acceptance/145.test.tsx asserts that all three customer-facing loading
// routes are built from THIS component, and it needs something stable to say
// that against. It used to say it with `.animate-pulse.bg-stone-200`, which
// pinned a colour to prove identity — so the colour could not be tokenised
// without breaking a contract that was never about colour.
//
// Keep this attribute. Its absence would not fail a type check; it would fail
// the three assertions in 145 that depend on it.
export const Skeleton = ({ className = "" }: { className?: string }) => (
  <div
    data-testid="skeleton"
    className={`animate-pulse rounded-control bg-card-hover ${className}`}
  />
);

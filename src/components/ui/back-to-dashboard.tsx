import Link from "next/link";

// Contractor-only escape hatch for the customer-facing capability-URL pages
// (payment, contract, quote). Those routes are public and, inside the iOS
// WKWebView wrapper, render with no browser chrome — so a contractor who opens
// one to preview it would otherwise be stranded with no way back. Rendered only
// when an authenticated session is present, so the customer never sees it.
//
// Navigates by explicit route, never history.back(): a deep-linked visit with
// no history must still work in the chrome-less wrapper.
export const BackToDashboard = () => (
  <Link
    href="/dashboard"
    className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-text-secondary hover:text-primary"
  >
    <span aria-hidden>&larr;</span> Back to dashboard
  </Link>
);

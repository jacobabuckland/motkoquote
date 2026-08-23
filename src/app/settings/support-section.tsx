import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SUPPORT_INBOX } from "@/lib/email";

// The way in to the authenticated support form, from where people actually
// look for help. The nav bar already wraps at four items, so a fifth would
// cost every screen a little legibility to serve one screen.
//
// Points at /settings/support, NOT /support: the latter is the public page the
// App Store submission links to, and everything under it is public by
// middleware.
export const SupportSection = () => (
  <Card>
    <h2 className="text-lg font-semibold">Need a hand?</h2>
    <p className="mt-1 text-sm text-ink-secondary">
      Send us a message and we&apos;ll reply by email, or write to us at {SUPPORT_INBOX}.
    </p>
    <Link
      href="/settings/support"
      className="mt-4 inline-flex min-h-11 items-center font-medium text-green underline-offset-4 hover:underline"
    >
      Contact support
    </Link>
  </Card>
);

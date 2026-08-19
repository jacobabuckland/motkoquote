"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  companyName: string;
  onSignOut: () => void;
};

// "Speak to Motko" is the primary action hub — triage into a new quote or a
// business update. The company-name brand (below) is the way back to the
// dashboard/work view. Home used to point at "/", which dropped a logged-in
// user into the marketing page — blank inside the native app.
const navItems = [
  { href: "/motko", label: "Speak to Motko" },
  { href: "/jobs", label: "My work" },
  { href: "/setup", label: "Business" },
  { href: "/settings", label: "Settings" },
];

// The trade's own name is the mark. It is set in the display face — this is
// the one place in the app chrome that carries any signage weight, and it is
// the contractor's business, not ours.
export const AppHeader = ({ companyName, onSignOut }: Props) => {
  const pathname = usePathname();

  return (
    <header className="border-b border-line-strong bg-ground">
      {/* Top inset for the notch, same reasoning as PageHeader: cover-fit
          viewport means an un-inset bar renders under the iOS status bar. */}
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/dashboard"
          className="display inline-flex min-h-11 items-center truncate text-base font-bold text-ink"
        >
          {companyName}
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 text-sm">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center transition-colors duration-150 ${
                  active
                    ? "font-semibold text-green"
                    : "text-ink-secondary hover:text-ink active:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <form action={onSignOut}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center text-sm text-ink-secondary transition-colors duration-150 hover:text-ink active:text-ink"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
};

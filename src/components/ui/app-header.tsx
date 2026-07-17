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
  { href: "/setup", label: "Business" },
  { href: "/settings", label: "Settings" },
];

export const AppHeader = ({ companyName, onSignOut }: Props) => {
  const pathname = usePathname();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Link href="/dashboard" className="text-sm font-semibold">
          {companyName}
        </Link>
        <nav className="flex flex-wrap items-center gap-5 text-sm">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "font-semibold text-primary"
                    : "text-secondary-text hover:text-foreground"
                }
              >
                {item.label}
              </Link>
            );
          })}
          <form action={onSignOut}>
            <button
              type="submit"
              className="text-text-secondary hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
};

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  companyName: string;
  onSignOut: () => void;
};

// "Home" lands on the dashboard — the contractor's actual hub (start a new
// quote, see what needs them). Pointing it at "/" dropped into the marketing
// page, which renders blank inside the native app for a logged-in user.
const navItems = [
  { href: "/dashboard", label: "Home" },
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

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// 64px sticky header on the canvas. The hairline bottom border only appears
// after 8px of scroll — nothing to hide on mobile, so no hamburger.
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="mkt-header" data-scrolled={scrolled}>
      <div className="mkt-container flex h-full items-center justify-between">
        <Link
          href="/"
          className="text-[26px] font-bold tracking-[-0.02em] text-[color:var(--ink)]"
        >
          Motko
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/login"
            className="text-sm font-semibold text-[color:var(--muted)] hover:text-[color:var(--ink)]"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="mkt-btn mkt-btn-primary h-10 px-4 text-sm"
          >
            Start free
          </Link>
        </nav>
      </div>
    </header>
  );
}

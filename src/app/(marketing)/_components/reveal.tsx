"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The one reveal implementation, reused by every section: opacity 0→1 +
// translateY(12→0), 350ms ease-out, fired once at 20% intersection. Stagger is
// applied by the caller via `delay`. Reduced motion shows content immediately
// (also enforced in marketing.css).
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "li" | "section";
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced motion is handled in CSS (.mkt-reveal is forced visible there),
    // so JS only needs to wire up the reveal observer.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Comp = Tag as "div";
  return (
    <Comp
      ref={ref as never}
      className={`mkt-reveal ${className}`}
      data-shown={shown}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Comp>
  );
}

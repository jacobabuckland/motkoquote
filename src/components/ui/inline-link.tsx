import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type AnchorProps = {
  href: string;
  external?: boolean;
  children: ReactNode;
  className?: string;
  /**
   * Set when the link sits INSIDE a sentence rather than standing alone.
   * Drops the 44px box, which would otherwise stretch the line it sits on and
   * break the paragraph's rhythm. WCAG's target-size rule exempts links in a
   * block of text, so a prose link is compliant without it.
   */
  inProse?: boolean;
} & Omit<ComponentProps<"a">, "href" | "className">;

// Canonical inline text link (brand green, ≥44px touch target via min-h-11).
// Use for "Download PDF", "View contract", "Payment link" etc.
//
// Carries an `active:` colour as well as `hover:` — on touch there is no
// hover, so a hover-only link gives no press feedback and then stays stuck in
// its hover colour after the tap.
const linkClass =
  "inline-flex min-h-11 items-center text-sm font-semibold text-green underline underline-offset-4 transition-colors duration-150 hover:text-green-hover active:text-green-hover";

// The in-prose variant keeps the colour and underline but flows as ordinary
// text — no min-height, no inline-flex box.
const proseLinkClass =
  "font-semibold text-green underline underline-offset-4 transition-colors duration-150 hover:text-green-hover active:text-green-hover";

export const InlineLink = ({
  href,
  external,
  children,
  className = "",
  inProse = false,
  ...props
}: AnchorProps) => {
  const cls = `${inProse ? proseLinkClass : linkClass} ${className}`;

  if (external) {
    return (
      <a href={href} className={cls} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...props}>
      {children}
    </Link>
  );
};

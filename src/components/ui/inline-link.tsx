import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type AnchorProps = {
  href: string;
  external?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<"a">, "href" | "className">;

// Canonical inline text link (primary green, ≥44px touch target via min-h-11).
// Use for "Download PDF", "View contract", "Payment link" etc.
const linkClass =
  "inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover";

export const InlineLink = ({
  href,
  external,
  children,
  className = "",
  ...props
}: AnchorProps) => {
  if (external) {
    return (
      <a href={href} className={`${linkClass} ${className}`} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={`${linkClass} ${className}`} {...props}>
      {children}
    </Link>
  );
};

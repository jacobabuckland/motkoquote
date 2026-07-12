import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type AnchorProps = {
  href: string;
  external?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<"a">, "href" | "className">;

// Canonical inline text link (accent, ≥44px touch target via py-2).
// Use for "Download PDF", "View contract", "Payment link" etc.
const linkClass =
  "inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover";

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

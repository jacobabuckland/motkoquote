import type { HTMLAttributes } from "react";

// The one surface. White card on the paper ground, hairline border, resting
// elevation. Depth comes from the shadow token, never from a heavier border —
// a card that needs a thicker outline is a card that hasn't earned its place.
export const Card = ({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`rounded-card border border-line-strong bg-card p-4 shadow-resting ${className}`}
    {...props}
  />
);

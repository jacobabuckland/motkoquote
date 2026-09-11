export const Skeleton = ({ className = "" }: { className?: string }) => (
  // `bg-stone-200` is the one off-token colour left in the tree, and it is NOT
  // here on the merits — tests/acceptance/145.test.tsx:161-163 asserts
  // `.animate-pulse.bg-stone-200` on all three customer-facing loading routes.
  // That file is frozen, so this cannot be changed downstream. The assertion's
  // own name is "all three loading skeletons use the Skeleton component": the
  // class pair was a proxy for component identity, not a colour requirement.
  // Retiring those three lines needs a card that names them; until then the
  // token is --card-hover and this is a placeholder.
  <div className={`animate-pulse rounded-control bg-stone-200 ${className}`} />
);

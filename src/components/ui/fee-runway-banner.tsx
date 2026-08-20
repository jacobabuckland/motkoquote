import Link from "next/link";
import { feeRunwayBannerCopy, type FeeRunway } from "@/lib/fee-runway";

type Props = {
  runway: FeeRunway;
};

// The free-allowance runway, made visible. Renders nothing while the runway is
// clear (state 'ok'), so it only appears as the allowance runs low or runs out.
// Purely presentational — the rung logic and the pricing copy live in
// feeRunwayBannerCopy; this only paints them.
//
// It informs and nothing more. There is no rung that blocks an action: the fee
// comes out of each payment at source, so there is nothing for the trade to set
// up and no reason to stop them quoting.
export const FeeRunwayBanner = ({ runway }: Props) => {
  const copy = feeRunwayBannerCopy(runway);
  if (!copy) return null;

  // Amber — the same mark the dashboard uses for anything worth reading before
  // it matters. Never red: nothing here is a failure or a blocked action.
  return (
    <div
      role="status"
      className="keyline-move flex flex-col items-start gap-1 rounded-card border border-line-strong bg-amber-tint px-4 py-3 text-sm text-ink"
    >
      <p className="max-w-prose">{copy.body}</p>
      <Link
        href={copy.ctaHref}
        className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4"
      >
        {copy.ctaLabel}
      </Link>
    </div>
  );
};

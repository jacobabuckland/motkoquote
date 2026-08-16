import Link from "next/link";
import { feeRunwayBannerCopy, type FeeRunway } from "@/lib/fee-runway";

type Props = {
  runway: FeeRunway;
};

// The zero-free-jobs ladder, made visible. Renders nothing while the ladder is
// dark (state 'inactive' — flag off) or clear (state 'ok'), so it only appears
// once fee billing is live AND the trade is actually approaching the end of
// their free allowance. Purely presentational — the rung logic and the blessed
// copy live in feeRunwayBannerCopy; this only paints them. It never gates any
// action itself (sendQuote enforces the block), it only informs and points at
// billing setup.
export const FeeRunwayBanner = ({ runway }: Props) => {
  const copy = feeRunwayBannerCopy(runway);
  if (!copy) return null;

  // Setting up billing is the contractor's move, so this is amber — the same
  // mark the dashboard uses for every other "your move" item. The 'error' rung
  // is the same colour with a heavier keyline rather than a second hue: the
  // ladder is one message getting more urgent, not two different messages.
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

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

  const tone =
    copy.tone === "error"
      ? "border-error/40 bg-error-bg text-error"
      : "border-warning/40 bg-warning-bg text-warning";

  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm ${tone}`}
    >
      <p>{copy.body}</p>
      <Link href={copy.ctaHref} className="font-semibold underline underline-offset-2">
        {copy.ctaLabel}
      </Link>
    </div>
  );
};

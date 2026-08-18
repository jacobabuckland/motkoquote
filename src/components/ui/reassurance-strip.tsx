import {
  PAYMENT_COPY_LINE_1,
  PAYMENT_COPY_LINE_2,
} from "@/lib/payment-reassurance-copy";

interface ReassuranceStripProps {
  companyName?: string | null;
}

// The reassurance strip on the customer payment page. The two strings are
// legally signed off (see lib/payment-reassurance-copy.ts) — this restyles
// them, it never rewrites them.
//
// Rendered as an inset panel: the paper ground showing through the white card,
// which reads as part of the document rather than as a warning bolted onto it.
// Set at text-sm in full ink — this is the copy that convinces a stranger to
// send money, so it is never dropped to a muted grey or a smaller size.
export function ReassuranceStrip({ companyName }: ReassuranceStripProps) {
  // Substitute {trade} placeholder with the actual company name
  const renderSecondLine = () => {
    // Split the approved copy at the {trade} placeholder
    const parts = PAYMENT_COPY_LINE_2.split("{trade}");

    if (!companyName) {
      // Render the approved template with {trade} replaced by empty string
      // (omitting the trade name as the spec instructs)
      return parts[0] + parts[1];
    }

    // Render the full approved string with company name in bold
    return (
      <>
        {parts[0]}
        <span className="inline-block max-w-[220px] truncate align-bottom font-semibold">
          {companyName}
        </span>
        {parts[1]}
      </>
    );
  };

  return (
    <div className="rounded-card border border-line bg-ground p-4">
      <div className="flex gap-3 text-sm text-ink">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="mt-0.5 flex-shrink-0 text-green"
          aria-label="shield"
          role="img"
        >
          <path
            d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <p>{PAYMENT_COPY_LINE_1}</p>
      </div>
      <div className="mt-2 ml-8 text-sm text-ink">
        <p className="break-words">{renderSecondLine()}</p>
      </div>
    </div>
  );
}

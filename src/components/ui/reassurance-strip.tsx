import {
  PAYMENT_COPY_LINE_1,
  PAYMENT_COPY_LINE_2,
} from "@/lib/payment-reassurance-copy";

interface ReassuranceStripProps {
  companyName?: string | null;
}

export function ReassuranceStrip({ companyName }: ReassuranceStripProps) {
  // Substitute {trade} placeholder with the actual company name
  const renderSecondLine = () => {
    if (!companyName) {
      // If no company name, render the sentence without the trade name
      return "Your money goes straight from your bank to them.";
    }

    // Split the copy at {trade} and insert the company name in bold
    const parts = PAYMENT_COPY_LINE_2.split("{trade}");
    return (
      <>
        {parts[0]}
        <span className="font-semibold truncate max-w-[200px] inline-block align-bottom">
          {companyName}
        </span>
        {parts[1]}
      </>
    );
  };

  return (
    <div className="rounded-card border border-border bg-surface-secondary p-4">
      <div className="flex gap-3 text-sm text-text-primary">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="flex-shrink-0 mt-0.5"
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
      <div className="mt-2 ml-8 text-sm text-text-primary">
        <p className="break-words">{renderSecondLine()}</p>
      </div>
    </div>
  );
}

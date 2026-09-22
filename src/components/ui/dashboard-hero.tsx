import { formatGBP } from "@/lib/format";
import { getGreeting } from "@/lib/greeting";

interface DashboardHeroProps {
  outstandingTotal: number;
  /**
   * Agreed on a signed contract and not yet invoiced. NOT a receivable, and
   * deliberately not added to `outstandingTotal` — the customer has been asked
   * for nothing and owes nothing yet. It exists here only so the zero state
   * stops claiming "nothing outstanding" over money the contractor has not
   * billed: a £1,440 job whose £360 deposit had settled read as all square
   * while £1,080 sat uninvoiced and on no screen in the app (reported 13 Sep).
   */
  uninvoicedTotal?: number;
}

// THE LEDGER FIGURE — the one element motko is remembered by.
//
// The amount that matters, set large in the display face on the paper ground,
// with the plain-language label beneath it. Everything else on the dashboard
// stays quiet around this. It is the largest thing in the product and nothing
// else may compete with it.
//
// The figure settles on load — a 280ms rise-and-fade, once — rather than
// counting up from zero. What you are owed is a fact, not a fruit machine;
// it should arrive, not tally. The animation is the ONLY orchestrated motion
// in the product and is disabled under prefers-reduced-motion (see the
// `.animate-ledger` keyframes in globals.css).
export function DashboardHero({ outstandingTotal, uninvoicedTotal = 0 }: DashboardHeroProps) {
  if (outstandingTotal === 0) {
    // Every invoice IS paid — that sentence was never wrong. "Nothing
    // outstanding" was, whenever agreed work had not been billed yet, so the
    // second line names the figure and what to do about it instead.
    if (uninvoicedTotal > 0) {
      return (
        <div className="flex flex-col gap-1.5">
          <p className="display text-3xl font-bold">Every invoice is paid</p>
          {/* The explicit {" "} is the same guard as the greeting below, for the
              same reason: whitespace between an expression container and the
              text on the NEXT line is not guaranteed to survive the JSX
              transform, and this one rendered as "£2,190.00of agreed work" on
              motko.app (screenshot, 20 Sep). It is a no-op wherever the space
              already survives, which is what makes it the right shape of fix. */}
          <p className="text-sm text-ink-secondary">
            {formatGBP(uninvoicedTotal)}
            {" of agreed work hasn't been invoiced yet. Raise it when the job's done."}
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <p className="display text-3xl font-bold">You&apos;re all square</p>
        <p className="text-sm text-ink-secondary">
          Every invoice you&apos;ve sent has been paid. Nothing outstanding.
        </p>
      </div>
    );
  }

  const greeting = getGreeting(new Date().getHours());

  return (
    <div className="flex flex-col">
      <div className="display animate-ledger text-4xl font-bold tabular-nums sm:text-5xl">
        {formatGBP(outstandingTotal)}
      </div>
      {/* The explicit {" "} matters: JSX strips the leading whitespace of a
          continuation line, which would otherwise render "afternoon— you're". */}
      <p className="mt-1.5 text-sm text-ink-secondary">
        {greeting}
        {" — you're owed"}
      </p>
    </div>
  );
}

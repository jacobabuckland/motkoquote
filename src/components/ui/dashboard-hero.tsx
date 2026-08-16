import { formatGBP } from "@/lib/format";
import { getGreeting } from "@/lib/greeting";

interface DashboardHeroProps {
  outstandingTotal: number;
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
export function DashboardHero({ outstandingTotal }: DashboardHeroProps) {
  if (outstandingTotal === 0) {
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

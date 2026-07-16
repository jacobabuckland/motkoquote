import Image from "next/image";

// Real product screenshots are captured by scripts/capture-marketing-shots.ts
// into /public/marketing/*.png (390×844 dpr2). Until a capture exists, we render
// a same-size neutral placeholder skeleton so layout is dimensioned (zero CLS)
// and the missing asset is visually flagged. See public/marketing/MISSING.md.
type Screen = "sow" | "quote" | "accept" | "job" | "dashboard";

const HAS_REAL: Record<Screen, boolean> = {
  // Flip to true once the real PNG has been captured/committed.
  sow: false,
  quote: false,
  accept: false,
  job: false,
  dashboard: false,
};

const LABEL: Record<Screen, string> = {
  sow: "Scope of work",
  quote: "Quote",
  accept: "Accepted & signed",
  job: "Job page",
  dashboard: "Dashboard",
};

export function ScreenFrame({
  screen,
  className = "",
  priority = false,
}: {
  screen: Screen;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={`mkt-frame ${className}`}>
      {/* Slot for a real screen-recording <video> or captured PNG later. */}
      {HAS_REAL[screen] ? (
        <Image
          src={`/marketing/${screen}.png`}
          alt={`Motko ${LABEL[screen]} screen`}
          width={780}
          height={975}
          priority={priority}
          className="block h-auto w-full"
        />
      ) : (
        <PlaceholderSkeleton label={LABEL[screen]} />
      )}
    </div>
  );
}

function PlaceholderSkeleton({ label }: { label: string }) {
  // 4:5 neutral skeleton. object-position:top crop area matches real captures.
  return (
    <svg
      viewBox="0 0 780 975"
      width="780"
      height="975"
      role="img"
      aria-label={`${label} — preview placeholder`}
      className="block h-auto w-full"
      style={{ background: "#fff" }}
    >
      {/* top app bar */}
      <rect x="0" y="0" width="780" height="72" fill="#f6f3ee" />
      <rect x="28" y="30" width="150" height="14" rx="7" fill="#004225" />
      <circle cx="740" cy="37" r="14" fill="#e6efea" />
      {/* title block */}
      <rect x="28" y="108" width="360" height="26" rx="6" fill="#e7e4df" />
      <rect x="28" y="150" width="240" height="16" rx="6" fill="#eeece7" />
      {/* rows */}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} transform={`translate(28 ${220 + i * 96})`}>
          <rect width="724" height="72" rx="12" fill="#faf9f6" stroke="#eeece7" />
          <rect x="20" y="20" width="300" height="14" rx="7" fill="#e7e4df" />
          <rect x="20" y="44" width="180" height="12" rx="6" fill="#efedea" />
          <rect x="604" y="26" width="100" height="20" rx="10" fill="#e6efea" />
        </g>
      ))}
      {/* total line */}
      <rect x="28" y="720" width="724" height="1" fill="#e7e4df" />
      <rect x="520" y="742" width="120" height="16" rx="6" fill="#e7e4df" />
      <rect x="664" y="738" width="88" height="24" rx="6" fill="#004225" />
      {/* watermark */}
      <text
        x="390"
        y="900"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontSize="20"
        fontWeight="600"
        fill="#b9b4ab"
      >
        {label} — preview
      </text>
    </svg>
  );
}

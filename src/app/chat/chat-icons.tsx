// The few glyphs the chat needs, drawn inline so there is no icon dependency and
// every one takes its colour from the text around it.

export const Tick = ({ draw = false, className = "h-4 w-4" }: { draw?: boolean; className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {/* Same path and dash as the quote editor's sent tick. `draw` plays the
        stroke once; without it the tick is simply there. */}
    <path
      d="M5 12l5 5L20 7"
      strokeDasharray="100"
      strokeDashoffset="0"
      className={draw ? "check-draw-animation" : undefined}
    />
  </svg>
);

export const SendIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const MicIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

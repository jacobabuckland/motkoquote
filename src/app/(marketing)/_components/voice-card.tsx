// The "Just say the job" card renders the live voice-quote screen (/jobs/new)
// as a marketing visual — the listening pulse, the status line, and the scope
// building up as the contractor speaks. Built from tokens, not a screenshot,
// because the real screen is a live WebRTC call that can't be captured cleanly.
// Sized to sit inside the carousel's 4:5 frame without overflow.
export function VoiceCard() {
  return (
    <div className="flex h-full w-full flex-col bg-white p-4">
      {/* app bar — mirrors the real screen's Cancel / New job header */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-[color:var(--muted)]">
          Cancel
        </span>
        <span className="text-[12px] font-semibold text-[color:var(--ink)]">
          New job
        </span>
        <span className="w-[36px]" aria-hidden="true" />
      </div>

      {/* listening pulse — the unmistakable "I'm hearing you" state */}
      <div className="mt-4 flex flex-col items-center">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-[color:var(--green)] opacity-30 [animation-duration:1.6s]" />
          <span className="absolute inline-flex h-20 w-20 animate-ping rounded-full bg-[color:var(--green)] opacity-[0.15] [animation-delay:0.4s] [animation-duration:1.6s]" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--green)] text-white shadow-[0_0_24px_rgba(0,66,37,0.4)]">
            <MicIcon />
          </div>
        </div>
        <p className="mt-3 text-center text-[13px] font-medium leading-snug text-[color:var(--ink)]">
          Listening — talk me through the job
        </p>
        <p className="mt-1 text-[11px] text-[color:var(--muted)]">Hearing you…</p>
      </div>

      {/* scope building up live as they talk */}
      <div className="mt-auto rounded-[10px] border border-[color:var(--hairline)] bg-[color:var(--card)] p-3">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
          Scope so far
        </p>
        <ul className="mt-1.5 flex flex-col gap-1 text-[12px] text-[color:var(--ink)]">
          <li>
            <span className="font-semibold">Kitchen</span>
            <span className="text-[color:var(--muted)]">
              {" "}
              — 10 sockets, 6 downlights
            </span>
          </li>
          <li>
            <span className="font-semibold">Landing</span>
            <span className="text-[color:var(--muted)]"> — 2 sockets, smoke alarm</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

// The "Know the second you're paid" card renders a real iOS-style notification
// built from tokens — a solid (no backdrop-blur) dark card, square green app
// icon, title / body / "now". Not a screenshot.
export function NotificationCard() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#1c1c1e] p-6">
      <div className="flex w-full max-w-[300px] items-start gap-3 rounded-[18px] bg-[#2c2c2e] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#004225] text-[15px] font-bold text-white">
          M
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-semibold text-white">Motko</span>
            <span className="text-[12px] text-white/50">now</span>
          </div>
          <p className="mt-0.5 text-[14px] leading-snug text-white/90">
            Daniel paid your invoice —{" "}
            <span className="mkt-tabular font-semibold">£992.50</span> in.
          </p>
        </div>
      </div>
    </div>
  );
}

import { buttonClass } from "./button";

// One consistent treatment for an action that exists but isn't available yet
// (G6): the control is always shown — never silently absent — rendered
// disabled, with a plain-English caption saying what unlocks it. A disabled
// <button> is inert without any client JS, so this works in server components.
export const BlockedAction = ({ label, reason }: { label: string; reason: string }) => (
  <div className="flex flex-col items-start gap-1">
    <button type="button" disabled className={buttonClass("primary", "self-start")}>
      {label}
    </button>
    <span className="text-xs text-text-muted">{reason}</span>
  </div>
);

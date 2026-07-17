"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isNativeApp } from "@/lib/platform";
import {
  micFailureCopy,
  openAppSettings,
  settingsInstructions,
  type MicFailureKind,
} from "@/lib/mic";

const MicIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
    <line x1="8" y1="21" x2="16" y2="21" />
  </svg>
);

type ManualProps = {
  onManual: () => void;
  manualLabel: string;
  manualPending?: boolean;
};

type ExplainerProps = ManualProps & {
  intro: string;
  startLabel: string;
  starting: boolean;
  onStart: () => void;
};

// Shown before the very first getUserMedia call so the native permission
// prompt never appears cold — the contractor knows why the microphone is
// being asked for before iOS puts up its yes/no dialog.
export const MicExplainer = ({
  intro,
  startLabel,
  starting,
  onStart,
  onManual,
  manualLabel,
  manualPending,
}: ExplainerProps) => (
  <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
      <MicIcon />
    </div>
    <p className="text-sm text-text-secondary">{intro}</p>
    <div className="flex w-full flex-col items-center gap-3">
      <Button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="w-full"
      >
        {starting ? "Starting…" : startLabel}
      </Button>
      <button
        type="button"
        onClick={onManual}
        disabled={manualPending}
        className="inline-flex min-h-11 items-center text-sm font-medium text-text-secondary underline underline-offset-4 disabled:opacity-50"
      >
        {manualPending ? "Opening…" : manualLabel}
      </button>
    </div>
  </div>
);

type FailureProps = ManualProps & {
  kind: MicFailureKind;
  onRetry: () => void;
};

// Recovery screen for every way the microphone can fail to start. Always
// offers the typed-quote fallback so the contractor is never dead-ended, and
// deep-links into Settings when the problem is a revoked/denied permission.
export const MicFailureScreen = ({
  kind,
  onRetry,
  onManual,
  manualLabel,
  manualPending,
}: FailureProps) => {
  const copy = micFailureCopy[kind];
  const showSettings = kind === "denied";

  return (
    <Card className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-error/10 text-error">
        <MicIcon />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{copy.title}</h2>
        <p className="text-sm text-text-secondary">{copy.body}</p>
      </div>

      <div className="flex w-full flex-col items-center gap-3">
        {showSettings && (
          <>
            {isNativeApp() && (
              <Button type="button" onClick={openAppSettings} className="w-full">
                Open Settings
              </Button>
            )}
            <p className="text-xs text-text-muted">{settingsInstructions}</p>
          </>
        )}
        {copy.canRetry && (
          <Button
            type="button"
            variant={showSettings ? "secondary" : "primary"}
            onClick={onRetry}
            className="w-full"
          >
            Try again
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={onManual}
          disabled={manualPending}
          className="w-full"
        >
          {manualPending ? "Opening…" : manualLabel}
        </Button>
      </div>
    </Card>
  );
};

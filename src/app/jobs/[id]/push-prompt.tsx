"use client";

// The notification ask, placed at the one moment a contractor has a reason to
// say yes: they have just sent a quote, and there is now something they are
// waiting on an answer to.
//
// It did not exist anywhere before this. `registerNativePush` — the only call
// that can raise the iOS permission alert — had exactly one caller, the
// "Enable notifications" button in Settings, so a contractor who never went
// looking got none of the seven money-moment alerts and was never told.
//
// TWO PROMPTS, DELIBERATELY. iOS shows its permission alert once per install
// and never again; "Don't Allow" is then only reversible in iOS Settings, which
// is somewhere nobody goes. So this card is a soft ask that costs nothing to
// decline, and only a "Yes, tell me" spends the real one. Firing the system
// alert cold — on mount, or straight off the send — would spend it at the worst
// possible moment: mid-navigation, with no reason on screen for what is being
// asked or why.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  nativePushPermission,
  messageForResult,
  registerNativePush,
} from "@/lib/push/native";

// How many times a contractor may be asked before we stop. Two, not one: a card
// that appears under a freshly sent quote is easy to dismiss without reading,
// and a single mistap should not cost someone every notification they would
// have wanted. Two, not more: past that it is nagging, and the Settings button
// is still there for anyone who changes their mind.
const MAX_ASKS = 2;

const DISMISSAL_KEY = "motko.push-prompt.dismissals";

// localStorage throws outright in some iOS configurations (private browsing,
// site data blocked) rather than returning null, so every access is guarded. A
// storage that cannot be read is treated as "never dismissed": the cost of one
// extra soft ask is far below the cost of never asking at all.
const readDismissals = (): number => {
  try {
    const raw = window.localStorage.getItem(DISMISSAL_KEY);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const recordDismissal = (): void => {
  try {
    window.localStorage.setItem(DISMISSAL_KEY, String(readDismissals() + 1));
  } catch {
    // Nothing to do: the ask simply reappears on a later send, which is the
    // safe direction to fail in.
  }
};

/**
 * Rendered under the "Quote sent" banner on the job page.
 *
 * Shows nothing at all unless this is the iOS app AND the OS permission is
 * still undecided AND the contractor has not already declined twice. Every one
 * of those is checked in an effect rather than on the server, because all three
 * are properties of the device rather than of the account — the same contractor
 * on a second phone is a different answer.
 */
export const PushPrompt = (): React.ReactElement | null => {
  const [visible, setVisible] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (readDismissals() >= MAX_ASKS) return;
      // "prompt" is the only state worth interrupting for: granted needs
      // nothing, denied cannot be undone from in here, and unavailable means
      // this is a browser.
      if ((await nativePushPermission()) !== "prompt") return;
      if (!cancelled) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setEnabling(true);
    const result = await registerNativePush();
    setEnabling(false);
    // Hide either way. A refusal at the system alert is final for this install,
    // and a token failure is not something a second tap here will fix — the
    // toast names the code to quote and Settings carries the retry.
    setVisible(false);
    const message = messageForResult(result);
    if (message) toast(message);
  }, [toast]);

  const decline = useCallback(() => {
    recordDismissal();
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Want to know the moment they accept?</h2>
      <p className="text-sm text-text-secondary">
        We&apos;ll send a notification to this phone when your customer accepts or
        declines, signs the contract, or pays — so you hear about it without
        checking. You can change this any time in Settings.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={enable} disabled={enabling}>
          {enabling ? "Setting up…" : "Yes, tell me"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={decline}
          disabled={enabling}
        >
          Not now
        </Button>
      </div>
    </div>
  );
};

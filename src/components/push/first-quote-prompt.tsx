"use client";

// NOTIF-3: In-app pre-prompt for push notifications, triggered on app open after
// the contractor's first quote is sent.
//
// Timing: appears on app open (not mid-session after send) when:
// - The contractor has sent their first quote from any device
// - The OS permission is still undecided
// - The device has not already declined twice
//
// The spec's "after every quote send" prompt is retired by this. The new trigger
// is more respectful: it waits until there's something to notify about (a quote
// has been sent), and asks on open rather than interrupting the send flow.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  nativePushPermission,
  messageForResult,
  registerNativePush,
  canOpenSettings,
} from "@/lib/push/native";
import { openIOSSettings } from "@/lib/push/client";

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
 * Rendered in the app root layout, evaluated on every mount (app open).
 *
 * Shows nothing at all unless:
 * - This is a native app (iOS)
 * - The contractor has sent their first quote (first_quote_sent_at is set)
 * - The OS permission is still undecided OR already denied
 * - The contractor has not already declined twice
 *
 * When permission is denied, shows a different variant with honest copy and a
 * button that opens iOS Settings.
 */
export const FirstQuotePrompt = (): React.ReactElement | null => {
  const [visible, setVisible] = useState(false);
  const [permissionState, setPermissionState] = useState<"prompt" | "denied" | null>(null);
  const [enabling, setEnabling] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Check dismissal count first
      if (readDismissals() >= MAX_ASKS) return;

      // Check OS permission
      const permission = await nativePushPermission();

      // Only show for "prompt" or "denied" states
      // "granted" means they already have it enabled
      // "unavailable" means not native or no plugin
      if (permission !== "prompt" && permission !== "denied") return;

      // Check if first quote has been sent
      try {
        const response = await fetch("/api/contractor/first-quote-status", {
          method: "GET",
          credentials: "include",
        });
        if (!response.ok) return;
        const data = await response.json();

        // Only show if first quote has been sent
        if (!data.first_quote_sent_at) return;

        if (!cancelled) {
          setPermissionState(permission);
          setVisible(true);
        }
      } catch {
        // Fetch failed; don't show the prompt
        return;
      }
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

  const openSettings = useCallback(async () => {
    await openIOSSettings();
    setVisible(false);
  }, []);

  if (!visible) return null;

  // Denied state: show honest copy and Settings button
  if (permissionState === "denied") {
    return (
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 mx-4 mt-4">
        <h2 className="text-base font-semibold">Notifications are blocked</h2>
        <p className="text-sm text-text-secondary">
          You&apos;ve previously declined notifications. To receive alerts when customers
          accept, sign, or pay, you&apos;ll need to enable them in iOS Settings.
        </p>
        <div className="flex flex-wrap gap-3">
          {canOpenSettings() && (
            <Button type="button" onClick={openSettings}>
              Open Settings
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={decline}
          >
            Not now
          </Button>
        </div>
      </div>
    );
  }

  // Prompt state: show the soft ask
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 mx-4 mt-4">
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

"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { Disclosure } from "@/components/ui/disclosure";
import {
  notificationEvents,
  notificationEventLabels,
  type NotificationEvent,
} from "@/lib/schemas/notification";
import {
  isWebPushSupported,
  registerWebPush,
  sendTestNotification,
} from "@/lib/push/client";
import { messageForResult, registerNativePush } from "@/lib/push/native";
import { isNativeApp } from "@/lib/platform";
import { saveNotificationPreferences } from "./actions";

type Props = {
  initialDisabledEvents: NotificationEvent[];
  /** `platform` of each push_subscriptions row for this user: "apns" | "webpush". */
  initialRegistrations: string[];
};

export const SettingsClient = ({
  initialDisabledEvents,
  initialRegistrations,
}: Props) => {
  const toast = useToast();
  const [disabled, setDisabled] = useState<Set<NotificationEvent>>(
    new Set(initialDisabledEvents),
  );
  const [isSaving, startSaving] = useTransition();
  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);

  // How many devices are registered, and whether THIS one is among them.
  //
  // The section used to know neither. Its button read "Enable notifications"
  // before permission was granted and "Enable notifications" after, and the
  // only acknowledgement was a toast that disappeared in three seconds — so a
  // trade who granted the OS permission saw the page not change and reasonably
  // concluded it had failed. The obvious next move is to tap it again, which
  // re-runs registration and produces another identical toast. There was no
  // state on the page that could ever end that loop.
  //
  // Server-rendered count, plus a client flag for a registration completed in
  // this session — the row is written server-side, so a reload would be the
  // only other way to see it, and the whole complaint is that nothing changes
  // without one.
  const [deviceCount, setDeviceCount] = useState(initialRegistrations.length);
  const [registeredHere, setRegisteredHere] = useState(false);

  // Per-device, not per-account: a trade with the phone registered and the
  // laptop not is in both states at once. Claiming this device is covered
  // because some other one is would be the same class of lie as the button
  // that never changed.
  const thisPlatform = isNativeApp() ? "apns" : "webpush";
  const platformRegistered =
    registeredHere || initialRegistrations.includes(thisPlatform);

  const persist = (next: Set<NotificationEvent>) => {
    startSaving(async () => {
      await saveNotificationPreferences([...next]);
    });
  };

  const toggle = (event: NotificationEvent) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      // A checked box means the event is ON, so unchecking adds it to the muted
      // set and checking removes it.
      if (next.has(event)) next.delete(event);
      else next.add(event);
      persist(next);
      return next;
    });
  };

  // Only ever called on a genuine success. A failed attempt must leave the
  // indicator absent — showing "on" for a registration that did not happen is
  // worse than showing nothing, because delivery depends on the row.
  const noteRegistered = () => {
    setRegisteredHere(true);
    setDeviceCount((n) => (registeredHere ? n : n + 1));
  };

  const enableNotifications = async () => {
    setEnabling(true);
    // In the iOS app, register for APNs; on the web, VAPID web push.
    if (isNativeApp()) {
      const result = await registerNativePush();
      setEnabling(false);
      if (result.status === "registered") noteRegistered();
      // The copy lives beside the result union in @/lib/push/native so the two
      // cannot drift. null means "say nothing" — a superseded attempt, where a
      // newer one owns the outcome.
      const message = messageForResult(result);
      if (message) toast(message);
      return;
    }
    const result = await registerWebPush();
    setEnabling(false);
    if (result.status === "subscribed") noteRegistered();
    const messages: Record<typeof result.status, string> = {
      subscribed: "Notifications enabled on this device.",
      unsupported: "This browser doesn't support notifications.",
      denied:
        "Notifications are blocked — enable them in your browser settings.",
      "no-key": "Notifications aren't configured yet.",
      error: "Couldn't enable notifications. Try again.",
    };
    toast(messages[result.status]);
  };

  const test = async () => {
    setTesting(true);
    const result = await sendTestNotification();
    setTesting(false);
    if (!result) {
      toast("Couldn't send a test notification.");
      return;
    }
    if (result.devices === 0) {
      toast(
        "No devices registered yet — tap \u201CEnable notifications\u201D first.",
      );
      return;
    }
    if (result.sent === 0) {
      toast("All devices rejected the notification. Check the server logs.");
      return;
    }
    if (result.failed > 0) {
      toast(`Sent to ${result.sent} of ${result.devices} devices.`);
      return;
    }
    toast(
      `Test notification sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`,
    );
  };

  return (
    <Disclosure
      id="notifications"
      title="Notifications"
      defaultOpen={true}
    >
      <div className="space-y-6">
        <section>
          <h2 className="mb-1 text-lg font-semibold">Notifications</h2>
          <p className="mb-3 text-sm text-text-secondary">
            Get an alert the moment a customer accepts a quote, signs a contract,
            or pays.
          </p>
          <Card className="space-y-3">
          {/* The persistent state the section never had. Same shape the
              Stripe section uses: say what is true on load, not only in a
              toast that is gone three seconds later. */}
          {platformRegistered ? (
            <div className="flex flex-col gap-1">
              <p
                className="text-sm font-medium text-success"
                data-testid="push-state"
              >
                On for this device ✓
              </p>
              {deviceCount > 1 && (
                <p className="text-xs text-text-secondary">
                  Registered on {deviceCount} devices.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-secondary" data-testid="push-state">
              {deviceCount > 0
                ? `Not on for this device. Registered on ${deviceCount} other device${deviceCount === 1 ? "" : "s"}.`
                : "Not switched on yet."}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant={platformRegistered ? "secondary" : "primary"}
              onClick={enableNotifications}
              disabled={enabling}
            >
              {enabling
                ? "Enabling…"
                : platformRegistered
                  ? "Re-register this device"
                  : "Enable notifications"}
            </Button>
            <Button variant="secondary" onClick={test} disabled={testing}>
              {testing ? "Sending…" : "Send test notification"}
            </Button>
          </div>
          {!isNativeApp() && !isWebPushSupported() && (
            <p className="text-xs text-text-secondary">
              Push isn&apos;t available in this browser. You&apos;ll still get
              email notifications.
            </p>
          )}
        </Card>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold">What to notify me about</h3>
        {/* Annotated, never disabled. These preferences govern EMAIL as well as
            push, so a trade with no registered device still has a reason to set
            them — but with push off they were silently tuning half a channel,
            with nothing on screen saying so. */}
        {!platformRegistered && (
          <p className="mb-2 text-xs text-text-secondary">
            Push isn&apos;t on for this device, so these apply to your emails.
          </p>
        )}
        <p className="mb-3 text-sm text-text-secondary">
          {isSaving ? "Saving…" : "Changes save automatically."}
        </p>
        <Card>
          {notificationEvents.map((event) => (
            <Checkbox
              key={event}
              label={notificationEventLabels[event]}
              checked={!disabled.has(event)}
              onChange={() => toggle(event)}
            />
          ))}
        </Card>
      </section>
      </div>
    </Disclosure>
  );
};

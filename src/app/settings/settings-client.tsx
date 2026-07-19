"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
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
import { registerNativePush } from "@/lib/push/native";
import { isNativeApp } from "@/lib/platform";
import { saveNotificationPreferences } from "./actions";

type Props = {
  initialDisabledEvents: NotificationEvent[];
};

export const SettingsClient = ({ initialDisabledEvents }: Props) => {
  const toast = useToast();
  const [disabled, setDisabled] = useState<Set<NotificationEvent>>(
    new Set(initialDisabledEvents),
  );
  const [isSaving, startSaving] = useTransition();
  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);

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

  const enableNotifications = async () => {
    setEnabling(true);
    // In the iOS app, register for APNs; on the web, VAPID web push.
    if (isNativeApp()) {
      const result = await registerNativePush();
      setEnabling(false);
      const nativeMessages: Record<typeof result.status, string> = {
        registered: "Notifications enabled on this device.",
        "not-native": "Couldn't enable notifications here.",
        denied: "Notifications are blocked — enable them in iOS Settings.",
        error: "Couldn't enable notifications. Try again.",
      };
      toast(nativeMessages[result.status]);
      return;
    }
    const result = await registerWebPush();
    setEnabling(false);
    const messages: Record<typeof result.status, string> = {
      subscribed: "Notifications enabled on this device.",
      unsupported: "This browser doesn't support notifications.",
      denied: "Notifications are blocked — enable them in your browser settings.",
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
      toast("No devices registered yet — tap \u201CEnable notifications\u201D first.");
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
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold">Notifications</h2>
        <p className="mb-3 text-sm text-text-secondary">
          Get an alert the moment a customer accepts a quote, signs a contract,
          or pays.
        </p>
        <Card className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              onClick={enableNotifications}
              disabled={enabling}
            >
              {enabling ? "Enabling…" : "Enable notifications"}
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
  );
};

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { sendReminderNow } from "@/app/jobs/[id]/reminder-actions";
import * as haptics from "@/lib/haptics";

/**
 * "Send a reminder now" — brings the next scheduled chase wave forward.
 *
 * SECONDARY, never primary. The job page's one primary action is elsewhere in
 * its situation table, and an overdue invoice already has "Mark as paid"
 * competing for attention; two primaries on one screen is the rule this would
 * break.
 *
 * The label lands on its terminal "Reminder sent ✓" BEFORE the refresh fires,
 * per the settled end-state pattern, so a slow router.refresh() can never
 * strand the control mid-spin.
 */
export const SendReminderButton = ({
  invoiceId,
  customerName,
  /** Waves that will remain AFTER this send — 0 means this is the last one. */
  wavesRemaining,
}: {
  invoiceId: string;
  customerName: string;
  wavesRemaining: number;
}) => {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, []);

  const onClick = () => {
    setError(null);
    start(async () => {
      const result = await sendReminderNow({ invoiceId });
      if (!isMounted.current) return;

      if ("error" in result) {
        setError(result.error);
        return;
      }

      void haptics.success();
      toast(
        result.wavesRemaining > 0
          ? `Reminder sent to ${customerName}`
          : `Reminder sent — that was the last one`,
      );
      // Terminal state first, navigation second.
      setSent(true);
      refreshTimer.current = setTimeout(() => {
        if (isMounted.current) router.refresh();
        refreshTimer.current = null;
      }, 450);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* A contained panel adjacent to the control that failed, not a loose
          coloured line. The send either happened or it did not, and the trade
          needs to know which before they decide whether to ring the customer. */}
      {error && (
        <div
          role="alert"
          className="rounded-card border border-red bg-red-tint p-4 text-sm font-semibold text-red"
        >
          {error}
        </div>
      )}
      <Button
        variant="secondary"
        onClick={onClick}
        disabled={pending || sent}
        className="self-start"
      >
        {sent ? "Reminder sent ✓" : pending ? "Sending…" : "Send a reminder now"}
      </Button>
      {/* Said before they press it, not after. The cap is real and permanent,
          and a trade who spends the last wave without knowing has lost the
          automated sequence for good. */}
      {!sent && (
        <p className="text-sm text-ink-secondary">
          {wavesRemaining === 0
            ? `This is the last reminder we'll send ${customerName}. After it, chasing is up to you.`
            : `Sends the next reminder now instead of waiting. ${wavesRemaining} more will be left after it.`}
        </p>
      )}
    </div>
  );
};

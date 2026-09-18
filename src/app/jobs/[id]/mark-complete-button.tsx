"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import * as haptics from "@/lib/haptics";
import { markWorkComplete } from "../actions";

type Props = {
  jobId: string;
  isComplete: boolean;
};

export const MarkCompleteButton = ({ jobId, isComplete }: Props) => {
  const router = useRouter();
  const [settled, setSettled] = useState<"complete" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = () => {
    setError(null);
    start(async () => {
      const willBeComplete = !isComplete;
      // THROWING IS NOT RETURNING, and the catch is why this reads as dead.
      //
      // A server action that rejects inside `startTransition` leaves `pending`
      // true with nothing rendered about it, so the control sits on "Marking
      // complete…" for ever. That is exactly what the 18 Sep screen recording
      // caught, and it is indistinguishable from a button that never fired.
      let res: Awaited<ReturnType<typeof markWorkComplete>>;
      try {
        res = await markWorkComplete({ jobId, complete: willBeComplete });
      } catch {
        haptics.error();
        setError("Something went wrong — please try again.");
        return;
      }

      if ("error" in res) {
        haptics.error();
        // SAY SO. This was `haptics.error(); return;` — a buzz on a phone and
        // nothing on the screen, so a refused completion looked like a tap that
        // had not registered. The contractor tapped again, got the same
        // nothing, and reported the button as broken; the refusal it was
        // reporting had a perfectly good sentence attached to it the whole
        // time.
        setError(res.error);
        return;
      }
      haptics.success();
      // Settled end-state pattern: button lands on its terminal label before
      // navigation fires, so a slow or wedged router.push/refresh never strands
      // the control mid-spin.
      setSettled(willBeComplete ? "complete" : "undo");
      // Wait a moment for the settled state to render, then navigate with the
      // sent query param so the banner confirms what happened.
      setTimeout(() => {
        const sentParam = willBeComplete ? "work_complete" : "work_uncomplete";
        router.push(`/jobs/${jobId}?sent=${sentParam}`);
        router.refresh();
      }, 300);
    });
  };

  if (settled === "complete") {
    return (
      <Button type="button" variant="secondary" disabled>
        Marked complete ✓
      </Button>
    );
  }

  if (settled === "undo") {
    return (
      <Button type="button" variant="secondary" disabled>
        Undone ✓
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {isComplete ? (
        <Button type="button" variant="secondary" disabled={pending} onClick={toggle}>
          {pending ? "Undoing…" : "Undo"}
        </Button>
      ) : (
        <Button type="button" variant="primary" disabled={pending} onClick={toggle}>
          {pending ? "Marking complete…" : "Mark work complete"}
        </Button>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};

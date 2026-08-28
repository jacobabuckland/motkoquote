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
  const [pending, start] = useTransition();

  const toggle = () => {
    start(async () => {
      const willBeComplete = !isComplete;
      const res = await markWorkComplete({ jobId, complete: willBeComplete });
      if ("error" in res) {
        haptics.error();
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

  if (isComplete) {
    return (
      <Button type="button" variant="secondary" disabled={pending} onClick={toggle}>
        {pending ? "Undoing…" : "Undo"}
      </Button>
    );
  }

  return (
    <Button type="button" variant="primary" disabled={pending} onClick={toggle}>
      {pending ? "Marking complete…" : "Mark work complete"}
    </Button>
  );
};

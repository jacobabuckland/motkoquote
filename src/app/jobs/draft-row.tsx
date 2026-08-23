"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SwipeToReveal } from "@/components/ui/swipe-to-reveal";
import { useToast } from "@/components/ui/toast";
import { deleteDraftJob } from "./actions";
import * as haptics from "@/lib/haptics";

// A draft in My work, wrapped in the pull-right gesture so it can be cleared
// without opening it. Drafts are the only rows that get this: they are the one
// thing in the pipeline with nothing behind it to keep, and the server action
// re-checks that before it deletes anything.
//
// Deleting is job-ending, so it follows the archive convention — we are already
// on the list the row leaves, so nothing navigates; the row goes and a toast
// says so rather than letting it vanish silently.
export const DraftRow = ({
  jobId,
  label,
  children,
}: {
  jobId: string;
  label: string;
  children: ReactNode;
}) => {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  // Confirmed even though the pull already took a deliberate gesture: the
  // delete is not reversible, and a swipe is easier to land by accident on a
  // phone than a tap is.
  const onDelete = () => {
    if (!window.confirm(`Delete the draft for ${label}? This can't be undone.`)) return;
    setFailed(false);
    startTransition(async () => {
      try {
        await deleteDraftJob({ jobId });
        haptics.success();
        router.refresh();
        toast("Draft deleted.");
      } catch {
        haptics.error();
        setFailed(true);
      }
    });
  };

  return (
    <SwipeToReveal
      onOpen={haptics.select}
      action={
        <button
          type="button"
          disabled={isPending}
          onClick={onDelete}
          aria-label={`Delete draft for ${label}`}
          className="flex w-full items-center justify-center bg-red px-3 text-sm font-semibold text-white transition-opacity duration-150 disabled:opacity-60"
        >
          {isPending ? "Deleting…" : failed ? "Try again" : "Delete"}
        </button>
      }
    >
      {children}
    </SwipeToReveal>
  );
};

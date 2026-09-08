"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { archiveJob } from "./job-archive-actions";
import * as haptics from "@/lib/haptics";

type Props = {
  jobId: string;
  customerName: string;
};

export const ArchiveJobButton = ({ jobId, customerName }: Props) => {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  // Terminal success state, per the settled end-state pattern. Takes precedence
  // over the pending spinner in the button label.
  const [archived, setArchived] = useState(false);
  // Holds the terminal state visible for ~450ms before navigating.
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track mount state to prevent setting timer after unmount.
  const isMounted = useRef(true);

  // Clear timer on unmount so a navigation cannot fire from a torn-down component.
  useEffect(
    () => () => {
      isMounted.current = false;
      if (navigationTimer.current) {
        clearTimeout(navigationTimer.current);
        navigationTimer.current = null;
      }
    },
    [],
  );

  const handleArchive = () => {
    start(async () => {
      try {
        await archiveJob(jobId);
        await haptics.success();
        setArchived(true);

        // Navigate to dashboard after the terminal state has been visible long
        // enough that the user can perceive the confirmation. The settled
        // end-state pattern: the button lands on "Archived ✓" before navigation
        // fires, so a slow or wedged router.push never strands the control
        // mid-spin.
        if (isMounted.current) {
          navigationTimer.current = setTimeout(() => {
            if (!isMounted.current) return;
            router.push("/jobs");
            toast(`${customerName}'s job has been archived.`);
          }, 450);
        }
      } catch (error) {
        await haptics.error();
        const message =
          error instanceof Error ? error.message : "Failed to archive job";
        toast(message);
      }
    });
  };

  const label = archived ? "Archived ✓" : pending ? "Archiving..." : "Archive job";

  return (
    <Button
      onClick={handleArchive}
      variant="tertiary"
      disabled={pending || archived}
    >
      {label}
    </Button>
  );
};

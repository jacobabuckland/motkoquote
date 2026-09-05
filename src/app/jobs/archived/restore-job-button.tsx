"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { restoreJob } from "../[id]/job-archive-actions";
import * as haptics from "@/lib/haptics";

type Props = {
  jobId: string;
  customerName: string;
};

export const RestoreJobButton = ({ jobId, customerName }: Props) => {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const handleRestore = () => {
    start(async () => {
      try {
        await restoreJob(jobId);
        await haptics.success();
        router.refresh();
        toast(`${customerName}'s job has been restored to the active pipeline.`);
      } catch (error) {
        await haptics.error();
        const message =
          error instanceof Error ? error.message : "Failed to restore job";
        toast(message);
      }
    });
  };

  return (
    <Button onClick={handleRestore} variant="secondary" disabled={pending}>
      {pending ? "Restoring..." : "Restore"}
    </Button>
  );
};

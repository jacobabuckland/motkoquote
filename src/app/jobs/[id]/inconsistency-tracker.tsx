"use client";

import { useEffect } from "react";
import { trackInconsistency } from "./track-inconsistency";

type Props = {
  jobId: string;
  quoteId: string | undefined;
  situation: string;
  forcedStages: string[];
  inconsistencyKey: string;
};

/**
 * Client component that tracks stepper_inconsistency events with deduplication.
 * Uses localStorage to ensure each unique inconsistency is logged exactly once,
 * not on every page view.
 */
export function InconsistencyTracker({
  jobId,
  quoteId,
  situation,
  forcedStages,
  inconsistencyKey,
}: Props) {
  useEffect(() => {
    // Build a stable storage key from job_id + inconsistency_key
    const storageKey = `stepper_inconsistency:${jobId}:${inconsistencyKey}`;

    // Check if we've already tracked this exact inconsistency
    if (typeof window !== "undefined" && window.localStorage) {
      const alreadyTracked = localStorage.getItem(storageKey);

      if (!alreadyTracked) {
        // Fire the event via server action
        void trackInconsistency(jobId, quoteId, situation, forcedStages, inconsistencyKey);

        // Mark as tracked
        localStorage.setItem(storageKey, "1");
      }
    }
  }, [jobId, quoteId, situation, forcedStages, inconsistencyKey]);

  return null;
}

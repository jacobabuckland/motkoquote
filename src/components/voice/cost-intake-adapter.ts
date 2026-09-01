/**
 * Adapter interface for voice cost capture.
 *
 * Separates the voice UI component from the persistence layer,
 * analogous to job-intake-adapter.ts.
 */

import type { JobSummary } from "@/lib/match-job";

export type DraftedCost = {
  amountPence: number;
  amountWords: string; // e.g. "two hundred and eighty pounds"
  counterpartyName: string | null;
  category: "materials" | "labour" | "subcontractor" | "plant_hire" | "other";
  jobId: string;
  jobDisplay: string; // e.g. "Henderson — kitchen rewiring"
  incurredOn: string; // YYYY-MM-DD
  description: string; // e.g. "Materials from Screwfix"
};

export type CostIntakeAdapter = {
  /**
   * Called when the voice session starts. Returns a session key (for
   * persistence tracking), a client secret (for the Realtime API), and the
   * contractor's jobs.
   *
   * The jobs are for the deterministic matcher (#274). They come back with the
   * session because the server has already loaded them to build the prompt, and
   * because the match has to happen where the tool call is handled — the model
   * has no job-id field to supply, by design.
   */
  startSession: () => Promise<{
    sessionKey: string | null;
    clientSecret: string;
    jobs: JobSummary[];
  }>;

  /**
   * Called with the drafted cost for confirmation before any write.
   * Only returns after the contractor confirms or edits.
   */
  complete: (draft: DraftedCost) => Promise<void>;

  /**
   * Navigation and UI customization
   */
  backHref: string;
  backLabel: string;
  headerAction?: React.ReactNode;

  /**
   * Error handling
   */
  failureBody?: string;
  reportFailure?: (details: {
    sessionKey: string | null;
    stage: string;
    message: string;
  }) => void;

  /**
   * Save for later (best-effort)
   */
  saveForLater?: (params: {
    sessionKey: string | null;
    transcript: string;
  }) => Promise<void>;
};

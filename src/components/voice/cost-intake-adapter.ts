/**
 * Adapter interface for voice cost capture.
 *
 * Separates the voice UI component from the persistence layer,
 * analogous to job-intake-adapter.ts.
 */

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
   * Called when the voice session starts. Returns a session key
   * (for persistence tracking) and client secret (for OpenAI Realtime API).
   */
  startSession: () => Promise<{
    sessionKey: string | null;
    clientSecret: string;
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

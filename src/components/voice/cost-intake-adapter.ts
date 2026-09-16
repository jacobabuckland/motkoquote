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
  // What was said about VAT and settlement. All three were absent, so every
  // voice cost was saved as a net, standard-rated, unpaid one whatever the
  // contractor actually said — see src/lib/cost-vat-basis.ts.
  amountBasis: "net" | "gross" | "unknown";
  vatAmountWords: string | null;
  vatTreatment: "standard" | "zero" | "exempt" | "reverse_charge" | "unknown";
  /** null = they did not say. Never assumed either way. */
  paid: boolean | null;
  /**
   * The net and the VAT, resolved from the three fields above at draft time.
   *
   * Null when the basis is ambiguous — the server refuses that case and the
   * assistant asks. Carried on the draft so the confirmation screen can show
   * what is about to be saved, and so the Edit button hands the manual form the
   * NET rather than the gross: it prefilled `amountNet` from `amountPence` and
   * hardcoded `paid: false`, which put "£120 inc VAT" into the form as £120 net
   * and unpaid — the same defect cost-vat-basis.ts exists to stop, on the other
   * path out of this screen.
   */
  amountNet: number | null;
  vatAmount: number | null;
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

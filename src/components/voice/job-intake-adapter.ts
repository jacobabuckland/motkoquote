import type { SowState, WrapReason, ChecklistQuestionId } from "@/lib/schemas/sow";
import type { TranscriptTurn } from "@/lib/voice-transcript";

// The live job intake runs identically for a signed-in trade and for a guest.
// Everything that differs between them is persistence, personalisation or
// navigation — never the conversation — so it is pushed behind this adapter
// rather than forked into a second copy of the screen. A guest adapter simply
// omits the optional members: there is no account to record a name against, no
// row to save a transcript to, and no typed-quote job to create.

export type IntakeSession = {
  // The account intake's job row id, threaded back into persistDelta/complete.
  // Null for a guest: a guest quote is a rendered artefact, never a job
  // aggregate, so there is deliberately no identifier to carry.
  sessionKey: string | null;
  clientSecret: string;
};

export type IntakeCompletion = {
  sessionKey: string | null;
  sow: SowState | null;
  transcript: string;
  conversationTurns: TranscriptTurn[];
  wrapReason: WrapReason;
  questionsAsked: number;
  requiredSlotsAsked: ChecklistQuestionId[];
  unaskedRequired: ChecklistQuestionId[];
};

export type JobIntakeAdapter = {
  mode: "account" | "guest";

  /** Mints the Realtime credential and whatever session identity the mode has. */
  startSession: () => Promise<IntakeSession>;

  /**
   * Folds one `update_sow` delta into the running state and returns the merged
   * result. The account adapter round-trips it through the job row; the guest
   * adapter runs the same pure merge in memory and writes nothing.
   */
  persistDelta: (input: {
    sessionKey: string | null;
    current: SowState | null;
    delta: unknown;
  }) => Promise<SowState>;

  /** Drafts the quote and navigates onward. Owns its own destination. */
  complete: (input: IntakeCompletion) => Promise<void>;

  /**
   * Where the header's back/cancel control goes. Omitted for the guest intake:
   * it IS the first screen, so there is nowhere behind it to cancel to.
   */
  backHref?: string;
  backLabel?: string;

  /**
   * Trailing control in the top bar. The guest intake puts Sign In here so a
   * returning trade (or a reviewer with credentials) can always find the way
   * into the account-based half of the app, from the first screen, without
   * scrolling.
   */
  headerAction?: React.ReactNode;

  /** Copy for the drafting-failure screen — a guest's work is not "saved". */
  failureBody: string;

  // ---- Optional, account-only ----------------------------------------------

  /** Persist the trade's own first name, volunteered mid-call. */
  recordFirstName?: (firstName: string) => void;

  /** Persist a crew member named mid-call, with their day rate. */
  recordPerson?: (person: { name: string; role?: string; day_rate: number }) => void;

  /** Persist the transcript and step away from a stalled draft. */
  saveForLater?: (input: {
    sessionKey: string | null;
    transcript: string;
    conversationTurns: TranscriptTurn[];
  }) => Promise<void>;

  /** Telemetry for a stalled or failed drafting pipeline. */
  reportFailure?: (input: {
    sessionKey: string | null;
    stage: "writing" | "pricing";
    message: string;
  }) => void;

  /** The typed-quote escape hatch. Absent when it requires an account. */
  startManual?: () => Promise<void>;

  /**
   * Rendered in place of the typed-quote escape hatch when that action needs an
   * account — an inline prompt at the point of use, never a redirect.
   */
  manualUnavailable?: React.ReactNode;
};

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatGBP } from "@/lib/format";

// The zero-free-jobs ladder: how close a trade is to running out of fee-free
// jobs, and whether we should nudge, warn, or (finally) stop them sending new
// quotes until they set up billing. Pure and I/O-free so every rung is unit
// tested; loadFeeRunway (below) gathers the facts and defers to it.
//
// The whole ladder is dark unless fee billing is switched on (FEE_BILLING_ENABLED
// — see fee-billing-flag.ts): with the flag off we never nudge and never block,
// so nothing about fees is surfaced before go-live.

// A trade whose free allowance is spent still gets to land this many more paid
// jobs (the "grace" window) before we stop them sending NEW quotes — enough
// runway to set billing up without being cut off mid-flow.
export const GRACE_PAID_JOBS = 3;

// At or below this many free jobs left (but not yet zero) we show a passive
// "set up billing" nudge — no blocking, just a heads-up.
export const PASSIVE_NUDGE_MAX_FREE_JOBS = 2;

// inactive: flag off — nothing shown, nothing blocked.
// ok: plenty of runway (billing set up, or >2 free jobs left).
// passive_nudge: 1–2 free jobs left — gentle "set up billing" heads-up.
// grace: allowance spent, no mandate — still sending, inside the grace window.
// blocked: grace spent, no mandate — new quotes are stopped until billing set up.
export type FeeRunwayState = "inactive" | "ok" | "passive_nudge" | "grace" | "blocked";

export type FeeRunwayInput = {
  feeBillingEnabled: boolean;
  // Free jobs left, from the credit_events ledger sum (the single source of
  // truth). Founding/referral credits are already folded in here, so extra
  // runway simply raises this number — no special-casing needed.
  freeJobsRemaining: number;
  // True only when the trade has an authorised fee-collection mandate.
  mandateAuthorized: boolean;
  // Paid jobs that have accrued a fee since the allowance hit zero — i.e. how
  // much of the grace window is used up. Sourced from jobs in fee_status
  // 'accrued'.
  paidJobsSinceAllowanceZero: number;
  // Total accrued (uncollected) fee owed, in pennies — shown in the banner.
  accruedFeePennies: number;
};

export type FeeRunway = {
  state: FeeRunwayState;
  freeJobsRemaining: number;
  accruedFeePennies: number;
  // Paid jobs still allowed inside the grace window (0 outside 'grace').
  gracePaidJobsRemaining: number;
  // The one action the ladder ever gates: sending a NEW quote. Marking a job
  // paid, receiving payment, and viewing anything are NEVER gated.
  canSendQuote: boolean;
};

// Surfaced to the trade when a blocked send is attempted (thrown by sendQuote,
// shown verbatim). Points them at the one place that unblocks it.
export const FEE_RUNWAY_BLOCKED_MESSAGE =
  "You've used all your free jobs. Set up fee billing in Settings to send new quotes.";

export const computeFeeRunway = (input: FeeRunwayInput): FeeRunway => {
  const base = {
    freeJobsRemaining: input.freeJobsRemaining,
    accruedFeePennies: input.accruedFeePennies,
    gracePaidJobsRemaining: 0,
  };

  // Flag off → the whole ladder is dark: never nudge, never block.
  if (!input.feeBillingEnabled) {
    return { ...base, state: "inactive", canSendQuote: true };
  }

  // Billing set up → nothing to nudge or block; fees just collect quietly.
  if (input.mandateAuthorized) {
    return { ...base, state: "ok", canSendQuote: true };
  }

  const free = input.freeJobsRemaining;
  if (free > PASSIVE_NUDGE_MAX_FREE_JOBS) {
    return { ...base, state: "ok", canSendQuote: true };
  }
  if (free > 0) {
    return { ...base, state: "passive_nudge", canSendQuote: true };
  }

  // Allowance spent with no mandate — the grace window is open until the trade
  // has landed GRACE_PAID_JOBS more paid jobs, after which new sends stop.
  const graceRemaining = Math.max(0, GRACE_PAID_JOBS - input.paidJobsSinceAllowanceZero);
  if (graceRemaining > 0) {
    return { ...base, state: "grace", gracePaidJobsRemaining: graceRemaining, canSendQuote: true };
  }
  return { ...base, state: "blocked", canSendQuote: false };
};

// The banner copy for one rung of the ladder, or null when nothing should show
// (state 'inactive' — flag off — or 'ok'). Kept pure so the "renders nothing"
// contract and the blessed pricing wording are asserted without rendering JSX;
// FeeRunwayBanner just paints what this returns. Wording follows the blessed
// model: first 5 paid jobs free, then £2 per paid job (£4 over £1,000), taken
// out of each payment when it settles.
export type FeeRunwayBannerCopy = {
  tone: "warning" | "error";
  body: string;
  ctaLabel: string;
  ctaHref: string;
};

const jobWord = (n: number): string => (n === 1 ? "job" : "jobs");
const quoteWord = (n: number): string => (n === 1 ? "quote" : "quotes");

export const feeRunwayBannerCopy = (runway: FeeRunway): FeeRunwayBannerCopy | null => {
  if (runway.state === "inactive" || runway.state === "ok") return null;

  const accrued = formatGBP(runway.accruedFeePennies / 100);
  const cta = { ctaLabel: "Set up fee billing", ctaHref: "/settings" };

  if (runway.state === "passive_nudge") {
    return {
      tone: "warning",
      body: `${runway.freeJobsRemaining} free ${jobWord(runway.freeJobsRemaining)} left. Motko stays free for your first 5 paid jobs — after that it's £2 per paid job (£4 over £1,000), taken out of the payment when it settles.`,
      ...cta,
    };
  }

  if (runway.state === "grace") {
    return {
      tone: "warning",
      body: `Your free jobs are used up — ${accrued} in Motko fees has started to add up (£2 per paid job, £4 over £1,000). You can send ${runway.gracePaidJobsRemaining} more ${quoteWord(runway.gracePaidJobsRemaining)} before you'll need billing set up. Set it up now to keep quoting.`,
      ...cta,
    };
  }

  return {
    tone: "error",
    body: `New quotes are paused — your free jobs are used up and fee billing isn't set up yet (${accrued} in fees so far). You can still get paid and manage your existing jobs. Set up billing to send quotes again.`,
    ...cta,
  };
};

// Gathers the ladder facts for one trade and computes the runway. Reads only —
// safe with the RLS user client (owner-read policies on credit_events, jobs,
// contractors). Short-circuits without any reads while the flag is off.
export const loadFeeRunway = async (
  supabase: SupabaseClient,
  contractorId: string,
  feeBillingEnabled: boolean,
): Promise<FeeRunway> => {
  if (!feeBillingEnabled) {
    return computeFeeRunway({
      feeBillingEnabled: false,
      freeJobsRemaining: 0,
      mandateAuthorized: false,
      paidJobsSinceAllowanceZero: 0,
      accruedFeePennies: 0,
    });
  }

  const [{ data: events }, { data: contractor }, { data: accrued }] = await Promise.all([
    supabase.from("credit_events").select("delta").eq("contractor_id", contractorId),
    supabase
      .from("contractors")
      .select("fee_mandate_status")
      .eq("id", contractorId)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select("fee_amount_pennies")
      .eq("contractor_id", contractorId)
      .eq("fee_status", "accrued"),
  ]);

  const freeJobsRemaining = ((events ?? []) as { delta: number }[]).reduce(
    (sum, e) => sum + e.delta,
    0,
  );
  const accruedRows = (accrued ?? []) as { fee_amount_pennies: number | null }[];
  const accruedFeePennies = accruedRows.reduce((sum, j) => sum + (j.fee_amount_pennies ?? 0), 0);
  const mandateStatus =
    (contractor as { fee_mandate_status?: string | null } | null)?.fee_mandate_status ?? null;

  return computeFeeRunway({
    feeBillingEnabled: true,
    freeJobsRemaining,
    mandateAuthorized: mandateStatus === "authorized",
    paidJobsSinceAllowanceZero: accruedRows.length,
    accruedFeePennies,
  });
};

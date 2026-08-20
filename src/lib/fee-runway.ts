import type { SupabaseClient } from "@supabase/supabase-js";

// The free-allowance runway: how close a trade is to running out of fee-free
// jobs. Purely informational — it tells the trade where they are in the
// allowance and what the fee becomes after it. Pure and I/O-free so every rung
// is unit tested; loadFeeRunway (below) gathers the facts and defers to it.
//
// This ladder USED to gate quote-sending once the allowance and a grace window
// were spent, unblocking only on an authorised VRP mandate. PAY-5 removed that
// mandate rail, so the unblock condition became unreachable and the gate could
// only ever strand a trade. The gate is gone: nothing here blocks any action.
// The fee is taken at source by Stripe on each payment, so there is nothing for
// a trade to "set up" and nothing to stop them doing in the meantime.

// At or below this many free jobs left (but not yet zero) we show a passive
// heads-up about what happens when the allowance runs out.
export const PASSIVE_NUDGE_MAX_FREE_JOBS = 2;

// ok: plenty of runway (>2 free jobs left) — nothing shown.
// passive_nudge: 1–2 free jobs left — gentle heads-up.
// allowance_spent: no free jobs left — the per-paid-job fee now applies.
export type FeeRunwayState = "ok" | "passive_nudge" | "allowance_spent";

export type FeeRunwayInput = {
  // Free jobs left, from the credit_events ledger sum (the single source of
  // truth). Founding/referral credits are already folded in here, so extra
  // runway simply raises this number — no special-casing needed.
  freeJobsRemaining: number;
};

export type FeeRunway = {
  state: FeeRunwayState;
  freeJobsRemaining: number;
};

export const computeFeeRunway = (input: FeeRunwayInput): FeeRunway => {
  const free = input.freeJobsRemaining;
  const base = { freeJobsRemaining: free };

  if (free > PASSIVE_NUDGE_MAX_FREE_JOBS) return { ...base, state: "ok" };
  if (free > 0) return { ...base, state: "passive_nudge" };
  return { ...base, state: "allowance_spent" };
};

// The banner copy for one rung, or null when nothing should show (state 'ok').
// Kept pure so the "renders nothing" contract and the pricing wording are
// asserted without rendering JSX; FeeRunwayBanner just paints what this returns.
//
// The wording states the model only — the allowance, the two bands, and that
// the fee comes out of the payment. It never quotes a running balance and never
// promises a collection, because for a job marked paid by hand nothing is taken
// and nothing collects it (see the fees statement in Settings, which shows those
// as outstanding rather than scheduled).
export type FeeRunwayBannerCopy = {
  tone: "warning";
  body: string;
  ctaLabel: string;
  ctaHref: string;
};

const jobWord = (n: number): string => (n === 1 ? "job" : "jobs");

export const feeRunwayBannerCopy = (runway: FeeRunway): FeeRunwayBannerCopy | null => {
  if (runway.state === "ok") return null;

  const cta = { ctaLabel: "See your fees", ctaHref: "/settings" };

  if (runway.state === "passive_nudge") {
    return {
      tone: "warning",
      body: `${runway.freeJobsRemaining} free ${jobWord(runway.freeJobsRemaining)} left. Motko stays free for your first 5 paid jobs — after that it's £2 per paid job (£4 over £1,000), taken out of the payment when it settles.`,
      ...cta,
    };
  }

  return {
    tone: "warning",
    body: "Your free jobs are used up. From here it's £2 per paid job (£4 over £1,000), taken out of the payment when it settles. Nothing to set up, and nothing stops you quoting.",
    ...cta,
  };
};

// Gathers the runway facts for one trade. Reads only — safe with the RLS user
// client (owner-read policy on credit_events). The ledger sum is the source of
// truth, not the contractors.free_jobs_remaining cache.
export const loadFeeRunway = async (
  supabase: SupabaseClient,
  contractorId: string,
): Promise<FeeRunway> => {
  const { data: events } = await supabase
    .from("credit_events")
    .select("delta")
    .eq("contractor_id", contractorId);

  const freeJobsRemaining = ((events ?? []) as { delta: number }[]).reduce(
    (sum, e) => sum + e.delta,
    0,
  );

  return computeFeeRunway({ freeJobsRemaining });
};

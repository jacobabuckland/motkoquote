"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { UNPRICED_ACCEPT_REFUSED } from "@/lib/unpriced-quote-copy";
import type { LineItem } from "@/lib/schemas/job";

type QuoteJobRow = {
  job_id: string;
  job: { customer: { name: string } | null } | null;
};

const loadQuoteJob = async (
  admin: ReturnType<typeof createAdminClient>,
  quoteId: string,
): Promise<{ jobId: string; customerName: string } | null> => {
  const { data } = await admin
    .from("quotes")
    .select("job_id, job:jobs(customer:customers(name))")
    .eq("id", quoteId)
    .maybeSingle();

  const row = data as unknown as QuoteJobRow | null;
  if (!row?.job_id) return null;
  return { jobId: row.job_id, customerName: row.job?.customer?.name ?? "Your customer" };
};

/**
 * What a response actually did.
 *
 * "applied" — the quote moved. "not_open" — it was not awaiting a decision, so
 * nothing changed.
 *
 * THE SILENT RETURN WAS A LIE TO THE CUSTOMER. Both actions guard on
 * `.eq("status", "sent")`, which is right: a withdrawn, declined or already
 * accepted quote must not be flipped. But they then returned `undefined`
 * indistinguishably from success, and the page's handler ran
 * `setCurrentStatus("accepted")` on the next line. On quote B3112196 — archived
 * by the contractor, still fully public — a customer could press Accept, be told
 * "You accepted this quote.", and have nothing recorded anywhere. The contractor
 * would never learn they had said yes.
 *
 * Reported 15 Sep as "Accept quote silently no-opped", which is what it looks
 * like from outside when the second tap finds the status already changed
 * locally.
 */
export type QuoteResponseResult = "applied" | "not_open";

export const acceptQuote = async (quoteId: string): Promise<QuoteResponseResult> => {
  const admin = createAdminClient();

  // Nobody may accept a quote that does not state its price. The page already
  // withholds the button, but a hidden control is not a guard — this is a
  // public capability URL and the action is reachable without it. Accepting
  // here is what freezes the figures as agreed evidence and unlocks the
  // contract, whose money panel reads `quotes.total` — a total that, on an
  // unpriced quote, silently omits the missing line. Refuse instead.
  const { data: priced } = await admin
    .from("quotes")
    .select("line_items_json")
    .eq("id", quoteId)
    .maybeSingle();

  const lineItems = (priced?.line_items_json as LineItem[] | null) ?? [];
  if (lineItems.some((item) => item.unpriced)) {
    throw new Error(UNPRICED_ACCEPT_REFUSED);
  }

  // State-machine guard: a quote may only be accepted while it is still awaiting
  // a decision (status 'sent'). Asserting the legal PRIOR state — not merely
  // "not already accepted" — blocks a *declined* quote from being flipped to
  // accepted, and preserves idempotency: a re-tap matches no row and no-ops.
  const acceptedAt = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("quotes")
    // `accepted_at` is the CURRENT state, and re-issuing a quote clears it —
    // correctly, or the job would read as accepted while awaiting a second
    // acceptance. `accepted_first_at` (migration 82) is the HISTORY, and it is
    // deliberately NOT set here: a re-issued quote returns to `sent` and can be
    // accepted again, so writing it alongside would overwrite the first
    // acceptance with the latest — the exact thing the column exists to stop.
    // It is recorded once, below.
    .update({ status: "accepted", accepted_at: acceptedAt })
    .eq("id", quoteId)
    .eq("status", "sent")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) return "not_open";

  // Record the FIRST acceptance, once (migration 82).
  //
  // Read-then-write rather than a single `is null` predicate. `.is()` would be
  // the better filter — it is the only one PostgREST matches nulls with — but
  // `tests/acceptance/651.test.ts` is FROZEN and hand-rolls a Supabase stub
  // whose `update().eq()` chain has no `.is`, so no implementation using it can
  // pass. `.eq(col, null)` is not a substitute: PostgREST's `eq.null` does not
  // match nulls.
  //
  // The race this leaves is benign. Two simultaneous acceptances would write
  // near-identical timestamps, and the guard above already makes the second
  // acceptance a no-op for `accepted_at` — so the worst case is the recorded
  // first acceptance being off by milliseconds, against a column whose whole
  // job is to survive a re-issue days later.
  //
  // Deliberately NOT fatal. This is the audit trail, not the acceptance: if it
  // fails the customer has still accepted, the quote already says so, and
  // losing a timeline entry must not lose the agreement.
  try {
    const { data: existing } = await admin
      .from("quotes")
      .select("accepted_first_at, total")
      .eq("id", quoteId)
      .maybeSingle();

    const row = existing as { accepted_first_at?: string | null; total?: number | null } | null;

    // EVERY acceptance gets a row (migration 85). The columns below record the
    // FIRST one and cannot record a second, because a quote is one row and
    // `accepted_at` holds only the current state — so a customer who accepts,
    // sees the quote re-issued and accepts again left no trace of the second.
    // Pass 14 watched three acceptances produce one log entry, naming the
    // figure the customer had moved past, on a job whose signed contract was
    // the later one.
    //
    // Insert, never upsert: the table is append-only and two acceptances
    // genuinely are two events, even at the same total.
    await admin.from("quote_acceptances").insert({
      quote_id: quoteId,
      accepted_at: acceptedAt,
      // What they accepted, read at the moment of acceptance. A re-issue
      // overwrites `total`, so this is the only moment it certainly names the
      // agreed figure — the same reasoning as migration 84, per acceptance.
      accepted_total: row?.total ?? null,
    });

    if (!row?.accepted_first_at) {
      // `accepted_total` rides with `accepted_first_at` because they answer the
      // two halves of one question, and both must survive a re-issue: WHEN the
      // customer agreed, and WHAT they agreed to (migration 84). `total` is
      // overwritten by a re-issue, so read here — at the moment of acceptance —
      // is the only time it is certainly the accepted figure.
      await admin
        .from("quotes")
        .update({ accepted_first_at: acceptedAt, accepted_total: row?.total ?? null })
        .eq("id", quoteId);
    }
  } catch (err) {
    console.error("accepted_first_at record failed:", err);
  }

  const job = await loadQuoteJob(admin, quoteId);
  if (job) {
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.jobId,
      event: "quote_accepted",
      subject: `${job.customerName} accepted your quote`,
      heading: `${job.customerName} accepted your quote.`,
      nextStep: "Next step: send them a contract to sign.",
    });
  }
  return "applied";
};

export const declineQuote = async (quoteId: string): Promise<QuoteResponseResult> => {
  const admin = createAdminClient();
  // State-machine guard: a quote may only be declined while it is still awaiting
  // a decision (status 'sent'). Asserting the legal PRIOR state blocks an
  // *accepted* quote from being flipped to declined, and preserves idempotency:
  // a re-tap matches no row and no-ops.
  const { data: updated, error } = await admin
    .from("quotes")
    .update({ status: "declined", declined_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("status", "sent")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) return "not_open";

  const job = await loadQuoteJob(admin, quoteId);
  if (job) {
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.jobId,
      event: "quote_declined",
      subject: `${job.customerName} declined your quote`,
      heading: `${job.customerName} declined your quote.`,
      nextStep: "Nothing needs you here — start a new quote if things change.",
    });
  }
  return "applied";
};

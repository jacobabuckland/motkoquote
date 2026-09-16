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
    // `accepted_first_at` is written here and NEVER cleared (migration 82).
    //
    // `accepted_at` is the CURRENT state, and re-issuing a quote clears it —
    // correctly, or the job would read as accepted while awaiting a second
    // acceptance. But `buildTimeline` reads that same column, so clearing it
    // made the acceptance stop having HAPPENED: pass 12 edited an accepted
    // quote and watched "Quote accepted" vanish from the Activity panel. If a
    // dispute followed, the audit trail said the customer never accepted
    // anything.
    //
    // NOT written here. A re-issued quote returns to `sent` and can be accepted
    // again, so setting it alongside `accepted_at` would overwrite the first
    // acceptance with the latest — the exact thing the column exists to stop.
    // It is claimed separately below, under a `null` predicate.
    .update({ status: "accepted", accepted_at: acceptedAt })
    .eq("id", quoteId)
    .eq("status", "sent")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) return "not_open";

  // Claim the FIRST acceptance, once and for ever (migration 82).
  //
  // The `is null` predicate is what makes this the first rather than the
  // latest: on a re-acceptance after a re-issue it matches no row and no-ops,
  // so the original timestamp survives however many times the quote goes round.
  // That predicate is also the whole concurrency story — two simultaneous
  // acceptances cannot both claim it, because the second finds it non-null.
  //
  // Deliberately NOT fatal. This is the audit trail, not the acceptance: if it
  // fails the customer has still accepted, the quote already says so, and
  // losing a timeline entry must not lose the agreement.
  const { error: firstAcceptError } = await admin
    .from("quotes")
    .update({ accepted_first_at: acceptedAt })
    .eq("id", quoteId)
    .is("accepted_first_at", null);

  if (firstAcceptError) {
    console.error("accepted_first_at claim failed:", firstAcceptError.message);
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

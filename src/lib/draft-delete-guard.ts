// What makes deleting a draft safe. Archiving (see archiveQuote) is the right
// move for a quote that has *left* draft, because quotes cascade into invoices
// and contracts and a stray tap must never destroy a financial record. A draft
// is the one case where there is genuinely nothing to keep: no quote has been
// sent, no contract raised, no invoice issued, no cost recorded. This module is
// the check that proves it, kept pure so the rule can be tested without a
// database.

import { embeddedMany, type Embedded } from "@/lib/postgrest-embed";

export const DRAFT_ALREADY_SENT =
  "This job has already left draft — archive it instead of deleting it.";
export const DRAFT_HAS_RECORDS =
  "This job has a contract or invoice against it — archive it instead of deleting it.";
export const DRAFT_HAS_COSTS =
  "This job has recorded costs — archive it instead of deleting it.";

// The shape the delete action reads back before it commits. Nested arrays
// mirror the PostgREST embedding (`quotes(status, contracts(id), invoices(id))`).
export type DeletionCandidate = {
  quotes?:
    | {
        status: string;
        // to-one embed: an OBJECT, not an array. `.length` on it was undefined,
        // so a quote WITH a contract read as one without. See postgrest-embed.ts.
        contracts?: Embedded<{ id: string }>;
        invoices?: { id: string }[] | null;
      }[]
    | null;
  job_costs?: { id: string }[] | null;
};

export type DeletionVerdict = { deletable: true } | { deletable: false; reason: string };

export const assessDraftDeletion = (job: DeletionCandidate): DeletionVerdict => {
  const quotes = job.quotes ?? [];

  // "draft" is the only status that has never been shown to a customer.
  // Archived quotes are excluded deliberately: an archived quote may have been
  // sent, accepted or invoiced before it was put away.
  if (quotes.some((quote) => quote.status !== "draft")) {
    return { deletable: false, reason: DRAFT_ALREADY_SENT };
  }

  if (
    quotes.some(
      (quote) => embeddedMany(quote.contracts).length > 0 || (quote.invoices?.length ?? 0) > 0,
    )
  ) {
    return { deletable: false, reason: DRAFT_HAS_RECORDS };
  }

  // job_costs holds the job_id foreign key ON DELETE RESTRICT, so this would
  // fail at the database anyway — checked here so the contractor gets the
  // reason rather than a constraint violation.
  if ((job.job_costs?.length ?? 0) > 0) {
    return { deletable: false, reason: DRAFT_HAS_COSTS };
  }

  return { deletable: true };
};

import { logError } from "@/lib/analytics";

/**
 * A rejected query must never look like an empty result.
 *
 * Both of this app's quote reads destructured only `data`:
 *
 *   const { data: quoteRaw } = await supabase.from("quotes").select(…)
 *   const { data: quote }    = await admin.from("quotes").select(…)
 *
 * so when PostgREST rejected the select — `column quotes.sent_total does not
 * exist`, because #387's migration had never been applied — `data` came back
 * null and the error was dropped on the floor. The job page fell into its
 * no-quote branch and rendered "Your quote is on its way — refresh in a
 * moment" beside a "Quote ready" badge, and the public quote page called
 * notFound(), 404ing every customer quote link that had been sent.
 *
 * Nothing anywhere said a query had failed. The outage was found by a
 * contractor reporting a screen that looked calm and said the wrong thing, and
 * diagnosing it meant reading the select and guessing which column was new.
 *
 * The distinction this restores is the one that was lost:
 *
 *   error present            -> something is broken. Fail loudly.
 *   no error, no rows        -> genuinely nothing there. That is a real answer,
 *                               and each caller decides what it means.
 *
 * Throwing reaches src/app/error.tsx and leaves a stack trace; logError also
 * writes to the server log and the events table, so the next one is visible
 * without anyone opening a browser.
 */
export type QueryError = { message: string; code?: string; details?: string } | null;

/**
 * Throws when a Supabase query returned an error, after logging it.
 *
 * `what` names the query in the message, so a server log says which read
 * failed rather than only that one did.
 */
export const throwIfQueryFailed = async (
  error: QueryError,
  what: string,
): Promise<void> => {
  if (!error) return;

  // A missing column is the specific failure that produced the outage this
  // exists for, and it is worth calling out by name: it means code shipped
  // ahead of its migration, which is a deploy-ordering fault rather than a
  // transient database problem, and it will not resolve on a retry.
  const looksLikeMissingColumn = /does not exist|column .* of relation/i.test(
    `${error.message} ${error.details ?? ""}`,
  );

  await logError("server", `Query failed: ${what}`, {
    message: error.message,
    code: error.code ?? "",
    details: error.details ?? "",
    likely_schema_drift: looksLikeMissingColumn,
  });

  throw new Error(
    looksLikeMissingColumn
      ? `${what} failed against a schema that does not have what it asked for: ${error.message}. ` +
        `This is almost certainly code deployed ahead of its migration — check the column exists on production.`
      : `${what} failed: ${error.message}`,
  );
};

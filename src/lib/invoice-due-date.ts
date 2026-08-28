// The due date a new invoice gets when the contractor doesn't set one.
//
// Invoices were raised with `due_date: null` whenever the field was left blank,
// which it usually was — it is an optional, empty date picker at the bottom of
// the form. An invoice with no due date states no payment terms to the customer
// and gives the contractor nothing to chase against: isInvoiceOverdue can never
// fire on it, so it sits unpaid and un-chased indefinitely.
//
// 14 days, not the contractor's `default_payment_terms`: that field is free
// prose rendered into contract clauses ("payment due within 30 days of
// invoice", or anything else they typed), and deriving a number of days from
// prose would mean guessing at the one figure that decides when a customer is
// told they are late. If a contractor wants different terms they set the date
// on the form, which stays editable.

export const DEFAULT_INVOICE_TERM_DAYS = 14;

/**
 * `YYYY-MM-DD`, the default term after the given date. UTC throughout: the
 * column is a date, not a timestamp, and deriving it in local time would move
 * the due date by a day either side of midnight depending on where the server
 * happened to run.
 */
export const defaultInvoiceDueDate = (
  from: Date = new Date(),
  termDays: number = DEFAULT_INVOICE_TERM_DAYS,
): string => {
  const due = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + termDays),
  );
  return due.toISOString().slice(0, 10);
};

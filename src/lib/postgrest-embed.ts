// The shape of an embedded relationship, and the one safe way to read it.
//
// PostgREST decides an embed's cardinality from the CHILD table's constraints,
// not from how the query is written. When the foreign-key column carries a
// UNIQUE constraint the relationship is to-one, and the embed comes back as a
// bare OBJECT — not a one-element array.
//
// In this schema exactly one relationship is like that:
//
//   contracts.quote_id  uuid not null references quotes (id) ... UNIQUE
//                                              (migration 11, line 3)
//
// so `quotes(..., contracts(...))` returns `contracts: {...}` while
// `quotes(..., invoices(...))` returns `invoices: [{...}]`, because
// invoices.quote_id has no UNIQUE (a quote carries a deposit AND a final).
// quotes.job_id has none either, so `jobs(..., quotes(...))` is an array too.
//
// Every consumer of the contracts embed had typed it as an array and read it
// with `?.[0]`, which on an object yields `undefined`. TypeScript never saw it:
// each of those rows crosses an `as unknown as` cast on the way out of the
// Supabase client, so the declared type was simply asserted, never checked.
// The result was a job with a sent contract reading as a job with NO contract —
// offering "Send contract" on the dashboard while the same job sat under
// "Contracts awaiting signature", and refusing to mark work complete because
// the signature it needed was invisible.
//
// `Embedded<T>` is deliberately wider than either shape. Declaring an embed
// with it makes `?.[0]` stop compiling, so the only way through is this
// accessor — and a future PostgREST that flips the shape back changes nothing.

/**
 * An embedded relationship as it may arrive over the wire: an object when
 * PostgREST judges the relationship to-one, an array when it does not, and
 * absent when the caller did not select it.
 */
export type Embedded<T> = T | T[] | null | undefined;

/**
 * The single related row, or null. Use for a to-one embed (`contracts`).
 *
 * Tolerates both shapes on purpose: the cardinality is PostgREST's to decide
 * and it has changed under us once already.
 */
export const embeddedOne = <T>(value: Embedded<T>): T | null => {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
};

/**
 * The related rows as an array, always. Use where downstream code iterates —
 * `.find`, `.filter`, `.length` — so a to-one embed cannot arrive as an object
 * and throw "x.find is not a function" at runtime.
 */
export const embeddedMany = <T>(value: Embedded<T>): T[] => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * The contract that MATTERS on a quote, out of however many the embed carries.
 *
 * `embeddedOne` answers "the single related row" and was right while
 * `contracts.quote_id` was UNIQUE: there was only ever one, so the first was
 * the only. Migration 83 replaces that constraint with a partial unique index
 * so a withdrawn or declined contract stops holding the slot — and from the
 * moment it is APPLIED a quote may carry several, with `embeddedOne` returning
 * whichever PostgREST happened to put first.
 *
 * That order is unspecified. Without this, a quote whose withdrawn contract was
 * replaced could show the DEAD one on the job page, on the dashboard row, in
 * the "contract signed" check and in the Activity timeline — picked at random,
 * differing between two loads of the same page.
 *
 * At most one contract can be live at a time, which the partial index enforces,
 * so "the live one" is unambiguous whenever there is one. Where every contract
 * is withdrawn or declined there is no live one to prefer and the most recently
 * sent is the truthful answer — that is the one the customer last saw.
 */
export const currentContract = <
  T extends { status?: string | null; sent_at?: string | null },
>(
  value: Embedded<T>,
): T | null => {
  const rows = embeddedMany(value);
  if (rows.length <= 1) return rows[0] ?? null;

  const live = rows.filter(
    (row) => row.status !== "withdrawn" && row.status !== "declined",
  );
  // The partial unique index allows at most one live contract, so `live[0]` is
  // "the" live contract rather than an arbitrary pick among several.
  if (live.length > 0) return live[0] ?? null;

  // All dead: the most recently sent is what the customer last received. A row
  // without `sent_at` (a caller that did not select it) sorts last rather than
  // winning by accident.
  return [...rows].sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))[0] ?? null;
};

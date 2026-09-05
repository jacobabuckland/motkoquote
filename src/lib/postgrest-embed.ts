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

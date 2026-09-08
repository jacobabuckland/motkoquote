// What the statement of work prints in its "Site address" block.
//
// The fallback used to read "Same as customer address", which names a field
// that does not exist. `render-sow.ts` merges the ONE captured address —
// `customers.contact.address`, written from the quote editor's "Site address"
// input — into `site_address` before rendering, so there is no separate
// customer address for the site to be the same as. When this fallback fires,
// both are absent, and the document was asserting an equality between two
// things that are not there.
//
// A statement of work is the contractor's own record of what was agreed. It may
// say a thing was not captured; it may not quietly say something else was true.
export const siteAddressLine = (siteAddress?: string | null): string =>
  siteAddress?.trim() ? siteAddress : "Not captured";

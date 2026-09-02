// Whether a public artefact link (quote, contract, invoice) should still
// resolve for a customer holding it.
//
// Two things stop a link: the trade behind it has been erased, or the artefact
// itself was voided as part of that erasure (D6 — outstanding sendable
// artefacts are withdrawn, not orphaned). Either way the route calls
// notFound(), so the customer sees the same neutral "not available" page they
// would for a mistyped id. That is deliberate: the page must not disclose that
// an account was deleted, whose it was, or that Motko knows anything about it.
//
// Kept in one place because the three public routes have to agree. A link that
// stops resolving on two of them and keeps working on the third is the same bug
// as not fixing it at all.
export type PublicArtefactVisibility = {
  /** contractors.erased_at, via whatever join the route already makes. */
  erasedAt: string | null | undefined;
  /** The artefact's own status. "void" is written by the erasure path. */
  status: string | null | undefined;
};

export const isPubliclyUnavailable = ({ erasedAt, status }: PublicArtefactVisibility): boolean =>
  Boolean(erasedAt) || status === "void";

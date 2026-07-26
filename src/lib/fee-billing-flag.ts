// Whether the per-paid-job fee is actually being SHOWN to trades yet. The fee
// still accrues in the ledger on every paid job regardless of this flag — this
// gates only user-facing fee copy (e.g. the "£2 Motko fee applies" line in the
// mark-as-paid sheet), so we never surface a charge before fee billing is live.
// Off unless FEE_BILLING_ENABLED is explicitly "true".
export const isFeeBillingEnabled = (): boolean =>
  process.env.FEE_BILLING_ENABLED === "true";

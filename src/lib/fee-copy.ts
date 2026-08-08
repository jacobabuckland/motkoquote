// The single line of fee / free-jobs copy shown in the mark-as-paid sheet.
//
// Returns null whenever fee billing is off, so NO pricing or free-jobs language
// reaches an in-app surface before go-live. This is the App Store 3.1.2 guard:
// the reviewed build leaked "free jobs"/"£2 fee" copy while the flag was off.
// The fee still accrues in the ledger regardless of this flag — it gates copy
// only, never money.
export const markPaidFeeLine = (input: {
  feeBillingEnabled: boolean;
  freeJobsRemaining: number;
  quoteTotalPounds: number;
}): string | null => {
  if (!input.feeBillingEnabled) return null;
  if (input.freeJobsRemaining > 0) return "This is one of your free jobs — no fee.";
  const band = input.quoteTotalPounds <= 1000 ? 2 : 4;
  return `A £${band} Motko fee applies, collected monthly.`;
};

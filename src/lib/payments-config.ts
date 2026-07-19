// Central config for the platform's cut of a destination charge.
//
// Payments are destination charges: the customer's money settles to the
// tradesperson's connected account. This returns the application fee (in pence)
// the platform keeps from each payment. Set to 0 for now — the plumbing is in
// place so a future rate change is a one-line edit here. An optional
// PLATFORM_APPLICATION_FEE_PENCE env var overrides the default without a deploy.
//
// A fee of 0 means we omit application_fee_amount entirely (Stripe rejects an
// explicit 0), so callers should treat 0 as "no fee".
export const getApplicationFeeAmountPence = (): number => {
  const configured = Number(process.env.PLATFORM_APPLICATION_FEE_PENCE ?? 0);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 0;
};

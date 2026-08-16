"use server";

// DEPRECATED: VRP mandate creation removed (PAY-5). Fees are now collected at
// source via Stripe application fees, so mandate setup is no longer needed.

export const startFeeMandate = async (): Promise<
  { hostedPageUrl: string } | { error: string }
> => {
  // STUB: Fee billing via VRP mandates has been replaced by Stripe application
  // fees collected at source (PAY-4). This function is retained for backwards
  // compatibility with the fee billing UI, but always returns an error.
  return { error: "Fee billing isn't available yet." };
};

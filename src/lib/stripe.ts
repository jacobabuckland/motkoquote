import Stripe from "stripe";
import { getApplicationFeeAmountPence } from "@/lib/payments-config";

export const getStripeClient = (): Stripe | null => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) return null;
  return new Stripe(apiKey);
};

// ---------------------------------------------------------------------------
// Stripe Connect Express — tradesperson payout onboarding.
//
// We create an Express connected account per tradesperson and send them to
// Stripe's hosted onboarding. We never collect or store bank details — Stripe
// does. We persist only the account id and the status flags Stripe reports.
// ---------------------------------------------------------------------------

export type ConnectAccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  // requirements.currently_due non-empty — Stripe needs more info to keep the
  // account enabled. Drives the "Finish payout setup" banner.
  requirementsDue: boolean;
};

const accountStatus = (account: Stripe.Account): ConnectAccountStatus => ({
  chargesEnabled: account.charges_enabled,
  payoutsEnabled: account.payouts_enabled,
  requirementsDue: (account.requirements?.currently_due?.length ?? 0) > 0,
});

// Creates a GB Express account requesting the card_payments + transfers
// capabilities needed to receive destination charges and be paid out.
export const createConnectAccount = async (
  email: string | undefined,
): Promise<string | null> => {
  const stripe = getStripeClient();
  if (!stripe) return null;
  try {
    const account = await stripe.accounts.create({
      type: "express",
      country: "GB",
      email: email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    return account.id;
  } catch (error) {
    // Most commonly: Connect isn't enabled on the platform account, or a
    // live/test key mismatch. Log the real cause and degrade to null so the
    // caller shows a friendly message instead of a 500.
    console.error("createConnectAccount failed:", error);
    return null;
  }
};

// Hosted onboarding link. refresh_url is hit if the link expires before the
// tradesperson finishes; return_url is where Stripe sends them back to us.
export const createOnboardingLink = async (input: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<string | null> => {
  const stripe = getStripeClient();
  if (!stripe) return null;
  try {
    const link = await stripe.accountLinks.create({
      account: input.accountId,
      type: "account_onboarding",
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
    });
    return link.url;
  } catch (error) {
    console.error("createOnboardingLink failed:", error);
    return null;
  }
};

// One-time link into the tradesperson's Stripe Express dashboard so they can
// view their payouts. Only works once the account has completed onboarding.
export const createExpressDashboardLink = async (
  accountId: string,
): Promise<string | null> => {
  const stripe = getStripeClient();
  if (!stripe) return null;
  try {
    const link = await stripe.accounts.createLoginLink(accountId);
    return link.url;
  } catch (error) {
    console.error("createExpressDashboardLink failed:", error);
    return null;
  }
};

export const retrieveConnectStatus = async (
  accountId: string,
): Promise<ConnectAccountStatus | null> => {
  const stripe = getStripeClient();
  if (!stripe) return null;
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return accountStatus(account);
  } catch (error) {
    console.error("retrieveConnectStatus failed:", error);
    return null;
  }
};

type CreatePaymentLinkInput = {
  companyName: string;
  description: string;
  amount: number;
  invoiceId: string;
  // The quote owner's connected account id. Payments are destination charges:
  // funds settle to this account, with the tradesperson as merchant of record
  // (on_behalf_of) so Stripe's hosted receipt shows their business name.
  connectedAccountId: string;
  // Deterministic key derived from the invoice's stable identity. Passed to
  // Stripe so a retried or double-fired create can never mint a second
  // product, price, or payment link — Stripe returns the original objects.
  idempotencyKey?: string;
};

// Stripe "pay_by_bank" (UK open banking) is GBP-only and supported for one-off
// payments between £0.50 and £10,000. Outside that range — or a non-GBP
// currency — we quietly fall back to card so the link never errors on an
// ineligible amount. When eligible we list pay_by_bank alongside card.
const PAY_BY_BANK_MIN_GBP = 0.5;
const PAY_BY_BANK_MAX_GBP = 10000;

const paymentMethodTypesFor = (
  amount: number,
  currency: string,
): Stripe.PaymentLinkCreateParams.PaymentMethodType[] => {
  const payByBankEligible =
    currency === "gbp" &&
    amount >= PAY_BY_BANK_MIN_GBP &&
    amount <= PAY_BY_BANK_MAX_GBP;
  return payByBankEligible ? ["pay_by_bank", "card"] : ["card"];
};

export const createInvoicePaymentLink = async (
  input: CreatePaymentLinkInput,
): Promise<{ id: string; url: string } | null> => {
  const stripe = getStripeClient();
  if (!stripe) return null;

  // Each Stripe create call is keyed on the same base so a double-fire
  // resolves to the original object. Keys are namespaced per endpoint by
  // Stripe, so suffixing keeps product/price/link distinct while stable.
  const key = input.idempotencyKey;

  const product = await stripe.products.create(
    { name: `${input.companyName} — ${input.description}` },
    key ? { idempotencyKey: `${key}_product` } : undefined,
  );

  const price = await stripe.prices.create(
    {
      product: product.id,
      unit_amount: Math.round(input.amount * 100),
      currency: "gbp",
    },
    key ? { idempotencyKey: `${key}_price` } : undefined,
  );

  // Destination charge: the payment settles to the tradesperson's connected
  // account. on_behalf_of makes them the merchant of record so Stripe's hosted
  // receipt shows their business name as the payee. The application fee (the
  // platform's cut) is omitted entirely when 0 — Stripe rejects an explicit 0.
  const applicationFee = getApplicationFeeAmountPence();

  const link = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      payment_method_types: paymentMethodTypesFor(input.amount, "gbp"),
      metadata: { invoice_id: input.invoiceId },
      on_behalf_of: input.connectedAccountId,
      transfer_data: { destination: input.connectedAccountId },
      ...(applicationFee > 0 ? { application_fee_amount: applicationFee } : {}),
      // Mirror invoice_id onto the PaymentIntent so a later refund (whose
      // webhook carries the charge/PI, not the payment link) still maps back
      // to the invoice.
      payment_intent_data: { metadata: { invoice_id: input.invoiceId } },
      after_completion: {
        type: "redirect",
        redirect: { url: `${process.env.NEXT_PUBLIC_APP_URL}/i/${input.invoiceId}/paid` },
      },
    },
    key ? { idempotencyKey: `${key}_link` } : undefined,
  );

  return { id: link.id, url: link.url };
};

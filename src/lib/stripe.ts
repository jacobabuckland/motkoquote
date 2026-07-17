import Stripe from "stripe";

export const getStripeClient = (): Stripe | null => {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) return null;
  return new Stripe(apiKey);
};

type CreatePaymentLinkInput = {
  companyName: string;
  description: string;
  amount: number;
  invoiceId: string;
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

  const product = await stripe.products.create({
    name: `${input.companyName} — ${input.description}`,
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(input.amount * 100),
    currency: "gbp",
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    payment_method_types: paymentMethodTypesFor(input.amount, "gbp"),
    metadata: { invoice_id: input.invoiceId },
    after_completion: {
      type: "redirect",
      redirect: { url: `${process.env.NEXT_PUBLIC_APP_URL}/i/${input.invoiceId}/paid` },
    },
  });

  return { id: link.id, url: link.url };
};

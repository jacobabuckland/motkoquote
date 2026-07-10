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
    metadata: { invoice_id: input.invoiceId },
    after_completion: {
      type: "redirect",
      redirect: { url: `${process.env.NEXT_PUBLIC_APP_URL}/i/${input.invoiceId}/paid` },
    },
  });

  return { id: link.id, url: link.url };
};

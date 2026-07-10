import { Resend } from "resend";

type SendQuoteEmailInput = {
  to: string;
  customerName: string;
  companyName: string;
  quoteUrl: string;
  total: number;
};

export const sendQuoteEmail = async (
  input: SendQuoteEmailInput,
): Promise<{ delivered: boolean }> => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // No Resend key configured — caller falls back to a copyable link.
    return { delivered: false };
  }

  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: "quotes@tradequote.app",
    to: input.to,
    subject: `Your quote from ${input.companyName}`,
    html: `
      <p>Hi ${input.customerName},</p>
      <p>${input.companyName} has sent you a quote for £${input.total.toFixed(2)}.</p>
      <p><a href="${input.quoteUrl}">View your quote</a></p>
    `,
  });

  return { delivered: true };
};

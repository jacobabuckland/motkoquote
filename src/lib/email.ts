import { Resend } from "resend";

type SendQuoteEmailInput = {
  to: string;
  customerName: string;
  companyName: string;
  quoteUrl: string;
  total: number;
  pdfAttachment?: { filename: string; content: Buffer };
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

  const { error } = await resend.emails.send({
    from: "quotes@motko.app",
    to: input.to,
    subject: `Your quote from ${input.companyName}`,
    html: `
      <p>Hi ${input.customerName},</p>
      <p>${input.companyName} has sent you a quote for £${input.total.toFixed(2)}.</p>
      <p><a href="${input.quoteUrl}">View your quote</a></p>
    `,
    attachments: input.pdfAttachment
      ? [{ filename: input.pdfAttachment.filename, content: input.pdfAttachment.content }]
      : undefined,
  });

  if (error) {
    console.error("sendQuoteEmail failed:", error);
    return { delivered: false };
  }

  return { delivered: true };
};

type SendInvoiceEmailInput = {
  to: string;
  customerName: string;
  companyName: string;
  amount: number;
  invoiceType: "deposit" | "final";
  paymentUrl: string | null;
};

export const sendInvoiceEmail = async (
  input: SendInvoiceEmailInput,
): Promise<{ delivered: boolean }> => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { delivered: false };
  }

  const resend = new Resend(apiKey);
  const label = input.invoiceType === "deposit" ? "a deposit invoice" : "an invoice";

  const { error } = await resend.emails.send({
    from: "quotes@motko.app",
    to: input.to,
    subject: `${input.invoiceType === "deposit" ? "Deposit invoice" : "Invoice"} from ${input.companyName}`,
    html: `
      <p>Hi ${input.customerName},</p>
      <p>${input.companyName} has sent you ${label} for £${input.amount.toFixed(2)}.</p>
      ${
        input.paymentUrl
          ? `<p><a href="${input.paymentUrl}">Pay now</a></p>`
          : `<p>They'll be in touch with a way to pay.</p>`
      }
    `,
  });

  if (error) {
    console.error("sendInvoiceEmail failed:", error);
    return { delivered: false };
  }

  return { delivered: true };
};

type SendContractEmailInput = {
  to: string;
  customerName: string;
  companyName: string;
  contractUrl: string;
  pdfAttachment?: { filename: string; content: Buffer };
};

export const sendContractEmail = async (
  input: SendContractEmailInput,
): Promise<{ delivered: boolean }> => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { delivered: false };
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "quotes@motko.app",
    to: input.to,
    subject: `Contract to sign from ${input.companyName}`,
    html: `
      <p>Hi ${input.customerName},</p>
      <p>${input.companyName} has sent you a contract to review and sign.</p>
      <p><a href="${input.contractUrl}">View and sign contract</a></p>
    `,
    attachments: input.pdfAttachment
      ? [{ filename: input.pdfAttachment.filename, content: input.pdfAttachment.content }]
      : undefined,
  });

  if (error) {
    console.error("sendContractEmail failed:", error);
    return { delivered: false };
  }

  return { delivered: true };
};

type SendChaseEmailInput = {
  to: string;
  companyName: string;
  body: string;
  paymentUrl: string | null;
};

export const sendChaseEmail = async (
  input: SendChaseEmailInput,
): Promise<{ delivered: boolean }> => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { delivered: false };
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "quotes@motko.app",
    to: input.to,
    subject: `Payment reminder — ${input.companyName}`,
    html: `
      <p>${input.body.replace(/\n/g, "<br/>")}</p>
      ${input.paymentUrl ? `<p><a href="${input.paymentUrl}">Pay now</a></p>` : ""}
    `,
  });

  if (error) {
    console.error("sendChaseEmail failed:", error);
    return { delivered: false };
  }

  return { delivered: true };
};

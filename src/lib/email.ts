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

type ContractorNotificationInput = {
  to: string;
  subject: string;
  // What the customer just did, e.g. "Dave accepted your quote."
  heading: string;
  // The one thing to do next, in plain English, e.g. "Next step: send them a
  // contract to sign." — every customer-triggered notification ends on this so
  // the contractor is never left wondering whose move it is.
  nextStep: string;
  // Deep-links straight to the job hub so the next step is one tap away.
  jobUrl: string;
  buttonLabel?: string;
};

export const sendContractorNotificationEmail = async (
  input: ContractorNotificationInput,
): Promise<{ delivered: boolean }> => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { delivered: false };
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "quotes@motko.app",
    to: input.to,
    subject: input.subject,
    html: `
      <p>${input.heading}</p>
      <p>${input.nextStep}</p>
      <p><a href="${input.jobUrl}">${input.buttonLabel ?? "Open the job"}</a></p>
    `,
  });

  if (error) {
    console.error("sendContractorNotificationEmail failed:", error);
    return { delivered: false };
  }

  return { delivered: true };
};

type AccountDeletionInput = {
  to: string;
  // When the 30-day grace period ends and personal data is purged.
  purgeDate: string;
};

// Confirms a deletion request and states the grace period, so a contractor who
// changes their mind (or didn't request it) knows they can sign back in and
// keep their account before the purge date.
export const sendAccountDeletionEmail = async (
  input: AccountDeletionInput,
): Promise<{ delivered: boolean }> => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { delivered: false };
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "quotes@motko.app",
    to: input.to,
    subject: "Your Motko account is scheduled for deletion",
    html: `
      <p>We've received a request to delete your Motko account.</p>
      <p>Your personal data will be permanently removed on <strong>${input.purgeDate}</strong>.
      Issued invoices and contracts are kept in anonymised form to meet legal and tax record-keeping requirements.</p>
      <p>Changed your mind? Sign back in before that date and choose "Keep my account" to cancel the deletion.</p>
    `,
  });

  if (error) {
    console.error("sendAccountDeletionEmail failed:", error);
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

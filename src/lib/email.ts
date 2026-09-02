import { Resend } from "resend";
import { formatGBP } from "@/lib/format";
import { formatMessageAmount } from "@/lib/money-label";
import { escapeHtml } from "@/lib/escape-html";
import { chaseEmailLinkLabel } from "@/lib/chase-cta";

// Quiet maker's mark for the bottom of customer-facing emails (the invoice is
// the one customer document with no branded web/PDF surface of its own).
// Small, muted, centred, generous spacing above — a maker's mark, not an ad.
const MADE_WITH_MOTKO_EMAIL_FOOTER = `<p style="margin-top:32px;text-align:center;font-size:12px;color:#9ca3af;">made with <a href="https://motko.app?utm_source=document&amp;utm_medium=footer&amp;utm_campaign=viral" style="color:#9ca3af;text-decoration:underline;">motko</a></p>`;

/**
 * Removes control characters and normalizes whitespace in email subject lines.
 * This prevents mail header injection and cleans up doubled spaces or line breaks
 * that may appear in user-entered company names.
 */
export const sanitizeEmailSubject = (input: string): string => {
  return (
    input
      // Remove all control characters (CR, LF, tab, and other control characters)
      .replace(/[\p{Cc}]/gu, "")
      // Collapse runs of whitespace (spaces, non-breaking spaces, etc.) to a single space
      .replace(/\s+/g, " ")
      // Trim leading and trailing whitespace
      .trim()
  );
};

type SendQuoteEmailInput = {
  to: string;
  customerName: string;
  companyName: string;
  quoteUrl: string;
  total: number;
  // Whether the figure carries VAT, so the body can say so. `total` is the
  // VAT-inclusive figure either way; this only decides the label.
  //
  // Optional, and absence means NO label. Under-labelling is the safe
  // direction: a bare figure is ambiguous, but "inc. VAT" on a non-registered
  // trade's quote is a false statement about what the customer owes. It also
  // keeps every existing caller valid — tests/acceptance/175.test.ts is frozen
  // and may not be edited to accommodate a signature change (AGENTS.md).
  vatRegistered?: boolean;
};

// The quote email carries no PDF attachment: acceptance happens on the tracked
// /q/ page (where the PDF stays downloadable), so the email is a short summary
// with one prominent "View and accept your quote" button that drives the
// customer to that page rather than a dead-end file they can't act on.
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
    subject: `Your quote from ${sanitizeEmailSubject(input.companyName)}`,
    html: `
      <p>Hi ${escapeHtml(input.customerName)},</p>
      <p>${escapeHtml(input.companyName)} has sent you a quote for ${formatMessageAmount(input.total, input.vatRegistered)}.</p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(input.quoteUrl)}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">View and accept your quote</a>
      </p>
    `,
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
    subject: `${input.invoiceType === "deposit" ? "Deposit invoice" : "Invoice"} from ${sanitizeEmailSubject(input.companyName)}`,
    html: `
      <p>Hi ${escapeHtml(input.customerName)},</p>
      <p>${escapeHtml(input.companyName)} has sent you ${label} for ${formatGBP(input.amount)}.</p>
      ${
        input.paymentUrl
          ? `<p><a href="${escapeHtml(input.paymentUrl)}">Pay now</a></p>`
          : `<p>They'll be in touch with a way to pay.</p>`
      }
      ${MADE_WITH_MOTKO_EMAIL_FOOTER}
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
    subject: `Contract to sign from ${sanitizeEmailSubject(input.companyName)}`,
    html: `
      <p>Hi ${escapeHtml(input.customerName)},</p>
      <p>${escapeHtml(input.companyName)} has sent you a contract to review and sign.</p>
      <p><a href="${escapeHtml(input.contractUrl)}">View and sign contract</a></p>
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
      <p>${escapeHtml(input.heading)}</p>
      <p>${escapeHtml(input.nextStep)}</p>
      <p><a href="${escapeHtml(input.jobUrl)}">${escapeHtml(input.buttonLabel ?? "Open the job")}</a></p>
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
};

// Confirms an erasure that has already happened. There is no grace period and
// no restore, so this email cannot offer either — it says what was removed,
// what is retained and why, and that starting again means a new account. Sent
// immediately BEFORE the erasure runs, because afterwards there is no address
// left to send it to.
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
    subject: "Your Motko account has been deleted",
    html: `
      <p>Your Motko account has been deleted, along with your business profile, your voice
      recordings and transcripts, your draft quotes, your uploaded logo and receipts, and your
      sign-in details. This cannot be undone.</p>
      <p>Issued invoices and signed contracts are kept in anonymised form to meet legal and tax
      record-keeping requirements. They no longer carry your name or your business details.</p>
      <p>If you'd like to use Motko again, you're welcome to sign up from scratch with this
      address or any other.</p>
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
  // Whether the one-tap pay-by-bank rails are live. Drives the link wording only
  // (the URL is unchanged): "Pay now" when true, "View invoice" when the manual
  // bank-transfer fallback is what the page shows.
  payEnabled: boolean;
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
    subject: `Payment reminder — ${sanitizeEmailSubject(input.companyName)}`,
    html: `
      <p>${escapeHtml(input.body).replace(/\n/g, "<br/>")}</p>
      ${input.paymentUrl ? `<p><a href="${escapeHtml(input.paymentUrl)}">${chaseEmailLinkLabel(input.payEnabled)}</a></p>` : ""}
    `,
  });

  if (error) {
    console.error("sendChaseEmail failed:", error);
    return { delivered: false };
  }

  return { delivered: true };
};

// Where support mail lands. One inbox, named once.
export const SUPPORT_INBOX = "hello@motko.app";

type SendSupportEmailInput = {
  subject: string;
  message: string;
  // From the session, never from the form — see the schema.
  fromEmail: string;
  companyName: string;
  contractorId: string | null;
};

/**
 * A contractor's support message, delivered to the support inbox.
 *
 * Two things are load-bearing rather than decorative.
 *
 * `replyTo` is the contractor's own address, so answering the mail answers the
 * person. Without it every reply goes to the sending domain and someone has to
 * copy the address out of the body by hand — which is how a support inbox
 * quietly stops being used.
 *
 * The identity block is composed here from session values rather than from the
 * form. A support request that says who it is from is worth several rounds of
 * "which account is this?", and a form field claiming to be a contractor id is
 * worth nothing at all.
 */
export const sendSupportEmail = async (
  input: SendSupportEmailInput,
): Promise<{ delivered: boolean }> => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Same contract as every other sender here: no key, no delivery, and the
    // caller says so rather than pretending it sent.
    return { delivered: false };
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "hello@motko.app",
    to: SUPPORT_INBOX,
    replyTo: input.fromEmail,
    subject: `Support — ${sanitizeEmailSubject(input.subject)}`,
    html: `
      <p style="white-space:pre-wrap;">${escapeHtml(input.message)}</p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="font-size:12px;color:#6b7280;">
        From ${escapeHtml(input.companyName)} &lt;${escapeHtml(input.fromEmail)}&gt;<br/>
        Contractor: ${escapeHtml(input.contractorId ?? "none on record")}
      </p>
    `,
  });

  if (error) {
    console.error("sendSupportEmail failed:", error);
    return { delivered: false };
  }

  return { delivered: true };
};

import { sendQuoteEmail, sendInvoiceEmail, sendContractEmail } from "@/lib/email";
import { sendQuoteSms, sendContractSms, sendInvoiceSms } from "@/lib/sms";
import { normalizeUkPhone } from "@/lib/phone";
import { withTimeout, TIMEOUT_MS } from "@/lib/with-timeout";
import { logError } from "@/lib/analytics";

// One dispatcher for every customer-facing lifecycle send.
//
// Before this, each send site did its own thing inline and only one of them
// did SMS. The quote send was a 60-line harness with per-channel timeouts and
// independent error logging; the contract send was `if (email) { … }`; the
// invoice send was the same again. None of that rigour was reusable, so none
// of it reached the other two.
//
// The cost was not stylistic. `customers.contact.sms_opt_out` is a regulatory
// signal — written when a quote is sent and by the inbound Twilio STOP handler
// — and it was honoured at two of the five customer-facing sends. The other
// two could not honour it because they had no SMS path to gate: a customer who
// gave a phone number and no email got the quote and then silence, with the
// contract that needed their signature and the invoice that needed their money
// sent to an address they do not have. customerInputSchema explicitly permits
// that customer.
//
// A per-site patch would have been three copies of the logic below and would
// regress the moment a sixth lifecycle step is added — `contract_signed` and
// `payment_received` do not exist yet, and under a per-site regime each would
// be written from scratch and each free to forget the opt-out.
//
// This owns channel eligibility, phone normalisation, per-channel timeouts,
// per-channel error logging, and the delivery report. It does NOT own status
// transitions: whether a record flips to "sent" is the caller's business, and
// keeping that at the call site is what lets the quote path mark itself sent on
// first delivery while the contract path marks itself sent regardless.

export type LifecycleEvent =
  | "quote_sent"
  | "contract_sent"
  | "invoice_sent"
  // Declared so the type is complete and a future implementer sees the shape
  // they are joining. NO send site exists for either — adding one is a product
  // decision about what a customer should receive, not a refactor.
  | "contract_signed"
  | "payment_received";

export type ChannelOutcome = { attempted: boolean; delivered: boolean };

export type DeliveryReport = {
  delivered: boolean;
  email: ChannelOutcome;
  sms: ChannelOutcome;
};

export type NotifyCustomerInput = {
  event: LifecycleEvent;
  customer: {
    name: string;
    email?: string;
    phone?: string;
    smsOptOut: boolean;
  };
  companyName: string;
  // The customer-facing link for this step: /q/…, /c/… or /i/….
  url: string;
  amount?: number;
  // Whether `amount` carries VAT. Owned by the dispatcher because it owns every
  // other per-channel detail — eligibility, phone normalisation, timeouts — and
  // a per-site copy is how the opt-out ended up honoured at two sends out of
  // five (see the note at the top of this file).
  vatRegistered?: boolean;
  invoiceType?: "deposit" | "final";
  pdfAttachment?: { filename: string; content: Buffer };
  // Defaults to "whatever contact details exist", so a caller that does not
  // offer the contractor a choice does not have to invent one.
  channels?: { email: boolean; sms: boolean };
};

const NOT_ATTEMPTED: ChannelOutcome = { attempted: false, delivered: false };

const emailFor = async (input: NotifyCustomerInput, to: string): Promise<{ delivered: boolean }> => {
  switch (input.event) {
    case "quote_sent":
      return sendQuoteEmail({
        to,
        customerName: input.customer.name,
        companyName: input.companyName,
        quoteUrl: input.url,
        total: input.amount ?? 0,
        vatRegistered: input.vatRegistered ?? false,
      });
    case "contract_sent":
      return sendContractEmail({
        to,
        customerName: input.customer.name,
        companyName: input.companyName,
        contractUrl: input.url,
        pdfAttachment: input.pdfAttachment,
      });
    case "invoice_sent":
      return sendInvoiceEmail({
        to,
        customerName: input.customer.name,
        companyName: input.companyName,
        amount: input.amount ?? 0,
        invoiceType: input.invoiceType ?? "final",
        paymentUrl: input.url,
      });
    default:
      // No send site exists for the remaining events; reaching here is a
      // programming error, not a delivery failure.
      throw new Error(`notifyCustomer: no email defined for event ${input.event}`);
  }
};

const smsFor = async (input: NotifyCustomerInput, to: string): Promise<{ delivered: boolean }> => {
  switch (input.event) {
    case "quote_sent":
      return sendQuoteSms({
        to,
        companyName: input.companyName,
        total: input.amount ?? 0,
        vatRegistered: input.vatRegistered ?? false,
        quoteUrl: input.url,
      });
    case "contract_sent":
      return sendContractSms({
        to,
        companyName: input.companyName,
        contractUrl: input.url,
      });
    case "invoice_sent":
      return sendInvoiceSms({
        to,
        companyName: input.companyName,
        amount: input.amount ?? 0,
        invoiceType: input.invoiceType ?? "final",
        paymentUrl: input.url,
      });
    default:
      throw new Error(`notifyCustomer: no SMS defined for event ${input.event}`);
  }
};

export const notifyCustomer = async (
  input: NotifyCustomerInput,
): Promise<DeliveryReport> => {
  const channels = input.channels ?? { email: true, sms: true };
  const normalizedPhone = input.customer.phone ? normalizeUkPhone(input.customer.phone) : null;

  const emailAttempted = channels.email && Boolean(input.customer.email);
  // The opt-out is checked HERE, once, for every lifecycle event — which is the
  // whole point of the dispatcher existing.
  const smsAttempted =
    channels.sms && Boolean(normalizedPhone) && !input.customer.smsOptOut;

  // Each channel is bounded so a hanging Resend or Twilio call cannot wedge the
  // send, and each fails independently: a missing or failed email must never
  // block SMS, and vice versa.
  const runEmail = async (): Promise<ChannelOutcome> => {
    if (!emailAttempted) return NOT_ATTEMPTED;
    try {
      const result = await withTimeout(
        emailFor(input, input.customer.email as string),
        TIMEOUT_MS.email,
        `notifyCustomer:${input.event}:email`,
      );
      return { attempted: true, delivered: result.delivered };
    } catch (err) {
      await logError("server", `notifyCustomer ${input.event} email failed`, {
        detail: err instanceof Error ? err.message : String(err),
      });
      return { attempted: true, delivered: false };
    }
  };

  const runSms = async (): Promise<ChannelOutcome> => {
    if (!smsAttempted) return NOT_ATTEMPTED;
    try {
      const result = await withTimeout(
        smsFor(input, normalizedPhone as string),
        TIMEOUT_MS.sms,
        `notifyCustomer:${input.event}:sms`,
      );
      return { attempted: true, delivered: result.delivered };
    } catch (err) {
      await logError("server", `notifyCustomer ${input.event} sms failed`, {
        detail: err instanceof Error ? err.message : String(err),
      });
      return { attempted: true, delivered: false };
    }
  };

  const [email, sms] = await Promise.all([runEmail(), runSms()]);

  return { delivered: email.delivered || sms.delivered, email, sms };
};

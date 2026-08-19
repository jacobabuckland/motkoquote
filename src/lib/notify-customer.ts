import { sendQuoteEmail, sendContractEmail, sendInvoiceEmail } from "@/lib/email";
import { sendQuoteSms, sendContractSms, sendInvoiceSms } from "@/lib/sms";
import { normalizeUkPhone } from "@/lib/phone";
import { withTimeout, TIMEOUT_MS } from "@/lib/with-timeout";
import { logError } from "@/lib/analytics";

export type LifecycleEvent =
  | "quote_sent"
  | "contract_sent"
  | "invoice_sent"
  | "contract_signed"
  | "payment_received";

type CustomerContact = {
  name: string;
  email?: string;
  phone?: string;
  smsOptOut?: boolean;
};

type NotifyCustomerInput = {
  event: LifecycleEvent;
  customer: CustomerContact;
  companyName: string;
  url: string;
  channels: { email: boolean; sms: boolean };
  // Quote-specific
  total?: number;
  // Invoice-specific
  amount?: number;
  invoiceType?: "deposit" | "final";
  // Contract-specific (email only)
  emailExtras?: {
    pdfAttachment?: { filename: string; content: Buffer };
  };
};

type DeliveryReport = {
  delivered: boolean;
  email: { attempted: boolean; delivered: boolean };
  sms: { attempted: boolean; delivered: boolean };
};

export const notifyCustomer = async (input: NotifyCustomerInput): Promise<DeliveryReport> => {
  const { event, customer, companyName, url, channels, emailExtras } = input;

  // Phone normalization — attempt it once, treat failure as no phone
  const normalizedPhone = customer.phone ? normalizeUkPhone(customer.phone) : null;
  if (customer.phone && !normalizedPhone) {
    await logError("server", "Phone normalization failed", {
      event,
      phone: customer.phone,
    });
  }

  // Channel eligibility
  const emailEligible = channels.email && Boolean(customer.email);
  const smsEligible = channels.sms && Boolean(normalizedPhone) && !customer.smsOptOut;

  // Per-channel sender functions
  const sendEmail = async (): Promise<{ delivered: boolean }> => {
    if (!emailEligible) return { delivered: false };
    try {
      let result: { delivered: boolean };
      if (event === "quote_sent") {
        if (!input.total) throw new Error("total required for quote_sent");
        result = await withTimeout(
          sendQuoteEmail({
            to: customer.email!,
            customerName: customer.name,
            companyName,
            quoteUrl: url,
            total: input.total,
          }),
          TIMEOUT_MS.email,
          "sendQuoteEmail",
        );
      } else if (event === "contract_sent") {
        result = await withTimeout(
          sendContractEmail({
            to: customer.email!,
            customerName: customer.name,
            companyName,
            contractUrl: url,
            pdfAttachment: emailExtras?.pdfAttachment,
          }),
          TIMEOUT_MS.email,
          "sendContractEmail",
        );
      } else if (event === "invoice_sent") {
        if (!input.amount) throw new Error("amount required for invoice_sent");
        if (!input.invoiceType) throw new Error("invoiceType required for invoice_sent");
        result = await withTimeout(
          sendInvoiceEmail({
            to: customer.email!,
            customerName: customer.name,
            companyName,
            amount: input.amount,
            invoiceType: input.invoiceType,
            paymentUrl: url,
          }),
          TIMEOUT_MS.email,
          "sendInvoiceEmail",
        );
      } else {
        // contract_signed, payment_received — declared but not implemented
        return { delivered: false };
      }
      return result;
    } catch (err) {
      await logError("server", `${event} email failed`, {
        detail: err instanceof Error ? err.message : String(err),
      });
      return { delivered: false };
    }
  };

  const sendSms = async (): Promise<{ delivered: boolean }> => {
    if (!smsEligible) return { delivered: false };
    try {
      let result: { delivered: boolean };
      if (event === "quote_sent") {
        if (!input.total) throw new Error("total required for quote_sent");
        result = await withTimeout(
          sendQuoteSms({
            to: normalizedPhone!,
            companyName,
            total: input.total,
            quoteUrl: url,
          }),
          TIMEOUT_MS.sms,
          "sendQuoteSms",
        );
      } else if (event === "contract_sent") {
        result = await withTimeout(
          sendContractSms({
            to: normalizedPhone!,
            customerName: customer.name,
            companyName,
            contractUrl: url,
          }),
          TIMEOUT_MS.sms,
          "sendContractSms",
        );
      } else if (event === "invoice_sent") {
        if (!input.amount) throw new Error("amount required for invoice_sent");
        if (!input.invoiceType) throw new Error("invoiceType required for invoice_sent");
        result = await withTimeout(
          sendInvoiceSms({
            to: normalizedPhone!,
            customerName: customer.name,
            companyName,
            amount: input.amount,
            invoiceType: input.invoiceType,
            paymentUrl: url,
          }),
          TIMEOUT_MS.sms,
          "sendInvoiceSms",
        );
      } else {
        // contract_signed, payment_received — declared but not implemented
        return { delivered: false };
      }
      return result;
    } catch (err) {
      await logError("server", `${event} sms failed`, {
        detail: err instanceof Error ? err.message : String(err),
      });
      return { delivered: false };
    }
  };

  // Promise.all ensures channels are independent — one doesn't block the other
  const [emailResult, smsResult] = await Promise.all([sendEmail(), sendSms()]);

  return {
    delivered: emailResult.delivered || smsResult.delivered,
    email: { attempted: emailEligible, delivered: emailResult.delivered },
    sms: { attempted: smsEligible, delivered: smsResult.delivered },
  };
};

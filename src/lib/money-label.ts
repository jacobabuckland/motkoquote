import { formatGBP } from "@/lib/format";

// How a money figure reads in an outbound message.
//
// `quotes.total` is VAT-inclusive — computeQuoteTotals returns subtotal + vat —
// and the SMS and the email were the only two surfaces that printed it with no
// indication of that. Every document surface (the public quote page, the PDF,
// the contract variables, the editor) shows subtotal, VAT and total separately,
// so the figure is unambiguous there. In a one-line message it is not.
//
// That matters in opposite directions depending on who is reading. For a
// consumer the VAT-inclusive figure is the one that counts and they will assume
// it; for a business customer it is the one that does not, and they will assume
// the opposite. The first number a customer sees for a job should not be
// ambiguous to exactly the degree that their VAT status makes it matter.
//
// Deliberately just a label. The figure is `quotes.total` unchanged — a second
// computation here would be a second thing that can drift.

export const formatMessageAmount = (
  pounds: number,
  vatRegistered: boolean | undefined,
): string => {
  const figure = formatGBP(pounds);
  // A £0 quote is a real case — a goodwill callout, a warranty visit (see
  // ZERO_TOTAL_CONFIRM_REQUIRED). "£0.00 inc. VAT" is worse than "£0.00": there
  // is no VAT on nothing, and the qualifier reads as a mistake.
  if (!vatRegistered || pounds === 0) return figure;
  return `${figure} inc. VAT`;
};

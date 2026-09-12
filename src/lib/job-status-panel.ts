import type { NextMove, Situation } from "@/lib/job-stages";

/**
 * The one place a job says what is happening.
 *
 * It replaces three: a green "sent" banner, a status chip floated beside the
 * total, and a "Next step" card with an eyebrow and a pill. One fact told
 * three times reads as noise, not reassurance — so the chip moves inside this
 * panel, the banner's message becomes this panel's headline when there is one,
 * and the controls that used to sit under the third telling become an actions
 * card of their own.
 *
 * THE COPY IS NOT NEW. The headlines are the strings the "Next step" card
 * carried, moved rather than rewritten — they were already reviewed and they
 * already said the right thing. What is new is where they are and the fact
 * that a detail line sits under them.
 */
export type StatusPanelTone = "amber" | "neutral" | "green" | "red";

export type StatusPanel = {
  tone: StatusPanelTone;
  headline: string;
  detail: string | null;
};

/**
 * Tone follows WHOSE MOVE IT IS, which is the product's colour rule and not a
 * per-screen choice: amber means the contractor owes an action and nothing
 * else in the product is amber. A job waiting on a customer is deliberately
 * quiet — the contractor is scanning for what they have to do, and a screen
 * that shouts about things they cannot act on teaches them to ignore it.
 */
const toneFor = (situation: Situation, move: NextMove): StatusPanelTone => {
  if (situation === "quote_declined" || situation === "contract_declined") return "red";
  if (situation === "paid") return "green";
  if (situation === "invoice_overdue") return "amber";
  return move === "contractor" ? "amber" : "neutral";
};

const headlineFor = (situation: Situation, firstName: string): string => {
  switch (situation) {
    case "draft_quote":
      return "Finish and send this quote";
    case "quote_sent":
      return `Waiting on ${firstName} to accept the quote`;
    case "quote_declined":
      return `${firstName} declined the quote`;
    case "accepted_need_contract":
      return "Send a contract to sign";
    case "contract_sent":
      return `Waiting on ${firstName} to sign the contract`;
    case "contract_declined":
      return `${firstName} declined the contract`;
    case "work_complete":
      return "Mark the work complete, then invoice";
    case "signed_need_invoice":
      return "Raise an invoice to get paid";
    case "invoice_unpaid":
      return `Waiting on ${firstName} to pay`;
    case "invoice_overdue":
      return "Payment is overdue";
    case "paid":
      return "Job complete — you've been paid";
  }
};

/**
 * One line under the headline, and only where it adds something the headline
 * does not already say. Most of these answer the question a contractor has
 * next: "so do I need to do anything?"
 */
const detailFor = (situation: Situation, firstName: string): string | null => {
  switch (situation) {
    case "quote_sent":
      return `We'll email you the moment ${firstName} accepts.`;
    case "contract_sent":
      return `We'll email you the moment ${firstName} signs.`;
    case "invoice_unpaid":
      return `We'll email you the moment ${firstName} pays.`;
    case "paid":
      return "Nothing else needs you on this one.";
    default:
      return null;
  }
};

export const buildStatusPanel = ({
  situation,
  move,
  firstName,
  /**
   * The message from a send that has just happened, when the contractor
   * arrived here from one. It takes the headline because it is the more
   * specific truth at that moment — "Invoice sent today" rather than "waiting
   * on Megan" — and it is what the banner this panel replaces used to say.
   */
  sentTitle,
  sentBody,
}: {
  situation: Situation;
  move: NextMove;
  firstName: string;
  sentTitle?: string | null;
  sentBody?: string | null;
}): StatusPanel => ({
  tone: toneFor(situation, move),
  headline: sentTitle || headlineFor(situation, firstName),
  detail: sentBody || detailFor(situation, firstName),
});

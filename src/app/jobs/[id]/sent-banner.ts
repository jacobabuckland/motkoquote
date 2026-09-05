// The post-send confirmation banner as a pure function of the redirect's query
// state, extracted so every send outcome — including the ones that reach no
// channel — is unit-testable without a DOM harness.
//
// Every completing send routes back to the job page with ?sent=… (see the
// post-action navigation rule in AGENTS.md). Delivered lands the celebratory
// variant; delivered=0 lands a "send the link yourself" fallback carrying the
// copy-link so nothing is ever stranded on a spent form; for invoices,
// payout=setup surfaces the finish-setup nudge that used to live on the form.

export type SentBanner = {
  title: string;
  body: string;
  link: string | null;
  linkLabel: string;
};

export type SentBannerInput = {
  sent: string | undefined;
  delivered: string | undefined;
  payout: string | undefined;
  already?: string | undefined;
  firstName: string;
  // Pre-formatted " (email · text)" suffix, or "" when unknown.
  channelSuffix: string;
  quoteUrl: string | null;
  contractUrl: string | null;
  paymentUrl: string | null;
};

export const buildSentBanner = (input: SentBannerInput): SentBanner | null => {
  const {
    sent,
    delivered,
    payout,
    already,
    firstName,
    channelSuffix,
    quoteUrl,
    contractUrl,
    paymentUrl,
  } = input;
  const notDelivered = delivered === "0";

  if (sent === "quote") {
    return notDelivered
      ? {
          title: "Quote saved — send the link yourself",
          body: `We couldn't reach ${firstName}. Copy the link below and send it however you like — they can still view and accept it online.`,
          link: quoteUrl,
          linkLabel: "Copy quote link",
        }
      : {
          title: `Quote sent to ${firstName}${channelSuffix}`,
          body: "They'll get a link to view and accept it. We'll email you the moment they do. Nothing else needs you right now.",
          link: quoteUrl,
          linkLabel: "Copy quote link",
        };
  }

  if (sent === "contract") {
    // Already-sent case: the contract existed before this send attempt.
    if (already === "1") {
      return {
        title: "A contract has already been sent",
        body: "This quote already has a contract. You can share it again using the link below.",
        link: contractUrl,
        linkLabel: "Copy contract link",
      };
    }
    return notDelivered
      ? {
          title: "Contract created — send the link yourself",
          body: `We couldn't email the contract to ${firstName}. Copy the link below and send it however you like — they can still review and sign it online.`,
          link: contractUrl,
          linkLabel: "Copy contract link",
        }
      : {
          title: `Contract sent to ${firstName} (email)`,
          body: "They'll review and sign it online. You'll get an email the second it's signed. Nothing else needs you until then.",
          link: contractUrl,
          linkLabel: "Copy contract link",
        };
  }

  if (sent === "invoice") {
    // Payout setup outstanding takes precedence: the invoice went out but the
    // customer can't pay online yet, so the message is about finishing setup
    // (whether or not the email landed).
    if (payout === "setup") {
      return {
        title: notDelivered
          ? "Invoice created — finish payout setup"
          : `Invoice sent to ${firstName} — finish payout setup`,
        body: `To let ${firstName} pay online — straight to your bank — finish setting up payouts in Settings. Until then, arrange payment with them directly.`,
        link: paymentUrl,
        linkLabel: "Copy payment link",
      };
    }
    return notDelivered
      ? {
          title: "Invoice created — send the link yourself",
          body: `We couldn't email the invoice to ${firstName}. Copy the payment link below and send it however you like.`,
          link: paymentUrl,
          linkLabel: "Copy payment link",
        }
      : {
          title: `Invoice sent to ${firstName} (email)`,
          body: "They can pay online through the link. We'll email you when the payment lands. Nothing else needs you until then.",
          link: paymentUrl,
          linkLabel: "Copy payment link",
        };
  }

  if (sent === "work_complete") {
    return {
      title: "Work marked complete",
      body: "The job is now in your completed pipeline. Raise an invoice whenever you're ready to get paid.",
      link: null,
      linkLabel: "",
    };
  }

  if (sent === "work_uncomplete") {
    return {
      title: "Work marked incomplete",
      body: "The completion marker has been removed. You can mark it complete again whenever you're ready.",
      link: null,
      linkLabel: "",
    };
  }

  if (sent === "paid") {
    return {
      title: "Job marked as paid",
      body: `${firstName} paid you outside the app. The job is now closed and reminders have been stopped. Nothing else needs you.`,
      link: null,
      linkLabel: "",
    };
  }

  return null;
};

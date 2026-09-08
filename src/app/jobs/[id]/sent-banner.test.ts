import { describe, expect, it } from "vitest";
import { buildSentBanner, type SentBannerInput } from "./sent-banner";

// Shared fixture: a fully-populated redirect state. Each test overrides only
// the query fields (sent/delivered/payout/already) that drive the branch under test.
const base: SentBannerInput = {
  sent: undefined,
  delivered: undefined,
  payout: undefined,
  already: undefined,
  firstName: "Sam",
  channelSuffix: " (email · text)",
  quoteUrl: "https://motko.app/q/QUOTE",
  contractUrl: "https://motko.app/c/CONTRACT",
  paymentUrl: "https://motko.app/i/INVOICE",
};

describe("buildSentBanner — post-send confirmation state machine", () => {
  it("returns null when no send just happened", () => {
    expect(buildSentBanner(base)).toBeNull();
    expect(buildSentBanner({ ...base, sent: "something-else" })).toBeNull();
  });

  describe("quote", () => {
    it("celebrates a delivered quote and names the channels", () => {
      const banner = buildSentBanner({ ...base, sent: "quote" });
      expect(banner?.title).toBe("Quote sent to Sam (email · text)");
      expect(banner?.link).toBe(base.quoteUrl);
      expect(banner?.linkLabel).toBe("Copy quote link");
    });

    it("falls back to a copy-link banner when nothing reached the customer", () => {
      const banner = buildSentBanner({ ...base, sent: "quote", delivered: "0" });
      expect(banner?.title).toBe("Quote saved — send the link yourself");
      expect(banner?.body).toContain("couldn't reach Sam");
      // The spent form navigated here rather than lingering, so the banner must
      // still surface the link to send manually.
      expect(banner?.link).toBe(base.quoteUrl);
      expect(banner?.linkLabel).toBe("Copy quote link");
    });
  });

  describe("contract", () => {
    it("celebrates a delivered contract", () => {
      const banner = buildSentBanner({ ...base, sent: "contract" });
      expect(banner?.title).toBe("Contract sent to Sam (email)");
      expect(banner?.link).toBe(base.contractUrl);
    });

    it("falls back to a copy-link banner when the email couldn't be sent", () => {
      const banner = buildSentBanner({ ...base, sent: "contract", delivered: "0" });
      expect(banner?.title).toBe("Contract created — send the link yourself");
      expect(banner?.link).toBe(base.contractUrl);
    });

    it("shows an 'already sent' banner when already=1", () => {
      const banner = buildSentBanner({ ...base, sent: "contract", already: "1" });
      expect(banner?.title).toBe("A contract has already been sent");
      expect(banner?.body).toContain("already has a contract");
      expect(banner?.link).toBe(base.contractUrl);
      expect(banner?.linkLabel).toBe("Copy contract link");
    });

    it("already-sent banner is distinguishable from just-sent", () => {
      const alreadySent = buildSentBanner({ ...base, sent: "contract", already: "1" });
      const justSent = buildSentBanner({ ...base, sent: "contract" });

      expect(alreadySent?.title).not.toBe(justSent?.title);
      expect(alreadySent?.title.toLowerCase()).toContain("already");
      expect(justSent?.title).toContain("sent to Sam");
    });

    it("already-sent banner does not imply the contractor just sent it", () => {
      const banner = buildSentBanner({ ...base, sent: "contract", already: "1" });
      // Should not say "sent to Sam" which implies it just happened
      expect(banner?.title).not.toContain("sent to Sam");
      expect(banner?.title.toLowerCase()).toContain("already");
    });

    it("already-sent banner does not mention signature or waiting", () => {
      const banner = buildSentBanner({ ...base, sent: "contract", already: "1" });
      expect(banner?.body.toLowerCase()).not.toContain("sign");
      expect(banner?.body.toLowerCase()).not.toContain("waiting");
    });
  });

  describe("invoice", () => {
    it("celebrates a delivered invoice", () => {
      const banner = buildSentBanner({ ...base, sent: "invoice" });
      expect(banner?.title).toBe("Invoice sent to Sam (email)");
      expect(banner?.link).toBe(base.paymentUrl);
      expect(banner?.linkLabel).toBe("Copy payment link");
    });

    it("falls back to a copy-link banner when the email couldn't be sent", () => {
      const banner = buildSentBanner({ ...base, sent: "invoice", delivered: "0" });
      expect(banner?.title).toBe("Invoice created — send the link yourself");
      expect(banner?.link).toBe(base.paymentUrl);
    });

    it("nudges to finish payout setup, even on a delivered invoice", () => {
      const banner = buildSentBanner({ ...base, sent: "invoice", payout: "setup" });
      expect(banner?.title).toBe("Invoice sent to Sam — finish payout setup");
      expect(banner?.body).toContain("finish setting up payouts");
      expect(banner?.link).toBe(base.paymentUrl);
    });

    it("payout nudge takes precedence over the delivered=0 fallback", () => {
      const banner = buildSentBanner({
        ...base,
        sent: "invoice",
        delivered: "0",
        payout: "setup",
      });
      expect(banner?.title).toBe("Invoice created — finish payout setup");
      expect(banner?.body).toContain("finish setting up payouts");
    });
  });

  it("every send outcome resolves to a non-null banner — nothing strands silently", () => {
    // The spent-form rule: any completing send routes here, so for every send
    // kind and delivery state the page must have something to show.
    for (const sent of ["quote", "contract", "invoice"]) {
      for (const delivered of [undefined, "0"]) {
        const banner = buildSentBanner({ ...base, sent, delivered });
        expect(banner).not.toBeNull();
        expect(banner?.title.length).toBeGreaterThan(0);
      }
    }
  });
});

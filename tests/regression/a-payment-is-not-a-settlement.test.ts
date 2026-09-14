// The app contradicted itself inside one interaction.
//
// Recording a £118.80 deposit as paid on a £475.20 job produced this banner:
//
//   "Job marked as paid — Tomas paid you outside the app. The job is now
//    closed and reminders have been stopped. Nothing else needs you."
//
// £356.40 was still outstanding and not yet invoiced. Seconds earlier the
// confirmation dialog had said the right thing — "This records the £118.80
// deposit as paid. The rest of the job stays open, and reminders to Tomas
// continue for the balance." The dialog is correct; the banner is the half that
// survives on the page, and a trade who reads it never invoices the balance.
//
// The banner had no view of whether the job was actually settled. It now takes
// deriveJobState's verdict, which already applies the settled-deposit rule
// from #739.
import { describe, expect, it } from "vitest";
import { buildSentBanner, type SentBannerInput } from "@/app/jobs/[id]/sent-banner";

const paid = (over: Partial<SentBannerInput> = {}): SentBannerInput => ({
  sent: "paid",
  delivered: undefined,
  payout: undefined,
  firstName: "Tomas",
  channelSuffix: "",
  quoteUrl: null,
  contractUrl: null,
  paymentUrl: null,
  ...over,
});

describe("recording a payment on a job that is not finished", () => {
  it("does NOT say the job is closed", () => {
    const banner = buildSentBanner(paid({ jobClosed: false }));
    expect(banner?.body ?? "").not.toContain("now closed");
    expect(banner?.body ?? "").not.toContain("Nothing else needs you");
  });

  it("says the balance is still open, which is what the dialog said", () => {
    const banner = buildSentBanner(paid({ jobClosed: false }));
    expect(banner?.body).toContain("rest of the job stays open");
    expect(banner?.title).toContain("balance is still open");
  });

  it("treats an ABSENT verdict as not closed", () => {
    // The safe direction. The worst case is a banner that under-claims on a
    // finished job; the other way round tells a trade their money has arrived.
    const banner = buildSentBanner(paid());
    expect(banner?.body ?? "").not.toContain("now closed");
  });
});

describe("recording the payment that actually finishes a job", () => {
  it("still says the job is closed", () => {
    // Unchanged behaviour, pinned so the fix above does not flatten the real
    // settlement into a permanent "still open".
    const banner = buildSentBanner(paid({ jobClosed: true }));
    expect(banner?.title).toBe("Job marked as paid");
    expect(banner?.body).toContain("now closed");
    expect(banner?.body).toContain("Nothing else needs you");
  });
});

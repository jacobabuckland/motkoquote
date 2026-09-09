import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSentBanner, type SentBannerInput } from "@/app/jobs/[id]/sent-banner";

/**
 * The contract banner names the channels the contract actually went out on.
 *
 * Rev 3 read this as hardcoded copy. Rev 5's RCA corrected that to "the copy is
 * data-driven; the defect is in what the send passes as `channels`" — and that
 * was half right, which is why it is worth writing down. BOTH were true, in
 * different places:
 *
 *   1. The job page builds `channelSuffix` from a `?channels=` query param, and
 *      the CONTRACT send never passed one. `channels=` appears exactly once in
 *      the tree and it is on the quote path.
 *   2. And the contract branch of buildSentBanner ignored `channelSuffix`
 *      anyway, hardcoding "(email)" — while its failure copy said "we couldn't
 *      EMAIL the contract".
 *
 * Fixing only the redirect would have changed nothing on screen. The send has
 * been dual-channel since notify-customer's contract path stopped being
 * `if (email) { … }`, so a contract texted to a phone-only customer announced
 * itself as an email, and one that failed to text blamed an address that
 * customer may not have.
 *
 * This is the N4.1 shape a third time: the reason exists in the response, and a
 * layer above it throws the reason away and substitutes a guess.
 */

const base: SentBannerInput = {
  sent: "contract",
  delivered: undefined,
  payout: undefined,
  already: undefined,
  firstName: "Sam",
  channelSuffix: " (email · text)",
  quoteUrl: "https://motko.app/q/QUOTE",
  contractUrl: "https://motko.app/c/CONTRACT",
  paymentUrl: "https://motko.app/i/INVOICE",
};

describe("the banner says what actually happened", () => {
  it("names both channels when both landed", () => {
    expect(buildSentBanner(base)?.title).toBe("Contract sent to Sam (email · text)");
  });

  it("names text alone for a phone-only customer", () => {
    // The reported symptom, exactly: this used to read "(email)".
    const banner = buildSentBanner({ ...base, channelSuffix: " (text)" });
    expect(banner?.title).toBe("Contract sent to Sam (text)");
    expect(banner?.title).not.toContain("email");
  });

  it("names email alone when that is what landed", () => {
    expect(buildSentBanner({ ...base, channelSuffix: " (email)" })?.title).toBe(
      "Contract sent to Sam (email)",
    );
  });

  it("claims no channel at all when it was handed none", () => {
    // An unknown channel set must produce silence, not a guess. This is the
    // case the hardcoded "(email)" was standing in for.
    expect(buildSentBanner({ ...base, channelSuffix: "" })?.title).toBe(
      "Contract sent to Sam",
    );
  });

  it("blames no channel when nothing was delivered", () => {
    const banner = buildSentBanner({ ...base, delivered: "0" });
    expect(banner?.body).toContain("We couldn't reach Sam");
    expect(banner?.body).not.toContain("email");
  });

  it("still says nothing about channels on an already-sent contract", () => {
    // Nothing was sent on this attempt and the original send's channels are not
    // known here, so naming any would be an invention.
    const banner = buildSentBanner({ ...base, already: "1" });
    expect(banner?.title).toBe("A contract has already been sent");
    expect(banner?.title).not.toContain("email");
  });

  it("leaves the quote branch exactly as it was", () => {
    // It was already data-driven. This item must not touch it.
    expect(buildSentBanner({ ...base, sent: "quote" })?.title).toBe(
      "Quote sent to Sam (email · text)",
    );
  });
});

/**
 * The other half: the send has to PASS the channels, or the banner above has
 * nothing to render and falls back to the empty suffix on every contract.
 *
 * Source-read for the reason the sibling wrap-detour test is: these are a
 * Server Action and a client form behind a Supabase call and a router push, and
 * what needs pinning is that the value is carried across the redirect at all.
 */
describe("the send carries the channels across the redirect", () => {
  const action = readFileSync(
    resolve(__dirname, "../../src/app/dashboard/actions.ts"),
    "utf8",
  );
  const form = readFileSync(
    resolve(__dirname, "../../src/app/dashboard/create-contract-form.tsx"),
    "utf8",
  );

  it("createContract reports delivery per channel, not one boolean", () => {
    // notifyCustomer always returned this; the action discarded it.
    expect(action).toMatch(/email: \{ delivered: report\.email\.delivered \}/);
    expect(action).toMatch(/sms: \{ delivered: report\.sms\.delivered \}/);
  });

  it("the form builds ?channels= from what landed", () => {
    // Optional-chained: a Server Action's client and server halves are not
    // swapped atomically, so a new bundle can call the previous action during a
    // rolling deploy. The degrade is an empty channels list, not a crash.
    expect(form).toMatch(/res\.email\?\.delivered && "email"/);
    expect(form).toMatch(/res\.sms\?\.delivered && "sms"/);
    expect(form).toMatch(/sent=contract&channels=\$\{sentChannels\}/);
  });

  it("does not attach channels to the delivered=0 or already-sent redirects", () => {
    // Neither has a landed channel to name: one delivered nothing, the other
    // sent nothing this time.
    expect(form).toContain('"sent=contract&already=1"');
    expect(form).toContain('"sent=contract&delivered=0"');
  });
});

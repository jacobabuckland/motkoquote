import { describe, it, expect } from "vitest";
import { redactContactDetails, mentionsContactDetail } from "@/lib/voice/contact-detail-guard";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

// PFIX-9. The production case is quoted verbatim, with the real digits kept
// because they are the input that produced the defect and the amount depends on
// them. It is a test fixture, not a customer record — job 30faef2a is being
// binned (areas/motko.md, 3 Sep).

describe("redactContactDetails", () => {
  it("removes the number and keeps everything else", () => {
    const out = redactContactDetails("Yeah, the contact number is 07479 556410");

    expect(out).not.toMatch(/\d/);
    expect(out).toContain("contact number");
  });

  it("keeps a genuine price stated in the same sentence", () => {
    // The half the card did not know about: candidates are found one per
    // sentence from the FIRST money-word run, so the number was hiding the
    // price behind it. Redacting rather than rejecting is what recovers it.
    const out = redactContactDetails(
      "Ring me on 07700 900123, the skim is four hundred and fifty pounds.",
    );

    expect(out).toContain("four hundred and fifty pounds");
    expect(out).not.toContain("07700");
  });

  it("removes an email and a postcode", () => {
    expect(redactContactDetails("Her email is megfarrant@hotmail.com.")).not.toContain("@");
    expect(redactContactDetails("The address is 50 Holland Street, SE1 9FU.")).not.toMatch(
      /SE1\s*9FU/i,
    );
  });

  it("leaves a bare priced numeral alone", () => {
    expect(redactContactDetails("The skim is 450 pounds.")).toContain("450");
    expect(redactContactDetails("It is £450 for the skim.")).toContain("450");
  });

  it("leaves a five-figure price alone", () => {
    // The reason this is not a magnitude ceiling: a threshold chosen to exclude
    // £563,889 would one day exclude a real extension.
    expect(redactContactDetails("The extension is 22000 pounds.")).toContain("22000");
  });

  it("removes a short digit run only when the sentence announced a contact detail", () => {
    expect(redactContactDetails("The door code is 1234.")).not.toContain("1234");
    expect(redactContactDetails("Twelve thirty-four for the lot, 1234 pounds.")).toContain("1234");
  });

  it("removes anything with nine or more digits whatever the wording", () => {
    // No cue word at all — a run that long cannot be a spoken price.
    expect(redactContactDetails("It's 07479556410 for that.")).not.toContain("07479");
  });

  it("removes a leading-zero run of five or more digits", () => {
    // No price starts with a zero; every UK number does.
    expect(redactContactDetails("Try 01234 for me.")).not.toContain("01234");
  });

  it("is a no-op on a sentence with nothing to redact", () => {
    const clean = "Tiling labour is one thousand four hundred pounds.";

    expect(redactContactDetails(clean)).toBe(clean);
  });
});

describe("mentionsContactDetail", () => {
  it("recognises a number, an email and a postcode", () => {
    expect(mentionsContactDetail("the contact number is 07479 556410")).toBe(true);
    expect(mentionsContactDetail("email is a@b.co")).toBe(true);
  });

  it("does not fire on an ordinary priced sentence", () => {
    expect(mentionsContactDetail("Tiling labour is one thousand four hundred pounds.")).toBe(false);
  });
});

describe("extractStatedPrices no longer invents a price from a contact detail", () => {
  it("extracts NOTHING from the production sentence", () => {
    // Was £563,889.00, attached to item "contact number", which then raised a
    // send-blocking reconciliation flag for an amount nobody stated.
    expect(extractStatedPrices("Yeah, the contact number is 07479 556410")).toEqual([]);
  });

  it("recovers the genuine price the number was hiding", () => {
    // Was £907,823 — the phone read as money AND the £450 lost entirely.
    const prices = extractStatedPrices(
      "Ring me on 07700 900123, the skim is four hundred and fifty pounds.",
    );

    expect(prices.map((p) => p.amount)).toEqual([45000]);
  });

  it("extracts nothing from an email or an address", () => {
    expect(extractStatedPrices("Her email is megfarrant@hotmail.com.")).toEqual([]);
    expect(extractStatedPrices("The address is 50 Holland Street, SE1 9FU.")).toEqual([]);
  });

  it("leaves the fixture corpus's stated prices untouched", () => {
    // scenario 1's three anchors, which HARN-2 depends on.
    expect(
      extractStatedPrices("Tiling labour is one thousand four hundred pounds.")[0]?.amount,
    ).toBe(140000);
    expect(extractStatedPrices("Tiling labour is eight hundred pounds.")[0]?.amount).toBe(80000);
    expect(
      extractStatedPrices("I normally charge one hundred and forty pounds for a radiator swap.")[0]
        ?.amount,
    ).toBe(14000);
  });
});

// The Companies House cross-check warned that two identical addresses differed.
//
// Reported from the device, 11 Sep:
//
//   Stated:     12 Malvern Road, NR1 4BA
//   Registered: 12 Malvern Road, Norwich, NR1 4BA
//
// "Registered address differs" — against the same building. The comparison was
// `a.trim().replace(/\s+/g," ").toLowerCase() !== b...` at THREE separate call
// sites, which is string equality wearing a normaliser's coat. The trade had
// left out the post town, which the postcode already determines.
//
// A warning that fires on a correct address is worse than no warning: it asks
// someone to go and fix something that is not broken, and it teaches them to
// dismiss the next one, which might be real.
import { describe, expect, it } from "vitest";
import { addressesMatch, normalizeUkPostcode } from "@/lib/uk-address";

describe("the address that started this", () => {
  it("does not flag an address whose only difference is the missing post town", () => {
    expect(
      addressesMatch("12 Malvern Road, NR1 4BA", "12 Malvern Road, Norwich, NR1 4BA"),
    ).toBe(true);
  });
});

describe("differences that are not differences", () => {
  const registered = "12 Malvern Road, Norwich, Norfolk, NR1 4BA";

  it("ignores a missing county", () => {
    expect(addressesMatch("12 Malvern Road, Norwich, NR1 4BA", registered)).toBe(true);
  });

  it("ignores a missing country", () => {
    expect(
      addressesMatch(registered, "12 Malvern Road, Norwich, Norfolk, NR1 4BA, United Kingdom"),
    ).toBe(true);
    expect(addressesMatch(registered, `${registered}, UK`)).toBe(true);
  });

  it("ignores punctuation and casing", () => {
    expect(addressesMatch("12 MALVERN ROAD. NORWICH. NORFOLK. NR1 4BA", registered)).toBe(true);
  });

  it("ignores how the postcode is spaced", () => {
    expect(addressesMatch("12 Malvern Road, Norwich, Norfolk, nr14ba", registered)).toBe(true);
  });

  it("ignores Road vs Rd, and the other common abbreviations", () => {
    expect(addressesMatch("12 Malvern Rd, Norwich, Norfolk, NR1 4BA", registered)).toBe(true);
    expect(addressesMatch("3 High St, NR2 1AA", "3 High Street, Norwich, NR2 1AA")).toBe(true);
    expect(addressesMatch("9 Oak Ave, NR3 2BB", "9 Oak Avenue, Norwich, NR3 2BB")).toBe(true);
  });

  it("reads a bare St as either Street or Saint, because it genuinely is both", () => {
    expect(addressesMatch("1 St Peters Road, NR1 1AA", "1 Saint Peters Road, NR1 1AA")).toBe(true);
  });

  it("does not care which side says more", () => {
    // The trade may type MORE than Companies House holds, not only less.
    expect(addressesMatch(registered, "12 Malvern Road, NR1 4BA")).toBe(true);
  });
});

describe("differences that ARE differences — the warning still has a job", () => {
  it("flags a different house number", () => {
    expect(
      addressesMatch("14 Malvern Road, Norwich, NR1 4BA", "12 Malvern Road, Norwich, NR1 4BA"),
    ).toBe(false);
  });

  it("flags 12A against 12", () => {
    expect(
      addressesMatch("12A Malvern Road, Norwich, NR1 4BA", "12 Malvern Road, Norwich, NR1 4BA"),
    ).toBe(false);
  });

  it("flags a different street", () => {
    expect(
      addressesMatch("12 Malvern Road, Norwich, NR1 4BA", "12 Unthank Road, Norwich, NR1 4BA"),
    ).toBe(false);
  });

  it("flags a different postcode, which is decisive on its own", () => {
    expect(
      addressesMatch("12 Malvern Road, Norwich, NR1 4BA", "12 Malvern Road, Norwich, NR2 4BA"),
    ).toBe(false);
  });

  it("flags a genuinely different address — the case this exists to catch", () => {
    // A trade whose company is registered at their accountant's office, or who
    // has moved. That is what the trade needs telling about.
    expect(
      addressesMatch("4 Riverside Court, Ipswich, IP1 1AA", "12 Malvern Road, Norwich, NR1 4BA"),
    ).toBe(false);
  });
});

describe("the judgement call, stated so it cannot change by accident", () => {
  it("treats a flat within the same building as the same address", () => {
    // Containment means the stated address may be less specific. A flat letter
    // is not the kind of difference this warning is for, and the postcode and
    // building agree. Recorded here because it is a deliberate choice, not an
    // oversight — if it ever needs tightening, this is the test to change.
    expect(
      addressesMatch("12 Malvern Road, NR1 4BA", "Flat B, 12 Malvern Road, Norwich, NR1 4BA"),
    ).toBe(true);
  });

  it("says nothing when there is nothing to compare", () => {
    // A warning is a claim that something differs. Punctuation alone supports
    // no such claim, so it must not produce one.
    expect(addressesMatch("", "12 Malvern Road, NR1 4BA")).toBe(true);
    expect(addressesMatch("  ,, ", "12 Malvern Road, NR1 4BA")).toBe(true);
  });

  it("falls back to the words when only one side carries a postcode", () => {
    expect(addressesMatch("12 Malvern Road, Norwich", "12 Malvern Road, Norwich, NR1 4BA")).toBe(
      true,
    );
    expect(addressesMatch("4 Riverside Court", "12 Malvern Road, Norwich, NR1 4BA")).toBe(false);
  });

  it("STILL WARNS when each side says something the other does not", () => {
    // The known limit of containment, pinned so it is a choice rather than a
    // surprise. "12-14 Malvern Road, NR1 4BA" loses its hyphen and becomes the
    // tokens 12 and 14; Companies House says "12 Malvern Road, Norwich". Neither
    // contains the other — one adds 14, the other adds Norwich — so the warning
    // shows.
    //
    // Left as it is on purpose. A unit range is rare next to the missing post
    // town this fix is for, and the failure direction is the safe one: the trade
    // sees an advisory they can dismiss, on a screen that already tells them to
    // keep their own value if it is a trading address. Widening the rule to
    // swallow this would start swallowing real differences.
    expect(addressesMatch("12-14 Malvern Road, NR1 4BA", "12 Malvern Road, Norwich, NR1 4BA")).toBe(
      false,
    );
  });

  it("does match a unit range when the other side is otherwise a superset", () => {
    // The same range against the fuller registered address it came from.
    expect(
      addressesMatch(
        "12-14 Malvern Road, NR1 4BA",
        "12-14 Malvern Road, Norwich, Norfolk, NR1 4BA",
      ),
    ).toBe(true);
  });
});

describe("reading the postcode out of free text", () => {
  it("canonicalises spacing and case", () => {
    expect(normalizeUkPostcode("12 Malvern Road, nr14ba")).toBe("NR1 4BA");
    expect(normalizeUkPostcode("12 Malvern Road, NR1  4BA")).toBe("NR1 4BA");
  });

  it("handles the longer outward codes", () => {
    expect(normalizeUkPostcode("Buckingham Palace, SW1A 1AA")).toBe("SW1A 1AA");
    expect(normalizeUkPostcode("1 Test Road, M1 1AE")).toBe("M1 1AE");
  });

  it("returns null rather than guessing when there is no postcode", () => {
    expect(normalizeUkPostcode("12 Malvern Road, Norwich")).toBeNull();
  });
});

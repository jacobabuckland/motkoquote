// #373 — customer name, site address and contact have no deterministic capture
// in voice intake. Their entire enforcement is one sentence of prose at
// character 5007 of a 7,680-character instruction string.
//
// These tests cover the VISIBILITY half only. Whether the model should be made
// to ASK depends on a re-measure that has not happened: the original finding
// was taken on a looping call where update_sow never fired and the checklist
// phase was structurally unreachable, and #369 has since fixed the loop. What
// holds either way is that a call ending without a name or contact channel
// must not present as a complete quote.
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_DETAILS_FLAG_PREFIX,
  customerDetailsFlag,
  missingCustomerDetails,
  withCustomerDetailsFlag,
} from "@/lib/customer-details-guard";
import type { SowState } from "@/lib/schemas/sow";

// Takes a loose record rather than Partial<SowState> on purpose.
//
// nullishString parses null into undefined, so a zod-PARSED SoW never carries
// null in these fields — but sow_json is read through a plain type cast in
// several call sites, never re-parsed, so null does reach this code at runtime.
// Typing the helper as Partial<SowState> would make `null` a compile error and
// quietly delete the coverage for the shape that actually occurs.
const sow = (patch: Record<string, string | null | undefined>): SowState =>
  ({
    customer_name: null,
    site_address: null,
    customer_phone: null,
    customer_email: null,
    ...patch,
  }) as unknown as SowState;

describe("missingCustomerDetails", () => {
  it("reports nothing when a name and a phone are present", () => {
    expect(
      missingCustomerDetails(sow({ customer_name: "Luca Feser", customer_phone: "07700900000" })),
    ).toEqual([]);
  });

  it("accepts an email as the contact channel", () => {
    // One channel is enough. Demanding both would flag the ordinary case of a
    // customer who gave a mobile and no email, and a flag that fires on the
    // ordinary case stops being read.
    expect(
      missingCustomerDetails(sow({ customer_name: "Luca Feser", customer_email: "l@example.co.uk" })),
    ).toEqual([]);
  });

  it("reports a missing name", () => {
    expect(missingCustomerDetails(sow({ customer_phone: "07700900000" }))).toEqual(["name"]);
  });

  it("reports a missing contact channel", () => {
    expect(missingCustomerDetails(sow({ customer_name: "Luca Feser" }))).toEqual([
      "a phone number or email",
    ]);
  });

  it("reports both when the call captured neither", () => {
    expect(missingCustomerDetails(sow({}))).toEqual(["name", "a phone number or email"]);
  });

  it("treats whitespace as absent", () => {
    // A name of " " satisfies a null check and nothing else. The send guard
    // trims, so a flag that did not would disagree with it.
    expect(missingCustomerDetails(sow({ customer_name: "   ", customer_phone: "07700900000" }))).toEqual([
      "name",
    ]);
  });

  it("does not flag a missing site address", () => {
    // A job whose address the contractor already knows is ordinary. The send
    // does not block on it, so neither does this.
    expect(
      missingCustomerDetails(
        sow({ customer_name: "Luca Feser", customer_phone: "07700900000", site_address: null }),
      ),
    ).toEqual([]);
  });

  it("treats an explicit null the same as an absent field", () => {
    // The runtime shape that the parsed type says cannot exist. sow_json is
    // cast rather than parsed at several call sites, so it can.
    expect(
      missingCustomerDetails(
        sow({ customer_name: null, customer_phone: null, customer_email: null }),
      ),
    ).toEqual(["name", "a phone number or email"]);
  });

  it("reports nothing for a job with no SoW at all", () => {
    // A typed/manual quote never had a voice call to capture anything.
    expect(missingCustomerDetails(null)).toEqual([]);
  });
});

describe("customerDetailsFlag", () => {
  it("names what is missing rather than saying 'incomplete'", () => {
    const flag = customerDetailsFlag(sow({}));
    expect(flag).toContain("name");
    expect(flag).toContain("phone number or email");
  });

  it("is null when nothing is missing", () => {
    expect(
      customerDetailsFlag(sow({ customer_name: "Luca Feser", customer_phone: "07700900000" })),
    ).toBeNull();
  });
});

describe("withCustomerDetailsFlag", () => {
  it("adds the flag to an empty list", () => {
    const flags = withCustomerDetailsFlag([], sow({}));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain(CUSTOMER_DETAILS_FLAG_PREFIX);
  });

  it("preserves unrelated flags", () => {
    const flags = withCustomerDetailsFlag(["Wet room tanking: confirm the membrane spec"], sow({}));
    expect(flags).toHaveLength(2);
    expect(flags[0]).toBe("Wet room tanking: confirm the membrane spec");
  });

  it("replaces an earlier flag rather than accumulating on redraft", () => {
    // redraftJob runs this on every regeneration. Without the filter a job
    // redrafted three times carries three copies of the same warning.
    const once = withCustomerDetailsFlag([], sow({}));
    const twice = withCustomerDetailsFlag(once, sow({}));
    const thrice = withCustomerDetailsFlag(twice, sow({}));
    expect(thrice).toHaveLength(1);
  });

  it("clears the flag once the details are filled in", () => {
    const flagged = withCustomerDetailsFlag([], sow({}));
    expect(flagged).toHaveLength(1);

    const fixed = withCustomerDetailsFlag(
      flagged,
      sow({ customer_name: "Luca Feser", customer_phone: "07700900000" }),
    );
    expect(fixed).toEqual([]);
  });

  it("handles a null flag list", () => {
    expect(withCustomerDetailsFlag(null, sow({}))).toHaveLength(1);
    expect(withCustomerDetailsFlag(undefined, sow({}))).toHaveLength(1);
  });
});

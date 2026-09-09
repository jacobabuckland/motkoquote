import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CUSTOMER_DETAIL_LABELS,
  EMPTY_SOW_STATE,
  getMissingCustomerDetails,
  getUnansweredRequiredChecklistQuestions,
  missingSiteAddress,
  type SowState,
} from "@/lib/schemas/sow";

/**
 * A call that ends without the site address says so.
 *
 * P1·6 decided `site_address` stays out of `unasked_required` and out of
 * `wrap_incomplete`. Production says that was too quiet: **11 of the 15 signed
 * contracts have no site address**, and 14 of the 24 SoWs carry none. A signed
 * contract that does not say where the work happens is a worse document than a
 * quote missing a checklist answer — and nothing anywhere told the contractor.
 *
 * `tests/acceptance/373.test.tsx` froze the shape of the fix without anyone
 * building it. Its assertion is named *"reports missing site address
 * separately, not as a blocking gap"* and its comment says site_address is
 * "reported separately via a different mechanism". There was no other
 * mechanism: nothing in the tree produced the slot, and
 * `CUSTOMER_DETAIL_LABELS.site_address` had sat unused since VOICE-3 — a label
 * for a value no code ever emitted.
 *
 * So this builds the separate mechanism the frozen test always pointed at,
 * rather than moving site_address into the blocking list, which would have
 * broken that assertion and needed a retirement this branch cannot perform.
 *
 * Superseded on Jacob's decision of 9 Sep, and deliberately only half of P1·6:
 * it REPORTS, it does not GATE.
 */

const sow = (over: Partial<SowState>): SowState => ({ ...EMPTY_SOW_STATE, ...over });

describe("the site address is reported when absent", () => {
  it("names the slot when there is no address", () => {
    expect(missingSiteAddress(sow({ site_address: undefined }))).toEqual(["site_address"]);
  });

  it("treats whitespace as absent, like every other detail check", () => {
    expect(missingSiteAddress(sow({ site_address: "   " }))).toEqual(["site_address"]);
    expect(missingSiteAddress(sow({ site_address: "" }))).toEqual(["site_address"]);
  });

  it("says nothing when an address was captured", () => {
    expect(missingSiteAddress(sow({ site_address: "14 Elm Road, Leeds" }))).toEqual([]);
  });

  it("has a label to render, which until now was dead code", () => {
    expect(CUSTOMER_DETAIL_LABELS.site_address).toBe("the site address");
  });
});

describe("it reports without gating — the half of P1·6 that stands", () => {
  it("never holds a wrap open", () => {
    // concludeOrAskRequired detours on the CHECKLIST slots. If site_address
    // ever appears here, a call can be held open for it, which is the trap
    // P1·6 was right to avoid and this change deliberately does not touch.
    const missingEverything = sow({ site_address: undefined });
    const required: string[] = getUnansweredRequiredChecklistQuestions(missingEverything);
    expect(required).not.toContain("site_address");
  });

  it("stays out of the blocking customer-detail list", () => {
    // tests/acceptance/373.test.tsx freezes this, and it stays true: that
    // function is the blocking list, and this is separate. Asserted here too
    // so the reason is visible from the change that could have broken it.
    const complete = sow({
      customer_name: "Alice Builder",
      customer_phone: "07700 900123",
      site_address: undefined,
    });
    expect(getMissingCustomerDetails(complete)).toEqual([]);
    expect(getMissingCustomerDetails(complete)).not.toContain("site_address");
  });

  it("is a separate function, so the two lists cannot merge by accident", () => {
    const noAddressOnly = sow({
      customer_name: "Alice Builder",
      customer_email: "alice@example.com",
      site_address: undefined,
    });
    expect(getMissingCustomerDetails(noAddressOnly)).toEqual([]);
    expect(missingSiteAddress(noAddressOnly)).toEqual(["site_address"]);
  });
});

/**
 * And the SoW writer has to include it, or the banner has nothing to render.
 * Source-read for the reason the sibling wrap tests are: this is a Server
 * Action behind a Supabase write, and what needs pinning is that the slot
 * reaches `unasked_required`.
 */
describe("the completed SoW carries it", () => {
  const source = readFileSync(resolve(__dirname, "../../src/app/jobs/actions.ts"), "utf8");

  it("adds it to the reported list", () => {
    expect(source).toMatch(/\.\.\.missingSiteAddress\(sowState\)/);
  });

  it("adds it alongside the customer details, in the same list the banner reads", () => {
    const block = source.slice(
      source.indexOf("const allUnaskedRequired"),
      source.indexOf("const statedPrices"),
    );
    expect(block).toContain("...missingCustomerDetails");
    expect(block).toContain("...missingSiteAddress(sowState)");
  });
});

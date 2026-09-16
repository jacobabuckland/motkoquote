/**
 * @vitest-environment happy-dom
 */

/**
 * The quote editor says why a save was refused, and stops inviting a retry
 * that cannot work.
 *
 * Both write paths reported "check your connection and try again" for every
 * failure — including the two that no amount of retrying fixes: a quote locked
 * because a contract has been raised from it, and one the customer has already
 * declined. Two costs, reported 15 Sep on jobs `8f881709` and `a2c25d01`:
 *
 *   * the contractor blames their phone signal and retries something that can
 *     never succeed, instead of learning the quote is locked;
 *   * while they retry, the editor goes on displaying the rejected figures —
 *     £1,800 in the header on a quote that is really £1,200, against a contract
 *     that says £1,200 — with nothing on screen saying which number is real.
 *
 * The server has thrown the authored reason through `actionableError` all
 * along, so it survives Next's production redaction. The editor discarded it
 * and stored a boolean.
 */

import { describe, expect, it } from "vitest";
import { actionableError, authoredMessage } from "@/lib/actionable-error";
import { QUOTE_LOCKED_BY_CONTRACT } from "@/lib/quote-editability";
import { QUOTE_NOT_EDITABLE } from "@/lib/quote-send-guards";

describe("the reason survives the trip to the editor", () => {
  it("carries the contract lock verbatim", () => {
    const thrown = actionableError(QUOTE_LOCKED_BY_CONTRACT);

    expect(authoredMessage(thrown)).toBe(QUOTE_LOCKED_BY_CONTRACT);
    expect(
      authoredMessage(thrown),
      "names the contract, so the contractor knows retrying is pointless",
    ).toContain("contract");
  });

  it("carries the already-responded refusal verbatim", () => {
    expect(authoredMessage(actionableError(QUOTE_NOT_EDITABLE))).toBe(QUOTE_NOT_EDITABLE);
  });

  it("says nothing authored for an ordinary failure", () => {
    // A dropped connection has no authored reason, so the fallback stands —
    // and that is the one case where "try again" is honest.
    expect(authoredMessage(new Error("fetch failed"))).toBeNull();
  });

  it("never presents a raw error as the product's own words", () => {
    // Outside a production build nothing is redacted, so `actionableMessage`
    // hands back a Supabase error verbatim. On a screen that is a refusal
    // explanation, that is a leak wearing an explanation's clothes.
    const raw = new Error('duplicate key value violates unique constraint "quotes_pkey"');
    expect(authoredMessage(raw)).toBeNull();
  });
});

describe("neither refusal blames the connection", () => {
  it("does not mention the connection in the contract lock", () => {
    expect(QUOTE_LOCKED_BY_CONTRACT.toLowerCase()).not.toContain("connection");
  });

  it("does not mention the connection in the already-responded refusal", () => {
    expect(QUOTE_NOT_EDITABLE.toLowerCase()).not.toContain("connection");
  });
});

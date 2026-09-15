/**
 * A value the SoW schema dislikes must cost that value, not the whole turn.
 *
 * `pricing.fixed_amount` was `z.number().positive()`. The voice model says "no
 * fixed price" by sending 0, which `.positive()` rejects — a ZodError out of a
 * server action, HTTP 500 from POST /jobs/new, and the ENTIRE update_sow delta
 * discarded. Two of the five voice runs on 15 Sep lost a complete turn that way
 * (09:12:15 and 09:15:13, release bca27d1): a deep-levelling area, a phase
 * labour plan and a set of working constraints were all in the rejected
 * payloads and none of them reached the quote.
 *
 * Two changes, and the second is the general one:
 *   1. A non-positive fixed_amount means "none" and becomes null.
 *   2. Any other field the schema rejects is dropped on its own, and the rest
 *      of the delta still merges.
 */

import { describe, expect, it, vi } from "vitest";
import { mergeSowToolDelta } from "@/lib/schemas/sow";

describe("a non-positive fixed_amount means no fixed price", () => {
  it("does not throw on zero", () => {
    expect(() =>
      mergeSowToolDelta(null, { job_type: "plastering", pricing: { mode: "calculated", fixed_amount: 0 } }),
    ).not.toThrow();
  });

  it("records it as absent rather than as a £0 fixed price", () => {
    const sow = mergeSowToolDelta(null, {
      job_type: "plastering",
      pricing: { mode: "calculated", fixed_amount: 0 },
    });

    expect(sow.pricing?.fixed_amount).toBeNull();
    expect(sow.pricing?.mode).toBe("calculated");
  });

  it("still keeps a real fixed price", () => {
    const sow = mergeSowToolDelta(null, {
      job_type: "plastering",
      pricing: { mode: "fixed", fixed_amount: 2000 },
    });

    expect(sow.pricing?.fixed_amount).toBe(2000);
  });
});

describe("one bad field costs that field, not the turn", () => {
  it("keeps everything the schema did accept", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // `rooms` is the wrong type outright — nothing coerces it. Everything else
    // in the payload is the contractor describing their job.
    const sow = mergeSowToolDelta(null, {
      job_type: "lime plastering",
      rooms: "not an array of rooms",
      exclusions: ["cement plaster", "painting"],
      additional_items: ["waste removal"],
      access_issues: "scaffold up for two weeks",
    });

    expect(sow.job_type).toBe("lime plastering");
    expect(sow.exclusions).toEqual(["cement plaster", "painting"]);
    expect(sow.additional_items).toEqual(["waste removal"]);
    expect(sow.access_issues).toBe("scaffold up for two weeks");
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it("names the field it dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mergeSowToolDelta(null, { job_type: "plastering", rooms: "not an array" });

    expect(warn.mock.calls[0]?.[1]).toContain("rooms");

    warn.mockRestore();
  });

  it("still throws when there is nothing left to salvage", () => {
    // Not an object at all — no top-level key to drop, so nothing to recover.
    expect(() => mergeSowToolDelta(null, "a string")).toThrow();
  });
});

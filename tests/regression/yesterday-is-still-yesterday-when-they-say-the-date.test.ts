/**
 * "Yesterday, the 16th of September" is yesterday.
 *
 * `RELATIVE_DAYS` anchored each phrase at both ends, so the relative word had
 * to be the WHOLE phrase. A contractor who dates a cost twice is being more
 * precise, not less — and the extra words turned a confident answer into none:
 * `resolveSpokenDate` returned null, the caller fell back to `today`, and run
 * 107 of the 17 Sep tranche filed a cost incurred and paid on the 16th as the
 * 17th. Both `incurred_on` and `paid_on`. The words survived the whole way
 * down; only the match failed.
 *
 * A date on the wrong day can land in the wrong VAT quarter, which is what the
 * cost prompt already warns about.
 */

import { describe, expect, it } from "vitest";
import { resolveSpokenDate } from "@/lib/voice/spoken-date";

const TODAY = "2026-09-17";

describe("a relative day said alongside the date", () => {
  it("resolves run 107's phrase to the day they said", () => {
    expect(resolveSpokenDate("yesterday, 16 September", TODAY)).toBe("2026-09-16");
  });

  it("reads the other ways of saying the same thing", () => {
    expect(resolveSpokenDate("yesterday the 16th", TODAY)).toBe("2026-09-16");
    expect(resolveSpokenDate("yesterday afternoon, about four", TODAY)).toBe("2026-09-16");
    expect(resolveSpokenDate("this morning, early", TODAY)).toBe(TODAY);
  });

  it("still resolves the bare word", () => {
    expect(resolveSpokenDate("yesterday", TODAY)).toBe("2026-09-16");
    expect(resolveSpokenDate("today", TODAY)).toBe(TODAY);
  });
});

describe("what the leading anchor is holding back", () => {
  it("does not read 'day before yesterday' as one day back", () => {
    // It does not START with "yesterday", which is the whole reason the
    // loosening is safe. One day out here is a wrong date on a real cost.
    expect(resolveSpokenDate("the day before yesterday", TODAY)).toBe("2026-09-15");
    expect(resolveSpokenDate("day before yesterday, the 15th", TODAY)).toBe("2026-09-15");
  });

  it("refuses a phrase that only mentions the word", () => {
    expect(resolveSpokenDate("not yesterday", TODAY)).toBeNull();
  });

  it("still says nothing for a date it cannot be sure of", () => {
    // An explicit calendar date remains out of scope, and null is the honest
    // answer rather than a guess.
    expect(resolveSpokenDate("16 September", TODAY)).toBeNull();
    expect(resolveSpokenDate("", TODAY)).toBeNull();
  });

  it("leaves a named weekday alone", () => {
    expect(resolveSpokenDate("last friday", TODAY)).toBe("2026-09-11");
  });
});

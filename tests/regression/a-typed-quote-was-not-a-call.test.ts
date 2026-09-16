/**
 * A quote the contractor typed is not told it came from a phone call.
 *
 * The "check the spelling" hint was added for any customer field that arrived
 * pre-filled — which, after the first send, is true of a quote the contractor
 * typed themselves. So their own customer's name, email and site address came
 * back in warning red: "From the call — check the spelling. Tap to confirm."
 *
 * Reproduced on three typed jobs on 15 Sep (`8ba93302`, `8e89822a`,
 * `8f881709`), none of which had a voice session at any point, and it survived
 * hard reloads. Telling someone to double-check what they typed a minute ago is
 * the wrong direction of doubt — and on a product whose pitch is that it hears
 * the call correctly, it is the wrong claim as well.
 *
 * A transcript is what makes "from the call" true. Without one there is also
 * nothing to check the value against: `findSupportingSpan` answers
 * "unsupported" for every field, which would put "This isn't in the call" under
 * a name the contractor typed — louder, and wronger.
 */

import { describe, expect, it } from "vitest";
import { findSupportingSpan, voiceHintFields } from "@/lib/captured-detail";

describe("what a typed quote has to check against", () => {
  it("has nothing, and says so rather than claiming a match", () => {
    // The state the editor is in on a typed job: a value, and no transcript.
    const support = findSupportingSpan(null, "Sam Whitfield", "text");

    expect(support.kind, "no transcript cannot support anything").not.toBe("found");
  });

  it("finds the words when there genuinely was a call", () => {
    const support = findSupportingSpan(
      "It's for Sam Whitfield at the community centre.",
      "Sam Whitfield",
      "text",
    );

    expect(support.kind).toBe("found");
  });
});

describe("the editor's hint on a typed quote", () => {
  // The real gate the editor uses, not a copy of it — the defect was in this
  // condition, and a condition written inside a useState initialiser is
  // reachable only by rendering the whole editor.
  const TYPED = {
    name: "Sam Whitfield",
    email: "sam@example.com",
    address: "40 Green Lane",
  };

  it("shows none of them when there was no call", () => {
    expect(voiceHintFields(null, TYPED).size).toBe(0);
    expect(voiceHintFields(undefined, TYPED).size).toBe(0);
    expect(voiceHintFields("", TYPED).size).toBe(0);
    expect(voiceHintFields("   ", TYPED).size, "whitespace is not a call").toBe(0);
  });

  it("still shows them on a real voice job", () => {
    const hinted = voiceHintFields("It's for Sam Whitfield at 40 Green Lane.", TYPED);

    expect([...hinted].sort()).toEqual(["address", "email", "name"]);
  });

  it("never hints a field the call left blank", () => {
    // Nothing to mis-spell, so nothing to check.
    const hinted = voiceHintFields("It's for Sam Whitfield.", { name: "Sam Whitfield", email: "" });

    expect([...hinted]).toEqual(["name"]);
  });
});

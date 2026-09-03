import { describe, it, expect } from "vitest";
import { findSupportingSpan } from "@/lib/captured-detail";

// VOICE-5. The production case, reconstructed with the same shape and
// substitute digits — the real one is on job 30faef2a and does not belong in a
// test file.
//
// The transcript stated one number; the captured field carried another, and
// every other slot matched the call verbatim. That asymmetry is the whole
// signal, and it is what this helper has to surface.

const transcript = [
  "Right, so it's a ceiling skim, four metres by three.",
  "The customer is Megan Farrant.",
  "Her email is megfarrant@hotmail.com.",
  "Yeah, the contact number is 07479 556410.",
  "The address is 50 Holland Street, SE1 9FU.",
].join(" ");

describe("findSupportingSpan", () => {
  it("reports UNSUPPORTED for a number the call never said", () => {
    // The defect: captured 07647 955641, transcript says 07479 556410.
    const result = findSupportingSpan(transcript, "07647 955641", "phone");

    expect(result.kind).toBe("unsupported");
  });

  it("finds the number that WAS said, ignoring how it was spaced", () => {
    const result = findSupportingSpan(transcript, "07479556410", "phone");

    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.span).toContain("contact number");
  });

  it("finds a name, and the span carries the words around it", () => {
    const result = findSupportingSpan(transcript, "Megan Farrant");

    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.span).toBe("The customer is Megan Farrant.");
  });

  it("finds an email regardless of case", () => {
    expect(findSupportingSpan(transcript, "MegFarrant@Hotmail.com").kind).toBe("found");
  });

  it("finds an address whose parts are all present", () => {
    const result = findSupportingSpan(transcript, "50 Holland Street, SE1 9FU");

    expect(result.kind).toBe("found");
  });

  it("reports UNSUPPORTED for a name nobody mentioned", () => {
    expect(findSupportingSpan(transcript, "Sheila Brannigan").kind).toBe("unsupported");
  });

  it("says UNKNOWN rather than unsupported when there is no transcript", () => {
    // A hand-typed job has nothing to check against. That is not a warning —
    // claiming the value is unsupported there would cry wolf on every manual
    // quote and train the contractor to ignore the real one.
    expect(findSupportingSpan(null, "07479 556410", "phone").kind).toBe("unknown");
    expect(findSupportingSpan("", "Megan Farrant").kind).toBe("unknown");
  });

  it("says UNKNOWN for an empty value", () => {
    expect(findSupportingSpan(transcript, "").kind).toBe("unknown");
    expect(findSupportingSpan(transcript, null).kind).toBe("unknown");
  });

  it("will not match a phone on too few digits", () => {
    // "4" would otherwise match "four metres by three" and report support for
    // anything at all.
    expect(findSupportingSpan(transcript, "4", "phone").kind).toBe("unknown");
  });

  it("does not treat a partial digit run as support", () => {
    // Leading digits shared with the real number, then diverging. A substring
    // check on the value's prefix would wrongly pass this.
    expect(findSupportingSpan(transcript, "07479 000000", "phone").kind).toBe("unsupported");
  });

  it("matches a name split across the sentence by an interruption", () => {
    const messy = "The customer is Megan — sorry, Megan Farrant, two Rs? No, one.";

    expect(findSupportingSpan(messy, "Megan Farrant").kind).toBe("found");
  });
});

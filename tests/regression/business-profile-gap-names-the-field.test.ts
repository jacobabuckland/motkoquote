/**
 * The dashboard's business-profile warning must name the field that is
 * missing and the place it is set — not the category it belongs to.
 *
 * What it said: "Your business details are missing: business structure (sole
 * trader / ltd / etc.). Contracts sent without these will have gaps. Add them
 * in Setup." The field IS in there, after a colon, reading as a gloss on the
 * phrase that opens the sentence. What a reader takes from it is "business
 * details", so they go looking for business details — and that is where the
 * trail goes cold:
 *
 *   - All three fields the check requires (business address, business
 *     structure, payment terms) live in ONE Setup section, and it is titled
 *     "Legal & contract details" — not "Business details", which is what the
 *     banner sent them looking for.
 *   - That section is a Disclosure with defaultOpen={false}, so it is closed
 *     when they arrive.
 *   - The Disclosure's root carried no `id`, so "/setup#setup-legal" was not
 *     an anchor that resolved to anything and the link could only ever drop
 *     them at the top of six collapsed sections.
 *
 * So the banner named a category, pointed at a page, and left a contractor to
 * find one closed accordion whose title shares no words with the warning. On
 * 8 Sep a trade did exactly that, found the details he went looking for
 * already present, and concluded the app was broken.
 *
 * The check itself is correct and is not touched. Only what it says, and
 * where it points.
 */

import { describe, expect, it } from "vitest";

import {
  CONTRACT_PROFILE_FIELDS,
  SETUP_LEGAL_SECTION_HREF,
  SETUP_LEGAL_SECTION_TITLE,
  businessProfileGapMessage,
  missingContractProfileFields,
} from "@/lib/business-profile-gaps";

describe("which fields are missing", () => {
  it("reports nothing when all three are set", () => {
    const missing = missingContractProfileFields({
      registered_address: "12 Example Road, Norwich, NR1 1AA",
      business_structure: "Limited company",
      default_payment_terms: "Payment due within 14 days",
    });

    expect(missing).toEqual([]);
    expect(businessProfileGapMessage(missing)).toBeNull();
  });

  it("treats a whitespace-only value as missing", () => {
    // A field saved as spaces is not a field the contract can print.
    const missing = missingContractProfileFields({
      registered_address: "12 Example Road",
      business_structure: "   ",
      default_payment_terms: "14 days",
    });

    expect(missing.map((f) => f.key)).toEqual(["business_structure"]);
  });

  it("reports every missing field on an empty profile", () => {
    expect(missingContractProfileFields(null).map((f) => f.key)).toEqual(
      CONTRACT_PROFILE_FIELDS.map((f) => f.key),
    );
    expect(missingContractProfileFields({}).map((f) => f.key)).toEqual(
      CONTRACT_PROFILE_FIELDS.map((f) => f.key),
    );
  });
});

describe("the message names the field, not the category", () => {
  const messageFor = (profile: Record<string, string>) =>
    businessProfileGapMessage(missingContractProfileFields(profile)) ?? "";

  it("names the one field that is missing", () => {
    const message = messageFor({
      registered_address: "12 Example Road",
      default_payment_terms: "14 days",
    });

    expect(message).toContain("business structure");
  });

  it("does not open on the category the reader then goes hunting for", () => {
    // The exact phrasing that sent a trade looking for a "Business details"
    // section that does not exist. The field may be named; the CATEGORY must
    // not be the thing the sentence leads with.
    const message = messageFor({});

    expect(message).not.toMatch(/^your business details/i);
    expect(message).not.toMatch(/business details are missing/i);
  });

  it("lists two missing fields readably", () => {
    const message = messageFor({ business_structure: "Sole trader" });

    expect(message).toContain("business address and payment terms");
  });

  it("lists three missing fields readably", () => {
    expect(messageFor({})).toContain(
      "business address, business structure and payment terms",
    );
  });

  it("does not claim a document will be malformed, because it will not", () => {
    // "Contracts sent without these will have gaps" overstates it: every one
    // of these variables is section-wrapped in the templates, so an absent one
    // is omitted cleanly rather than leaving a hole. The cost is that the
    // contract does not state the thing, which is what the copy should say.
    expect(messageFor({})).not.toMatch(/gaps/i);
  });
});

describe("the link points at the section that actually holds these fields", () => {
  it("anchors to the Setup section rather than the top of the page", () => {
    expect(SETUP_LEGAL_SECTION_HREF).toBe("/setup#setup-legal");
  });

  it("names that section so the title matches what the contractor will see", () => {
    expect(SETUP_LEGAL_SECTION_TITLE).toBe("Legal & contract details");
  });

  it("puts every required field in that one section, so one link suffices", () => {
    // If a field ever moves to another section this fails, rather than the
    // link quietly pointing somewhere the field is not.
    for (const field of CONTRACT_PROFILE_FIELDS) {
      expect(field.setupHref).toBe(SETUP_LEGAL_SECTION_HREF);
    }
  });
});

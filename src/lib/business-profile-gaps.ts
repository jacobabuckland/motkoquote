// The three business-profile fields a contract cannot state without, and how
// to tell a contractor which one is missing.
//
// The check has always been right; what it SAID was the defect. The dashboard
// banner read "Your business details are missing: business structure (sole
// trader / ltd / etc.). Contracts sent without these will have gaps. Add them
// in Setup." The field is in there — after a colon, reading as a gloss on the
// phrase the sentence opens with — and what a reader carries away is "business
// details". So they go to Setup and look for business details.
//
// There is no such section. All three fields live in one Disclosure titled
// "Legal & contract details", which is closed by default, among five other
// closed sections. On 8 Sep a trade followed that link, found the details he
// had gone looking for already present, and concluded the app was broken.
//
// So: name the field in the words Setup uses for it, and link to the section
// that holds it rather than to the page that contains the section.

import type { BusinessProfile } from "@/lib/schemas/contract";

/** The Setup Disclosure holding all three fields. Its `id` is the anchor. */
export const SETUP_LEGAL_SECTION_ID = "setup-legal";
export const SETUP_LEGAL_SECTION_TITLE = "Legal & contract details";
export const SETUP_LEGAL_SECTION_HREF = `/setup#${SETUP_LEGAL_SECTION_ID}`;

export type ContractProfileField = {
  key: keyof BusinessProfile;
  /**
   * How the banner names it — lower case, so it reads inside a sentence, and
   * close enough to Setup's own field label that the contractor recognises the
   * input when they get there.
   */
  label: string;
  /** Where it is set. One link per field, in case they ever stop sharing one. */
  setupHref: string;
};

export const CONTRACT_PROFILE_FIELDS: ContractProfileField[] = [
  { key: "registered_address", label: "business address", setupHref: SETUP_LEGAL_SECTION_HREF },
  { key: "business_structure", label: "business structure", setupHref: SETUP_LEGAL_SECTION_HREF },
  { key: "default_payment_terms", label: "payment terms", setupHref: SETUP_LEGAL_SECTION_HREF },
];

/**
 * Which of the three the profile cannot supply.
 *
 * Whitespace counts as missing: a field saved as spaces is not a field the
 * contract can print, and the previous falsiness check let one through.
 */
export const missingContractProfileFields = (
  profile: Partial<Record<keyof BusinessProfile, unknown>> | null | undefined,
): ContractProfileField[] =>
  CONTRACT_PROFILE_FIELDS.filter(({ key }) => {
    const value = profile?.[key];
    return typeof value !== "string" || value.trim() === "";
  });

/** "a, b and c" — no serial comma, which is how the rest of the app reads. */
const readableList = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * The banner sentence, or null when nothing is missing.
 *
 * Two deliberate departures from the copy this replaces. It leads with the
 * FIELD rather than the category, because the category is what sent a
 * contractor hunting for a section that does not exist. And it drops "will
 * have gaps": every one of these variables is section-wrapped in the contract
 * templates, so an absent one is omitted cleanly — the cost is that the
 * contract does not state the thing, not that the document comes out broken,
 * and a warning that overstates its case is one people learn to ignore.
 */
export const businessProfileGapMessage = (
  missing: ContractProfileField[],
): string | null => {
  if (missing.length === 0) return null;
  const fields = readableList(missing.map((field) => field.label));
  const it = missing.length === 1 ? "it" : "them";
  return `Contracts you send won't state your ${fields}. Add ${it} here:`;
};

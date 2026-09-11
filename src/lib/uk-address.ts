/**
 * Deciding whether two written UK addresses are the SAME PLACE.
 *
 * WHY THIS EXISTS. The setup form cross-checks a contractor's stated address
 * against the one Companies House holds, and warned on any difference at all —
 * the comparison was `a.trim().replace(/\s+/g," ").toLowerCase() !== b...`, which
 * is string equality wearing a normaliser's coat. So this, reported 11 Sep:
 *
 *   Stated:     12 Malvern Road, NR1 4BA
 *   Registered: 12 Malvern Road, Norwich, NR1 4BA
 *
 * flagged "Registered address differs" against the same building. The trade had
 * left out the post town, which the postcode already determines. A warning that
 * fires on a correct address teaches people to ignore warnings, and this one asks
 * them to go and "fix" something that is not wrong.
 *
 * WHAT THE WARNING IS ACTUALLY FOR: catching a trade who has typed a DIFFERENT
 * address from the one their company is registered at — a stale office, a home
 * address, a typo in the number. It is not a formatting checker, and the
 * registered form is not the one they have to copy: the UI itself says to keep
 * their own value if it is a trading address.
 *
 * THE RULE. Two addresses match when their postcodes agree and one's remaining
 * words are contained in the other's. Containment rather than equality is the
 * whole point — the benign difference is always that one side says LESS (no post
 * town, no county, no country), and Companies House is the side that says more.
 *
 * A consequence worth stating plainly: "12 Malvern Road NR1 4BA" matches
 * "Flat B, 12 Malvern Road NR1 4BA". Same building, and a flat letter is not the
 * kind of difference this warning exists to raise. A different NUMBER, street or
 * postcode still is, because those are tokens the other side does not have.
 *
 * No environment access and no imports, so the client bundle can use it too —
 * `setup-form.tsx` needs the same answer as the two server paths, and having
 * three copies of the rule is how they came to disagree in the first place.
 */

/** Words that carry no address information and appear on one side or neither. */
const NOISE_TOKENS = new Set(["uk", "gb", "england", "scotland", "wales"]);

/**
 * Written-out forms mapped onto their abbreviation, so "Road" and "Rd" are one
 * token. Everything collapses to the SHORT form; which direction does not matter
 * as long as it is the same for both addresses.
 *
 * `saint` and `street` deliberately share `st`, because a bare "St" in an address
 * is genuinely ambiguous — "St Peters Road" and "High St" both use it — and no
 * reading of the two letters is available from the text alone. The cost is that
 * "Saint Road" would match "Street Road"; the benefit is that "St Peters Road"
 * matches "Saint Peters Road", which is a real thing people type.
 */
const TOKEN_SYNONYMS: Record<string, string> = {
  road: "rd",
  street: "st",
  saint: "st",
  avenue: "ave",
  av: "ave",
  lane: "ln",
  drive: "dr",
  court: "ct",
  place: "pl",
  square: "sq",
  close: "cl",
  terrace: "ter",
  terr: "ter",
  crescent: "cres",
  gardens: "gdns",
  garden: "gdns",
  park: "pk",
  building: "bldg",
  buildings: "bldg",
  house: "hse",
  flat: "flt",
  apartment: "apt",
  apartments: "apt",
  suite: "ste",
  yard: "yd",
  mount: "mt",
};

/**
 * UK postcode, outward then inward. Tolerates a missing or repeated space, which
 * is the usual way it is mistyped.
 */
const POSTCODE_PATTERN = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/**
 * The postcode in canonical `NR1 4BA` form, or null when the text has none.
 *
 * Null means "no postcode found", never "no postcode present" — an address may
 * legitimately be written without one, and the caller treats that as "cannot
 * compare on this" rather than as a difference.
 */
export const normalizeUkPostcode = (address: string): string | null => {
  const match = POSTCODE_PATTERN.exec(address);
  if (!match) return null;
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
};

/** The address with its postcode, punctuation and noise words taken out. */
const meaningfulTokens = (address: string): string[] =>
  address
    .replace(POSTCODE_PATTERN, " ")
    // "United Kingdom" as a phrase, before tokenising — neither word is safe to
    // drop on its own.
    .replace(/\bunited\s+kingdom\b/gi, " ")
    .toLowerCase()
    // Punctuation to spaces rather than nothing, so "12,Malvern" is two tokens.
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token !== "" && !NOISE_TOKENS.has(token))
    .map((token) => TOKEN_SYNONYMS[token] ?? token);

/** Token counts, so "12 High St" and "12 12 High St" are not the same. */
const countTokens = (tokens: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
};

/** Whether every token in `subset` appears in `superset`, as often as it needs to. */
const isContainedIn = (subset: Map<string, number>, superset: Map<string, number>): boolean => {
  for (const [token, count] of subset) {
    if ((superset.get(token) ?? 0) < count) return false;
  }
  return true;
};

/**
 * Whether two written addresses describe the same place.
 *
 * Returns true when they agree, so the caller warns on `!addressesMatch(...)`.
 *
 * An address with nothing comparable in it — empty, or only punctuation — returns
 * true. Nothing has been shown to differ, and a warning is a claim that something
 * has.
 */
export const addressesMatch = (stated: string, registered: string): boolean => {
  const statedPostcode = normalizeUkPostcode(stated);
  const registeredPostcode = normalizeUkPostcode(registered);

  // The one difference that is decisive on its own. Where only one side has a
  // postcode there is nothing to disagree with, so the tokens decide.
  if (statedPostcode && registeredPostcode && statedPostcode !== registeredPostcode) {
    return false;
  }

  const statedTokens = countTokens(meaningfulTokens(stated));
  const registeredTokens = countTokens(meaningfulTokens(registered));

  if (statedTokens.size === 0 || registeredTokens.size === 0) return true;

  return (
    isContainedIn(statedTokens, registeredTokens) ||
    isContainedIn(registeredTokens, statedTokens)
  );
};

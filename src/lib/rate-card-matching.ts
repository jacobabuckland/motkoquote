import type { LineItem } from "@/lib/schemas/job";

export type RateCard = {
  work_type: string;
  unit: string;
  rate_per_unit: number;
  complexity_notes: string | null;
};

export const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Deterministically finds a contractor rate card referenced by a line
// item's description. Token-overlap match rather than exact-string match,
// since the model phrases descriptions in its own words (e.g.
// "Plastering – skim coat, living room" vs a rate card work_type of
// "skim coat plastering"). Requires every word of the rate card's
// work_type to appear in the description, so a short/generic rate card
// (e.g. "labour") can't accidentally match everything.
export const findMatchingRateCard = (
  description: string,
  rateCards: RateCard[],
): RateCard | undefined => {
  const descTokens = new Set(normalize(description).split(" ").filter(Boolean));
  return rateCards.find((card) => {
    const cardTokens = normalize(card.work_type).split(" ").filter(Boolean);
    return cardTokens.length > 0 && cardTokens.every((token) => descTokens.has(token));
  });
};

// Applies the rate-cards-first policy for assumable values deterministically,
// rather than relying on the LLM to have followed the "use rate_cards when
// they match" prompt instruction. Any line item whose description matches a
// contractor rate card gets that card's exact unit/rate_per_unit and is
// marked assumed:false — a confirmed, contractor-owned number always wins
// over whatever the model guessed. Lines with no match are left untouched
// (still whatever the model proposed, assumed or not).
export const applyRateCards = (lineItems: LineItem[], rateCards: RateCard[]): LineItem[] =>
  lineItems.map((item) => {
    const match = findMatchingRateCard(item.description, rateCards);
    if (!match) return item;
    return {
      ...item,
      unit: match.unit,
      unit_price: match.rate_per_unit,
      assumed: false,
      assumption_note: undefined,
    };
  });

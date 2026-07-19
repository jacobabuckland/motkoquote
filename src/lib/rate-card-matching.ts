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

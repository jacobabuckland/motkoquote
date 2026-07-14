import type { LineItem } from "@/lib/schemas/job";
import { normalize } from "@/lib/rate-card-matching";

export type LabourRates = {
  day_rate: number | null;
  overtime_rate: number | null;
  team_members: { name: string; day_rate: number | null }[];
};

// Deterministically sets unit_price on labour line items from the
// contractor's actual stored rates (day_rate / overtime_rate / a named team
// member's day_rate) — don't trust the LLM to have correctly folded team
// size and day rate into a single unit_price itself, even though the prompt
// tells it to use the contractor's rates. The LLM only supplies structure
// (quantity = days, people_count = team size, overtime = flag);
// lineItemTotal (quote-math.ts) does the actual multiplication. Whatever
// unit_price the LLM proposed for a labour line is discarded here in favour
// of the looked-up rate, so a mismatched or hallucinated LLM total can never
// reach the customer. Only quantity/people_count/assumed are left as the
// LLM set them — those describe a job-specific guess (how many days, how
// many people), not the rate itself, which is a confirmed contractor number
// whenever one is on file.
export const applyLabourRates = (
  lineItems: LineItem[],
  rates: LabourRates,
): LineItem[] =>
  lineItems.map((item) => {
    if (item.category !== "labour") return item;

    const descTokens = new Set(normalize(item.description).split(" ").filter(Boolean));
    const matchedMember = rates.team_members.find((member) => {
      const memberTokens = normalize(member.name).split(" ").filter(Boolean);
      return memberTokens.length > 0 && memberTokens.every((token) => descTokens.has(token));
    });

    const standardRate = matchedMember?.day_rate ?? rates.day_rate;
    const rate = item.overtime ? (rates.overtime_rate ?? standardRate) : standardRate;

    // No known rate to reconcile against (e.g. contractor hasn't set a
    // day_rate and no team member matched) — leave the LLM's guess in
    // place, still whatever assumed/assumption_note it set.
    if (rate == null) return item;

    return { ...item, unit_price: rate };
  });

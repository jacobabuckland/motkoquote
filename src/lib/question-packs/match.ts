import type { QuestionPack, SlotDef } from "@/lib/schemas/question-pack";
import { QUESTION_PACKS } from "@/lib/question-packs/packs";
import { classifyJobType } from "@/lib/question-packs/classify";

const normalize = (value: string) => value.trim().toLowerCase();

// Looks up the question pack for a job_type by classifying both the input and
// each pack's own job_type into the closed vocabulary, then matching on
// category. This replaces the old exact-string compare so synonyms the model
// actually says ("spotlights", "boiler swap", "rewiring") resolve to the right
// pack. A job_type that classifies to "general" never matches a pack — it's the
// generic, pack-less flow by definition. Returns undefined when no pack covers
// the category, which callers use to fall back to the generic voice flow
// instead of failing the call.
export const matchJobTypeToPack = (jobType: string): QuestionPack | undefined => {
  const category = classifyJobType(jobType);
  if (category === "general") return undefined;
  return QUESTION_PACKS.find((pack) => classifyJobType(pack.job_type) === category);
};

export type ResolvedSlotDefault = {
  value: string | number | boolean;
  source: "rate_card" | "pack_default";
};

// Rate-cards-first resolution for an "assumable" slot the contractor never
// answered: a confirmed contractor rate card (matched on work_type against
// the slot's key/label) always wins over the pack's own static
// default_value. Returns undefined if neither is available, meaning the
// slot genuinely has no safe default and should surface as a gap.
export const resolveSlotDefault = (
  slot: SlotDef,
  rateCards: { work_type: string; rate_per_unit: number }[],
): ResolvedSlotDefault | undefined => {
  const match = rateCards.find(
    (card) =>
      normalize(card.work_type) === normalize(slot.key) ||
      normalize(card.work_type) === normalize(slot.label),
  );
  if (match) return { value: match.rate_per_unit, source: "rate_card" };
  if (slot.default_value !== undefined) return { value: slot.default_value, source: "pack_default" };
  return undefined;
};

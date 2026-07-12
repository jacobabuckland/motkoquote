import type { QuestionPack, SlotDef } from "@/lib/schemas/question-pack";
import { QUESTION_PACKS } from "@/lib/question-packs/packs";

const normalize = (value: string) => value.trim().toLowerCase();

// Looks up the question pack for a classified job_type by normalized exact
// match. Returns undefined when the job type isn't covered by any pack —
// callers use that to decide whether to fall back to the generic,
// pack-less voice flow instead of failing the call.
export const matchJobTypeToPack = (jobType: string): QuestionPack | undefined =>
  QUESTION_PACKS.find((pack) => normalize(pack.job_type) === normalize(jobType));

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

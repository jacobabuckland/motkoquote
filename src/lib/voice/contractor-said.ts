/**
 * What the CONTRACTOR said, as one string, for asking whether they mentioned
 * something at all.
 *
 * Deliberately separate from the extractors. They read structure out of the
 * words -- a price, a count -- and this reads nothing: it answers one question,
 * "did they say this", for a guard that must not invent an answer when the
 * words are missing.
 *
 * ONLY THE CONTRACTOR. The assistant's half of the call is not evidence of
 * anything the contractor wants, and this is the same lesson #832 learned on
 * counts: Motko repeating a number back was read as the contractor stating it.
 * Worse here than there -- an assistant that suggests "and the usual
 * consumables?" would, read whole, be the very sentence that authorises the
 * line nobody asked for.
 *
 * Falls back to the flat transcript when turns are absent or in the legacy
 * July-2026 shape, which is what `turnsAreValid` tests and how both extractors
 * behave on the same input.
 */

import { turnsAreValid } from "@/lib/voice/stated-prices";
import type { TranscriptTurn } from "@/lib/voice-transcript";

export function contractorSaid(
  transcript: string | null | undefined,
  turns?: TranscriptTurn[] | null,
): string {
  const flat = transcript ?? "";
  if (!turnsAreValid(turns ?? undefined)) return flat;

  const mine = (turns ?? [])
    .filter((turn) => turn.speaker === "contractor")
    .map((turn) => turn.text)
    .join(" ");

  // A call with turns but no contractor turn in them is not a contractor who
  // said nothing -- it is a capture we cannot read. Fall back rather than
  // report silence, because silence is what makes the guard downstream fire.
  return mine.trim().length > 0 ? mine : flat;
}

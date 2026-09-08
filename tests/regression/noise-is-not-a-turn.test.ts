/**
 * A breath is not a contractor turn.
 *
 * Reproduced exactly, on job f453b3ae (8 Sep):
 *
 *   1. assistant   (37) "Alright Jake — tell me about the job."
 *   2. contractor  ( 1)  아
 *   3. assistant   (37) "Alright Jake — tell me about the job."   ← verbatim repeat
 *   4. contractor  (197) the real answer
 *
 * The one-character turn is U+C544, a Korean syllable, transcribed from a
 * breath — and the session already pins transcription to English precisely
 * because auto-detect "mis-fires on names, trade jargon and short utterances"
 * (see realtime.ts). The pin did not save it, so a length or language hint is
 * not where this gets caught.
 *
 * WHAT THIS FIXES AND WHAT IT DOES NOT. It stops the noise being RECORDED: the
 * turn never reaches `conversation_json`, the flat `jobs.transcript`, or
 * `extractStatedPrices`, which reads contractor speech looking for figures. A
 * single Hangul syllable is harmless there; "Thank you." or "you", which is
 * what Whisper-family models more usually hallucinate on silence, is not
 * harmless, and it is the same event.
 *
 * It does NOT stop the model re-greeting. That turn is created by the Realtime
 * server's semantic_vad and answered before this code sees anything, and the
 * only lever is VAD eagerness — which job-intake.tsx's own threshold comment
 * says in terms must not be tuned on a hunch: "capture micLevel in a quiet room
 * and a busy one first, or the next value is as arbitrary as this one."
 *
 * The rule is CONTENT, not length. "No" is two characters and is an answer;
 * "10" is an answer. A turn with no Latin letter and no digit carries nothing
 * an English-only intake can use.
 */

import { describe, expect, it } from "vitest";

import { appendTranscriptTurn, carriesContent } from "@/lib/voice-transcript";

const at = "2026-09-08T07:00:00.000Z";
const contractorEvent = (text: string) => ({
  eventType: "conversation.item.input_audio_transcription.completed",
  text,
  at,
});

describe("what counts as content", () => {
  it("rejects the exact production case", () => {
    expect(carriesContent("아")).toBe(false);
  });

  it("rejects the shapes a transcriber emits from silence", () => {
    for (const noise of ["", " ", "   ", ".", "…", "-", "?", "!", ". .", "♪"]) {
      expect(carriesContent(noise), JSON.stringify(noise)).toBe(false);
    }
  });

  it("does NOT claim to catch a lettered sentinel like [BLANK_AUDIO]", () => {
    // Pinning the rule's limit rather than pretending it has none. A sentinel
    // spelled with Latin letters is indistinguishable from speech under a
    // content test, and a special-case list for one that has never appeared in
    // this app's production data would be built on an unmeasured premise. If
    // one shows up, that is a measured follow-up, not a guess today.
    expect(carriesContent("[BLANK_AUDIO]")).toBe(true);
  });

  it("keeps a short answer, because short is not the same as empty", () => {
    // The whole reason the rule is about content rather than length: these are
    // real answers to real questions and a length cut-off would eat them.
    for (const answer of ["No", "Yes", "10", "2", "Me", "£500", "3 days", "Dan"]) {
      expect(carriesContent(answer), answer).toBe(true);
    }
  });

  it("keeps a word wrapped in punctuation", () => {
    expect(carriesContent("...yes.")).toBe(true);
    expect(carriesContent("  Ten.  ")).toBe(true);
  });
});

describe("a noise turn never reaches the record", () => {
  it("drops it rather than appending it", () => {
    const turns = appendTranscriptTurn([], contractorEvent("아"));

    expect(turns).toEqual([]);
  });

  it("returns the same array, so nothing downstream sees a change", () => {
    const existing = [{ speaker: "contractor" as const, text: "Two bedrooms", at }];

    expect(appendTranscriptTurn(existing, contractorEvent(" . "))).toBe(existing);
  });

  it("drops an assistant turn of pure noise too", () => {
    const turns = appendTranscriptTurn([], {
      eventType: "response.output_audio_transcript.done",
      text: "…",
      at,
    });

    expect(turns).toEqual([]);
  });

  it("leaves the conversation it was dropped from otherwise intact", () => {
    // The production sequence, minus the breath: the opener, the repeat the
    // breath provoked, and the real answer. Only turn 2 goes.
    let turns = appendTranscriptTurn([], {
      eventType: "response.output_audio_transcript.done",
      text: "Alright Jake — tell me about the job.",
      at,
    });
    turns = appendTranscriptTurn(turns, contractorEvent("아"));
    turns = appendTranscriptTurn(turns, {
      eventType: "response.output_audio_transcript.done",
      text: "Alright Jake — tell me about the job.",
      at,
    });
    turns = appendTranscriptTurn(turns, contractorEvent("Two bedrooms and the landing."));

    expect(turns.map((t) => t.speaker)).toEqual(["assistant", "assistant", "contractor"]);
    expect(turns.map((t) => t.text)).toEqual([
      "Alright Jake — tell me about the job.",
      "Alright Jake — tell me about the job.",
      "Two bedrooms and the landing.",
    ]);
  });

  it("still records every real turn of a normal call", () => {
    // Guarding the guard: a rule that quietly ate real speech would be far
    // worse than the noise it removes.
    const spoken = [
      "Two bedrooms and the landing, skim and make good.",
      "Me, Dan and Liam.",
      "Ten days.",
      "No.",
    ];
    const turns = spoken.reduce(
      (acc, text) => appendTranscriptTurn(acc, contractorEvent(text)),
      [] as ReturnType<typeof appendTranscriptTurn>,
    );

    expect(turns.map((t) => t.text)).toEqual(spoken);
  });
});

import { describe, it, expect } from "vitest";
import {
  appendTranscriptTurn,
  flatTranscript,
  speakerForTranscriptEvent,
  type TranscriptTurn,
} from "./voice-transcript";

describe("speakerForTranscriptEvent", () => {
  it("labels a completed input transcription as the contractor", () => {
    expect(
      speakerForTranscriptEvent(
        "conversation.item.input_audio_transcription.completed",
      ),
    ).toBe("contractor");
  });

  it("labels a done output transcript as the assistant", () => {
    expect(speakerForTranscriptEvent("response.output_audio_transcript.done")).toBe(
      "assistant",
    );
  });

  it("returns null for any other event type", () => {
    expect(speakerForTranscriptEvent("response.output_audio.delta")).toBeNull();
    expect(speakerForTranscriptEvent("input_audio_buffer.speech_started")).toBeNull();
    expect(speakerForTranscriptEvent("")).toBeNull();
  });
});

describe("appendTranscriptTurn", () => {
  it("appends a contractor turn for an input-transcription event", () => {
    const out = appendTranscriptTurn([], {
      eventType: "conversation.item.input_audio_transcription.completed",
      text: "Two of us on site.",
      at: "2026-08-13T10:00:00.000Z",
    });
    expect(out).toEqual([
      {
        speaker: "contractor",
        text: "Two of us on site.",
        at: "2026-08-13T10:00:00.000Z",
      },
    ]);
  });

  it("appends an assistant turn for an output-transcript event", () => {
    const out = appendTranscriptTurn([], {
      eventType: "response.output_audio_transcript.done",
      text: "How many are on the crew?",
      at: "2026-08-13T10:00:01.000Z",
    });
    expect(out).toEqual([
      {
        speaker: "assistant",
        text: "How many are on the crew?",
        at: "2026-08-13T10:00:01.000Z",
      },
    ]);
  });

  it("preserves ordering across an alternating conversation", () => {
    let turns: TranscriptTurn[] = [];
    turns = appendTranscriptTurn(turns, {
      eventType: "response.output_audio_transcript.done",
      text: "How many are on the crew?",
      at: "2026-08-13T10:00:00.000Z",
    });
    turns = appendTranscriptTurn(turns, {
      eventType: "conversation.item.input_audio_transcription.completed",
      text: "Just me.",
      at: "2026-08-13T10:00:01.000Z",
    });
    turns = appendTranscriptTurn(turns, {
      eventType: "response.output_audio_transcript.done",
      text: "And who supplies the materials?",
      at: "2026-08-13T10:00:02.000Z",
    });
    expect(turns.map((t) => t.speaker)).toEqual([
      "assistant",
      "contractor",
      "assistant",
    ]);
    expect(turns.map((t) => t.text)).toEqual([
      "How many are on the crew?",
      "Just me.",
      "And who supplies the materials?",
    ]);
  });

  it("ignores non-transcript events without mutating the input", () => {
    const turns: TranscriptTurn[] = [
      { speaker: "contractor", text: "Hello.", at: "2026-08-13T10:00:00.000Z" },
    ];
    const out = appendTranscriptTurn(turns, {
      eventType: "response.output_audio.delta",
      text: "ignored",
      at: "2026-08-13T10:00:01.000Z",
    });
    expect(out).toBe(turns);
    expect(turns).toHaveLength(1);
  });

  it("does not mutate the input array on a successful append", () => {
    const turns: TranscriptTurn[] = [];
    appendTranscriptTurn(turns, {
      eventType: "conversation.item.input_audio_transcription.completed",
      text: "x",
      at: "2026-08-13T10:00:00.000Z",
    });
    expect(turns).toHaveLength(0);
  });
});

describe("flatTranscript — byte-for-byte match with the historical flat string", () => {
  // The old code did `transcriptRef.current.push(data.transcript)` for exactly
  // the two recognised event types, then `join("\n")`. Building the structured
  // turns from the same event stream and flattening must reproduce that string
  // character-for-character, so `jobs.transcript` is unchanged.
  it("equals the legacy push-then-join over the same event stream", () => {
    const stream = [
      {
        eventType: "response.output_audio_transcript.done",
        text: "How many are on the crew?",
      },
      {
        eventType: "conversation.item.input_audio_transcription.completed",
        text: "Just me.",
      },
      {
        eventType: "response.output_audio_transcript.done",
        text: "Fixed price or day rate?",
      },
      {
        eventType: "conversation.item.input_audio_transcription.completed",
        text: "Fixed, twelve hundred.",
      },
    ];

    // Legacy accumulation: flat push for every recognised event.
    const legacyFlat = stream.map((e) => e.text).join("\n");

    // New accumulation: structured turns, then flattened.
    let turns: TranscriptTurn[] = [];
    for (const e of stream) {
      turns = appendTranscriptTurn(turns, {
        eventType: e.eventType,
        text: e.text,
        at: "2026-08-13T10:00:00.000Z",
      });
    }
    expect(flatTranscript(turns)).toBe(legacyFlat);
  });

  it("preserves empty lines and internal newlines exactly", () => {
    const turns: TranscriptTurn[] = [
      { speaker: "assistant", text: "line one\nstill one", at: "t" },
      { speaker: "contractor", text: "", at: "t" },
      { speaker: "assistant", text: "line three", at: "t" },
    ];
    expect(flatTranscript(turns)).toBe("line one\nstill one\n\nline three");
  });

  it("is an empty string for no turns", () => {
    expect(flatTranscript([])).toBe("");
  });
});

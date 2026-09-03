/**
 * PFIX-2: The assistant's misheard read-back can overwrite the contractor's price
 *
 * The stated-price extractor is handed speaker-labelled turns rather than
 * the flat transcript alone, so it can distinguish contractor speech from
 * assistant read-backs. Only contractor turns may be the source of a stated
 * price; an assistant turn is at most confirmation, never a new price or a
 * supersession.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
import type { TranscriptTurn } from "@/lib/voice-transcript";

describe("PFIX-2: speaker-aware price extraction", () => {
  it("does not extract a price spoken only by the assistant", () => {
    const transcript = "The consumer unit will be two hundred and fifty pounds.";
    const turns: TranscriptTurn[] = [
      {
        speaker: "assistant",
        text: "The consumer unit will be two hundred and fifty pounds.",
        at: "2026-09-03T10:00:00Z",
      },
    ];

    const prices = extractStatedPrices(transcript, turns);

    // No contractor turn with a price, so nothing extracted
    expect(prices).toEqual([]);
  });

  it("keeps the contractor's figure when the assistant reads back a different amount", () => {
    // Reproduction: contractor says £520, assistant mishears and reads back £250
    const transcript =
      "The consumer unit is five hundred and twenty pounds. " +
      "So that's two hundred and fifty pounds for the consumer unit.";

    const turns: TranscriptTurn[] = [
      {
        speaker: "contractor",
        text: "The consumer unit is five hundred and twenty pounds.",
        at: "2026-09-03T10:00:00Z",
      },
      {
        speaker: "assistant",
        text: "So that's two hundred and fifty pounds for the consumer unit.",
        at: "2026-09-03T10:00:05Z",
      },
    ];

    const prices = extractStatedPrices(transcript, turns);

    // Only the contractor's £520 is extracted, not superseded
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      amount: 52000, // amounts in pence
      item: expect.stringMatching(/consumer unit/i),
      superseded_by: null,
    });

    // The assistant's misheard £250 must not appear
    const amounts = prices.map((p) => p.amount);
    expect(amounts).not.toContain(25000);
  });

  it("preserves supersession when the contractor corrects their own figure", () => {
    const transcript =
      "The labour will be four hundred pounds. " +
      "Actually, make that five hundred pounds.";

    const turns: TranscriptTurn[] = [
      {
        speaker: "contractor",
        text: "The labour will be four hundred pounds.",
        at: "2026-09-03T10:00:00Z",
      },
      {
        speaker: "contractor",
        text: "Actually, make that five hundred pounds.",
        at: "2026-09-03T10:00:10Z",
      },
    ];

    const prices = extractStatedPrices(transcript, turns);

    // Two prices: £400 superseded by £500, and £500 current
    expect(prices).toHaveLength(2);

    const superseded = prices.find((p) => p.amount === 40000); // amounts in pence
    expect(superseded).toBeDefined();
    expect(superseded?.superseded_by).toBe(50000);

    const current = prices.find((p) => p.amount === 50000);
    expect(current).toBeDefined();
    expect(current?.superseded_by).toBeNull();
  });

  it("records a correctly confirmed price once, not twice", () => {
    const transcript =
      "The callout is eighty pounds. " +
      "Perfect, eighty pounds for the callout.";

    const turns: TranscriptTurn[] = [
      {
        speaker: "contractor",
        text: "The callout is eighty pounds.",
        at: "2026-09-03T10:00:00Z",
      },
      {
        speaker: "assistant",
        text: "Perfect, eighty pounds for the callout.",
        at: "2026-09-03T10:00:03Z",
      },
    ];

    const prices = extractStatedPrices(transcript, turns);

    // One price: £80 from the contractor turn
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      amount: 8000, // amounts in pence
      item: expect.stringMatching(/callout/i),
      superseded_by: null,
    });
  });

  it("falls back to flat-transcript extraction when turns are absent", () => {
    const transcript = "The materials will be three hundred pounds.";

    // No turns provided — legacy job or manual entry
    const prices = extractStatedPrices(transcript);

    // Still extracts the price, as it does today
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      amount: 30000, // amounts in pence
      item: expect.stringMatching(/materials/i),
      superseded_by: null,
    });
  });

  it("falls back when turns use the old shape (no timestamp)", () => {
    const transcript = "The first fix is two hundred pounds.";

    // Five legacy jobs from July 2026 persist { speaker, text } without `at`
    const oldShapeTurns = [
      { speaker: "contractor" as const, text: "The first fix is two hundred pounds." },
    ];

    // The function should detect the missing `at` field and fall back
    // rather than throwing or producing wrong results
    const prices = extractStatedPrices(transcript, oldShapeTurns as unknown as TranscriptTurn[]);

    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      amount: 20000, // amounts in pence
      superseded_by: null,
    });
  });

  it("handles a mix of contractor and assistant turns with multiple items", () => {
    const transcript =
      "The consumer unit is five hundred pounds. " +
      "Got it, five hundred for the consumer unit. " +
      "And the labour is three hundred. " +
      "So three hundred pounds for labour.";

    const turns: TranscriptTurn[] = [
      {
        speaker: "contractor",
        text: "The consumer unit is five hundred pounds.",
        at: "2026-09-03T10:00:00Z",
      },
      {
        speaker: "assistant",
        text: "Got it, five hundred for the consumer unit.",
        at: "2026-09-03T10:00:03Z",
      },
      {
        speaker: "contractor",
        text: "And the labour is three hundred.",
        at: "2026-09-03T10:00:08Z",
      },
      {
        speaker: "assistant",
        text: "So three hundred pounds for labour.",
        at: "2026-09-03T10:00:11Z",
      },
    ];

    const prices = extractStatedPrices(transcript, turns);

    // Two prices: £500 for consumer unit, £300 for labour
    expect(prices).toHaveLength(2);

    const consumerUnitPrice = prices.find((p) => p.amount === 50000); // amounts in pence
    expect(consumerUnitPrice).toBeDefined();
    expect(consumerUnitPrice?.item).toMatch(/consumer unit/i);
    expect(consumerUnitPrice?.superseded_by).toBeNull();

    const labourPrice = prices.find((p) => p.amount === 30000);
    expect(labourPrice).toBeDefined();
    expect(labourPrice?.item).toMatch(/labour/i);
    expect(labourPrice?.superseded_by).toBeNull();
  });

  it("ignores the assistant's different read-back even when it comes later", () => {
    // Edge case: the assistant's incorrect echo appears after the contractor's
    // correct statement, but must not supersede it
    const transcript =
      "Materials are one hundred and fifty pounds. " +
      "Okay, materials at one hundred and five pounds.";

    const turns: TranscriptTurn[] = [
      {
        speaker: "contractor",
        text: "Materials are one hundred and fifty pounds.",
        at: "2026-09-03T10:00:00Z",
      },
      {
        speaker: "assistant",
        text: "Okay, materials at one hundred and five pounds.",
        at: "2026-09-03T10:00:04Z",
      },
    ];

    const prices = extractStatedPrices(transcript, turns);

    // One price: £150 from contractor, not superseded
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      amount: 15000, // amounts in pence
      superseded_by: null,
    });

    // The assistant's £105 must not appear
    const amounts = prices.map((p) => p.amount);
    expect(amounts).not.toContain(10500);
  });

  it("handles contractor repeating their own price for emphasis", () => {
    const transcript =
      "The total is six hundred pounds. " +
      "Yes, six hundred pounds total.";

    const turns: TranscriptTurn[] = [
      {
        speaker: "contractor",
        text: "The total is six hundred pounds.",
        at: "2026-09-03T10:00:00Z",
      },
      {
        speaker: "contractor",
        text: "Yes, six hundred pounds total.",
        at: "2026-09-03T10:00:05Z",
      },
    ];

    const prices = extractStatedPrices(transcript, turns);

    // One price: £600, not a supersession (same amount restated)
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      amount: 60000, // amounts in pence
      superseded_by: null,
    });
  });
});

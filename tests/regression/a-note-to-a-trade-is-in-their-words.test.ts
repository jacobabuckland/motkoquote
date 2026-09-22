/**
 * "BEFORE YOU SEND (7)" on motko.app, 21 Sep, on a plasterer's quote:
 *
 *     The £48 delivery has a locked price applied in code. The £65 delivery
 *     has been estimated at 6500p
 *
 * `6500p` on a screen where every other figure reads `£65.00`, and "applied in
 * code" addressed to a plasterer.
 *
 * NEITHER PHRASE IS IN THE APP. `contractor_flags` is `z.array(z.string())`
 * with no content constraint, authored by the drafting model and rendered
 * verbatim in the editor — so the model read `estimated_unit_cost_pence` and
 * its own system prompt ("the locked prices will be applied in code") and
 * wrote both back out to the contractor. Nothing stood between it and the
 * screen.
 *
 * The flag is a private note TO A TRADESPERSON. One that names the machinery
 * is not a note to them — it is the app talking to itself in front of them,
 * and it is never actionable, because every mechanical fact it can state is
 * already stated properly by a deterministic flag beside it.
 *
 * The same complaint covered "has no provenance. All lines must be sourced
 * from the transcript" at send time. That one IS the app's own copy, and is
 * reworded here; its prefix is a machine key matched in three places
 * (`withStatedPriceFlag`, `reconcileUnpricedFlags`, the editor's split), so
 * the prefix stays and only the sentence changes.
 */
import { describe, expect, it } from "vitest";
import {
  keepContractorFlags,
  namesTheMachinery,
} from "@/lib/contractor-flag-vocabulary";
import { parseQuoteDraft } from "@/lib/schemas/job";
import {
  AMOUNT_MISMATCH_PREFIX,
  UNSOURCED_LINE_PREFIX,
  splitReconciliationFailures,
  unsourcedLineFlag,
} from "@/lib/stated-price-guard";

describe("a flag that names the machinery", () => {
  it("drops the one reported, verbatim", () => {
    const reported =
      "The £48 delivery has a locked price applied in code. The £65 delivery " +
      "has been estimated at 6500p";

    expect(namesTheMachinery(reported)).toBe(true);
    expect(keepContractorFlags([reported])).toEqual([]);
  });

  it("drops a pounds-and-up amount written in pence", () => {
    // £1 or more expressed in pence is a field value, never how anyone writes
    // money. Below that it is ordinary English — see the counter-case below.
    expect(namesTheMachinery("Delivery estimated at 6500p")).toBe(true);
    expect(namesTheMachinery("Waste carrier levy is 900p per load")).toBe(true);
  });

  it("drops a snake_case field name", () => {
    // A tradesperson's note does not contain an identifier. This is the general
    // marker — it catches estimated_unit_cost_pence, rate_card_id, supplied_by
    // and whatever the next prompt revision names, without listing them.
    expect(namesTheMachinery("No estimated_unit_cost_pence for the skip")).toBe(true);
    expect(namesTheMachinery("Matched against rate_card_id 4")).toBe(true);
  });

  it("drops the app describing its own handling", () => {
    expect(namesTheMachinery("The locked price is applied in code")).toBe(true);
    expect(namesTheMachinery("This line has no provenance")).toBe(true);
  });
});

describe("what a tradesperson actually needs, which must survive", () => {
  const real = [
    "A mate is helping Tuesday — confirm their day rate before you send.",
    "The skip needs a permit for a shared driveway; worth checking with the council.",
    "Access is scaffold-only above the porch — price the extra day if you need it.",
    // Money in pounds, including a genuine sub-pound amount, which is the one
    // place a "p" suffix is how a person really writes it.
    "You charged £130.00 per delivery last time.",
    "The trade counter adds 50p a bag on small orders.",
  ];

  for (const flag of real) {
    it(`keeps "${flag.slice(0, 40)}…"`, () => {
      expect(namesTheMachinery(flag)).toBe(false);
    });
  }

  it("keeps them all through the filter, in order", () => {
    expect(keepContractorFlags(real)).toEqual(real);
  });

  it("removes only the offending one from a mixed list", () => {
    const mixed = [real[0]!, "Estimated at 6500p", real[1]!];

    expect(keepContractorFlags(mixed)).toEqual([real[0]!, real[1]!]);
  });
});

describe("the model's output, at the boundary where it becomes app data", () => {
  const line = {
    kind: "material" as const,
    description: "Material delivery",
    quantity: 1,
    unit: "delivery",
    estimated_unit_cost_pence: 6500,
    supplied_by: "contractor" as const,
  };

  it("never lets a job-wide flag naming the machinery through", () => {
    const { draft } = parseQuoteDraft({
      line_items: [line],
      contractor_flags: [
        "The £65 delivery has been estimated at 6500p",
        "A mate is helping Tuesday — confirm their day rate.",
      ],
    });

    expect(draft.contractor_flags).toEqual([
      "A mate is helping Tuesday — confirm their day rate.",
    ]);
  });

  it("clears a per-line flag naming the machinery, keeping the line", () => {
    const { draft } = parseQuoteDraft({
      line_items: [{ ...line, contractor_flag: "locked price applied in code" }],
    });

    expect(draft.line_items).toHaveLength(1);
    expect(draft.line_items[0]!.contractor_flag ?? null).toBeNull();
  });

  it("keeps a per-line flag a contractor can act on", () => {
    const { draft } = parseQuoteDraft({
      line_items: [{ ...line, contractor_flag: "Confirm the delivery charge." }],
    });

    expect(draft.line_items[0]!.contractor_flag).toBe("Confirm the delivery charge.");
  });

  it("filters on the resilient path too, where one line was unusable", () => {
    // parseQuoteDraft has two returns. The second only runs when a line fails
    // to parse, which is exactly the path least likely to be exercised by hand.
    const { draft, dropped } = parseQuoteDraft({
      line_items: [
        line,
        { kind: "provisional", description: "Soil stack", suggested_amount_pence: -1, reason: "x" },
      ],
      contractor_flags: ["Estimated at 6500p", "Check the stack before you start."],
    });

    expect(dropped).toHaveLength(1);
    expect(draft.contractor_flags).toEqual(["Check the stack before you start."]);
  });
});

describe("the send-time refusal, in words rather than in schema", () => {
  it("still carries the machine prefix the removers match on", () => {
    // Three call sites match this prefix to drop a stale flag. Reword the
    // prefix and every one of them silently stops recognising its own output,
    // which is the accumulation bug stated-price-guard.ts exists to prevent.
    expect(unsourcedLineFlag("Works — see Scope of work")).toContain(UNSOURCED_LINE_PREFIX);
  });

  it("names the line and what to do, without naming the schema", () => {
    const flag = unsourcedLineFlag("Works — see Scope of work");

    expect(flag).toContain("Works — see Scope of work");
    expect(flag.toLowerCase()).not.toContain("provenance");
    expect(flag.toLowerCase()).not.toContain("sourced from the transcript");
  });
});

describe("taking the joined failures apart again", () => {
  const joined = [
    `${UNSOURCED_LINE_PREFIX}nothing accounts for "A".`,
    `${UNSOURCED_LINE_PREFIX}nothing accounts for "B".`,
    `${AMOUNT_MISMATCH_PREFIX}stated £48.00 for "delivery".`,
  ].join(" ");

  it("stops printing the first one's prefix twice", () => {
    // The live defect: `split(" Unsourced line:")` leaves the FIRST chunk
    // carrying its own prefix, and the render prepends another — so the
    // opening paragraph read "Unsourced line:Unsourced line: …".
    const bodies = splitReconciliationFailures(joined).map((f) => f.body);

    expect(bodies).toEqual([
      'nothing accounts for "A".',
      'nothing accounts for "B".',
      'stated £48.00 for "delivery".',
    ]);
  });

  it("gives each one a label a tradesperson reads, not the machine key", () => {
    const labels = splitReconciliationFailures(joined).map((f) => f.label);

    expect(labels).toEqual([
      "Not from the call",
      "Not from the call",
      "A price you said isn't on a line",
    ]);
    expect(labels.join(" ")).not.toContain("Unsourced");
    expect(labels.join(" ")).not.toContain("mismatch");
  });

  it("surfaces a message it does not recognise rather than swallowing it", () => {
    // A refusal the contractor cannot see is a send that fails with no reason
    // given, which is worse than an awkwardly-worded one.
    expect(splitReconciliationFailures("Something else went wrong.")).toEqual([
      { label: "This needs a look", body: "Something else went wrong." },
    ]);
  });

  it("has nothing to say about an empty string", () => {
    expect(splitReconciliationFailures("")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  compareLineItems,
  checkStatedPricesSurvive,
  checkForbiddenAmounts,
} from "../helpers/pipeline-compare";
import type { LineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

// HARN-2 — the replay harness, and the properties that make it worth having.
//
// Written by hand rather than through the factory: #518 blocked five times, and
// the last two were the PM reaching for `readFileSync` and then for an import of
// `harness.test`, both of which check-acceptance-static.sh correctly refuses.
// The second was my own instruction's fault — I told it to import a comparator
// that lived inside a test file. It lives in tests/helpers/ now.
//
// Nothing here reads a source file. The suite is a runnable deliverable, so it
// is invoked as one.

const runPipelineSuite = (): { status: number; output: string } => {
  try {
    const output = execFileSync("npm", ["run", "test:pipeline"], {
      encoding: "utf8",
      // No key, and none inherited. This is the "completes with no API key
      // present" criterion, asserted by removing the key rather than by
      // grepping for the code that would have used it.
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

const line = (overrides: Partial<LineItem> & { description: string }): LineItem => ({
  category: "materials",
  quantity: 1,
  unit: "lot",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...overrides,
});

const statedPrice = (amount: number, item: string): StatedPrice => ({
  amount,
  item,
  transcript_span: "spoken",
  qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
    refused: false,
});

describe("the pipeline suite is a runnable deliverable", () => {
  it("runs offline with no API key, and its failures name the fixture and the stage", () => {
    const { output } = runPipelineSuite();

    // It ran: a missing script or a broken config produces neither of these.
    expect(output).toContain("tests/pipeline/harness.test.ts");
    // It never reached the network — a live call with an empty key fails with
    // an auth error, and this asserts we see the recorder instead.
    expect(output).not.toMatch(/401|authentication_error|invalid x-api-key/i);
    // Every failure it reports is attributable.
    if (!output.includes("Tests  0 failed")) {
      expect(output).toMatch(/scenario-1 · (compile|draft|extraction|narrative)/);
    }
  }, 180_000);
});

describe("compareLineItems", () => {
  it("detects a one-penny change and names the field", () => {
    const expected = [line({ description: "Tiling", unit_price: 1400 })];
    const actual = [line({ description: "Tiling", unit_price: 1399.99 })];

    const failures = compareLineItems("f", expected, actual);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain("unit_price");
    expect(failures[0]?.message).toContain("1400");
  });

  it("passes when the quote matches, whatever order the lines come in", () => {
    const a = line({ description: "Tiling", unit_price: 1400 });
    const b = line({ description: "Radiator", unit_price: 140 });

    expect(compareLineItems("f", [a, b], [b, a])).toEqual([]);
  });

  it("reports a line the fixture does not expect, with its amount", () => {
    const failures = compareLineItems("f", [], [line({ description: "Tile trim", unit_price: 140 })]);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain("Tile trim");
    expect(failures[0]?.message).toContain("140.00");
  });

  it("reports a missing line rather than silently comparing fewer", () => {
    const failures = compareLineItems("f", [line({ description: "Tiling" })], []);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain("the quote has none");
  });
});

describe("checkStatedPricesSurvive", () => {
  it("names BOTH figures when a stated price does not reach the quote", () => {
    const failures = checkStatedPricesSurvive(
      "f",
      [statedPrice(140_000, "tiling labour")],
      [line({ description: "Suite", unit_price: 140 })],
    );

    expect(failures).toHaveLength(1);
    // The whole value of the message: you can see the decimal moved.
    expect(failures[0]?.message).toContain("£1400.00");
    expect(failures[0]?.message).toContain("£140.00");
  });

  it("passes when a line carries the stated amount", () => {
    expect(
      checkStatedPricesSurvive(
        "f",
        [statedPrice(140_000, "tiling labour")],
        [line({ description: "Tiling", unit_price: 1400 })],
      ),
    ).toEqual([]);
  });

  it("does not require a superseded, excluded or already-paid price to survive", () => {
    const superseded: StatedPrice = { ...statedPrice(80_000, "tiling"), superseded_by: 140_000 };
    const excluded: StatedPrice = {
      ...statedPrice(50_000, "decorating"),
      qualifiers: { each: false, fitted: false, already_paid: false, excluded: true },
    };

    expect(checkStatedPricesSurvive("f", [superseded, excluded], [])).toEqual([]);
  });
});

describe("checkForbiddenAmounts", () => {
  it("catches a retracted price surviving as a line total", () => {
    const failures = checkForbiddenAmounts("f", [800], [line({ description: "Tiling", unit_price: 800 })]);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain("retracted");
  });

  it("catches it surviving as a unit price on a multi-quantity line", () => {
    // The same defect wearing a hat: the total is £1,600 so a total-only check
    // sees nothing, but £800 is still on the document.
    const failures = checkForbiddenAmounts(
      "f",
      [800],
      [line({ description: "Tiling", quantity: 2, unit_price: 800 })],
    );

    expect(failures).toHaveLength(1);
  });

  it("passes when the retracted figure appears nowhere", () => {
    expect(
      checkForbiddenAmounts("f", [800], [line({ description: "Tiling", unit_price: 1400 })]),
    ).toEqual([]);
  });
});

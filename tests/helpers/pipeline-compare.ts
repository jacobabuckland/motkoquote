import { lineItemTotal } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

// The pipeline harness's comparisons, as plain functions.
//
// They live in a helper module rather than inside `harness.test.ts` for a
// reason that cost this item a derivation: a test that needs them can only
// reach them by importing another test file, which executes that whole suite
// inside this one and is refused by check-acceptance-static.sh. A comparison
// the acceptance tests must exercise is not test scaffolding — it is the thing
// being built, and it belongs somewhere importable.
//
// Every function here is pure: fixture in, list of human-readable failures out.
// Returning failures rather than throwing is what lets a test assert that a
// one-penny change is DETECTED, which an `expect` buried in a loop cannot do.

export type Failure = { stage: string; fixture: string; message: string };

const FIELDS = ["description", "category", "quantity", "unit", "unit_price"] as const;

/**
 * Compares compiled line items against a fixture's hand-derived expectations,
 * field by field.
 *
 * Matched by description rather than by array index. An index comparison
 * reports every line after an insertion as wrong, which buries the one real
 * difference in a wall of noise — and the first thing anyone does with a wall
 * of noise is regenerate the fixture from the output, which is the failure
 * mode this whole harness exists to prevent.
 */
export const compareLineItems = (
  fixture: string,
  expected: LineItem[],
  actual: LineItem[],
): Failure[] => {
  const failures: Failure[] = [];
  const remaining = [...actual];

  for (const want of expected) {
    const index = remaining.findIndex((item) => item.description === want.description);
    if (index === -1) {
      failures.push({
        stage: "compile",
        fixture,
        message: `Expected a line "${want.description}" and the quote has none.`,
      });
      continue;
    }

    const got = remaining.splice(index, 1)[0]!;
    for (const field of FIELDS) {
      if (got[field] !== want[field]) {
        failures.push({
          stage: "compile",
          fixture,
          message: `Line "${want.description}": ${field} is ${JSON.stringify(got[field])}, expected ${JSON.stringify(want[field])}.`,
        });
      }
    }
  }

  for (const extra of remaining) {
    failures.push({
      stage: "compile",
      fixture,
      message: `The quote carries a line the fixture does not expect: "${extra.description}" at £${lineItemTotal(extra).toFixed(2)}.`,
    });
  }

  return failures;
};

/**
 * Every price the contractor stated and did not retract must reach the quote.
 *
 * Names both figures, per the acceptance criterion — a failure reading "the
 * stated price did not survive" tells you nothing you can act on, where "stated
 * £1,400, the nearest line carries £140" tells you the decimal moved.
 */
export const checkStatedPricesSurvive = (
  fixture: string,
  statedPrices: StatedPrice[],
  actual: LineItem[],
): Failure[] =>
  statedPrices
    .filter(
      (price) =>
        price.superseded_by === null &&
        !price.qualifiers.excluded &&
        !price.qualifiers.already_paid,
    )
    .flatMap((price) => {
      const pounds = price.amount / 100;
      if (actual.some((item) => Math.abs(lineItemTotal(item) - pounds) < 0.005)) return [];

      const nearest = actual
        .map((item) => ({ item, delta: Math.abs(lineItemTotal(item) - pounds) }))
        .sort((a, b) => a.delta - b.delta)[0];

      return [
        {
          stage: "compile",
          fixture,
          message:
            `Stated £${pounds.toFixed(2)} for "${price.item ?? "an unnamed item"}" reaches no line. ` +
            (nearest
              ? `Nearest is "${nearest.item.description}" at £${lineItemTotal(nearest.item).toFixed(2)}.`
              : "The quote has no lines at all."),
        },
      ];
    });

/**
 * Amounts that must appear nowhere — a price the contractor retracted mid-call
 * being the case that matters.
 *
 * Checked against the unit price as well as the line total, because a
 * superseded figure surviving as a unit price on a multi-quantity line is the
 * same defect wearing a hat.
 */
export const checkForbiddenAmounts = (
  fixture: string,
  forbidden: number[],
  actual: LineItem[],
): Failure[] =>
  forbidden.flatMap((amount) =>
    actual
      .filter(
        (item) =>
          Math.abs(lineItemTotal(item) - amount) < 0.005 ||
          Math.abs(item.unit_price - amount) < 0.005,
      )
      .map((item) => ({
        stage: "compile",
        fixture,
        message:
          `£${amount.toFixed(2)} was retracted during the call and must appear on no line, ` +
          `but "${item.description}" carries it.`,
      })),
  );

/** Renders failures for a test assertion message. */
export const describeFailures = (failures: Failure[]): string =>
  failures.map((f) => `  [${f.fixture} · ${f.stage}] ${f.message}`).join("\n");

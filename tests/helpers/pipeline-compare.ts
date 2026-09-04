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

/**
 * Extract all monetary values from a transcript.
 * Returns amounts in pounds (not pence) for comparison with unit_price.
 */
const extractMonetaryValues = (transcript: string): number[] => {
  const amounts = new Set<number>();

  // Match numeric forms: £520, £140.00, £1,400, etc.
  const numericPattern = /£(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
  let match: RegExpExecArray | null;
  while ((match = numericPattern.exec(transcript)) !== null) {
    const value = parseFloat(match[1]!.replace(/,/g, ""));
    amounts.add(value);
  }

  // Match word-based amounts: "five hundred and twenty pounds", "one thousand four hundred pounds"
  // Look for number words followed by "pounds", "quid", or currency markers
  const wordPattern = /\b((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\s*(?:and\s*)?)+)\s*(?:pounds?|quid|£)/gi;

  while ((match = wordPattern.exec(transcript)) !== null) {
    const wordsText = match[1]!.toLowerCase().trim();
    // Simple word-to-number conversion for common amounts
    const parsed = parseWordAmount(wordsText);
    if (parsed !== null) {
      amounts.add(parsed);
    }
  }

  return Array.from(amounts);
};

/**
 * Parse word-based amounts like "five hundred and twenty", "one thousand four hundred"
 * Returns amount in pounds, or null if unparseable.
 */
const parseWordAmount = (text: string): number | null => {
  const words = text.toLowerCase().replace(/\s+and\s+/g, " ").split(/\s+/);

  const wordValues: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100, thousand: 1000, million: 1000000,
  };

  let total = 0;
  let current = 0;

  for (const word of words) {
    const value = wordValues[word];
    if (value === undefined) continue;

    if (value >= 1000) {
      current = (current || 1) * value;
      total += current;
      current = 0;
    } else if (value === 100) {
      current = (current || 1) * value;
    } else {
      current += value;
    }
  }

  total += current;
  return total > 0 ? total : null;
};

/**
 * Check that no line item carries a price that was not stated in the transcript,
 * and that all stated prices reach appropriate lines.
 *
 * Returns failures for:
 * - Line items whose unit_price does not appear in the transcript (excluding labour from stored rates)
 * - Stated prices that don't reach any non-labour line
 *
 * Excludes from line-item check:
 * - Provisional sums (editable estimates, not invented prices)
 * - Customer-supplied materials at £0 (scope tracking, not pricing)
 * - Labour lines that don't approximately match any stated price (priced from stored rates)
 */
export const checkNoInventedPrices = (
  fixture: string,
  transcript: string,
  lineItems: LineItem[],
): Failure[] => {
  const failures: Failure[] = [];
  const statedAmounts = extractMonetaryValues(transcript);

  // Check 1: Line items shouldn't have prices not in transcript
  for (const item of lineItems) {
    // Skip provisional sums
    if (item.provisional) continue;

    // Skip customer-supplied at £0
    if (item.supplied_by === "customer" && item.unit_price === 0) continue;

    // Skip zero-priced items (customer-supplied materials)
    if (item.unit_price === 0) continue;

    // Check if this unit_price appears in the transcript
    // Use 0.005 tolerance (half a penny) to detect 1p differences reliably despite floating point
    const price = item.unit_price;
    const matchesStated = statedAmounts.some(stated => Math.abs(stated - price) < 0.005);

    if (!matchesStated) {
      // For labour lines, check if it's close to any stated amount (within 5%)
      // If yes, flag it as drift. If no, it's probably from stored rates - OK.
      if (item.category === "labour") {
        const nearMatch = statedAmounts.find(stated => {
          const diff = Math.abs(stated - price);
          const pct = diff / stated;
          return diff >= 0.01 && pct < 0.05; // 1p or more off but within 5%
        });

        if (nearMatch) {
          failures.push({
            stage: "compile",
            fixture,
            message:
              `Line "${item.description}" carries £${price.toFixed(2)}, ` +
              `which is close to but not exactly £${nearMatch.toFixed(2)} from the transcript. ` +
              `This indicates drift from a stated price.`,
          });
        }
        // If no near match, skip - it's from stored rates
        continue;
      }

      // For non-labour lines, any mismatch is an invented price
      failures.push({
        stage: "compile",
        fixture,
        message:
          `Line "${item.description}" carries £${price.toFixed(2)}, which does not appear in the transcript. ` +
          `Stated amounts: ${statedAmounts.length > 0 ? statedAmounts.map(a => `£${a.toFixed(2)}`).join(", ") : "none"}.`,
      });
    }
  }

  // Check 2: Stated prices should reach lines (any category)
  // But allow labour lines to not match if they're likely from stored rates
  for (const stated of statedAmounts) {
    const reachesAnyLine = lineItems.some(item => {
      // Skip provisional
      if (item.provisional) return false;
      // Skip customer-supplied at £0
      if (item.supplied_by === "customer" && item.unit_price === 0) return false;

      return Math.abs(item.unit_price - stated) < 0.005;
    });

    // Also check if there's a labour line with a people array that might be using this as a component
    const hasLabourWithPeople = lineItems.some(item =>
      item.category === "labour" && item.people && Array.isArray(item.people) && item.people.length > 0
    );

    // If the stated price doesn't reach any line, and there's no labour with people breakdown
    // that might be consuming it indirectly, it's a problem
    if (!reachesAnyLine && !hasLabourWithPeople && stated > 0) {
      failures.push({
        stage: "compile",
        fixture,
        message: `Stated £${stated.toFixed(2)} in transcript but no line item carries this price.`,
      });
    }
  }

  return failures;
};

/** Renders failures for a test assertion message. */
export const describeFailures = (failures: Failure[]): string =>
  failures.map((f) => `  [${f.fixture} · ${f.stage}] ${f.message}`).join("\n");

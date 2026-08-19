import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * LED-6's governing rule (#257): "Code computes every number. A language model
 * must never perform arithmetic over the ledger — it receives computed figures
 * and renders them into a sentence."
 *
 * The item shipped two rounds of the same defect: the query actions wired to
 * nothing, then the formatters wired to nothing while raw pence were serialised
 * into the tool output for the model to divide by 100. Every acceptance test
 * passed through both, because all 37 import a function and assert its return
 * value — none asks whether anything calls it.
 *
 * These assert the wiring itself.
 */

const HANDLER = readFileSync(
  resolve(__dirname, "../../src/app/ledger/query/page.tsx"),
  "utf8",
);

/** The body of handleToolCall — where figures would cross into the session. */
const toolCallBody = (): string => {
  const start = HANDLER.indexOf("const handleToolCall");
  expect(start).toBeGreaterThan(-1);
  const end = HANDLER.indexOf("useEffect(", start);
  return HANDLER.slice(start, end);
};

describe("the voice handler speaks code-worded amounts", () => {
  it("calls the deterministic formatters", () => {
    const body = toolCallBody();

    // Each of these is unit-tested against exact British strings. Built and
    // called by nothing is the state this guards against.
    expect(body).toContain("formatOwedToYouResponse(");
    expect(body).toContain("formatYouOweResponse(");
    expect(body).toContain("formatAmount(");
  });

  it("sends no raw aggregate into the session", () => {
    const body = toolCallBody();

    // `result = { data }` is the shape that handed the model
    // [{ totalOwed: 240000, customerName: "Smith Ltd" }] to divide and read out.
    expect(body).not.toMatch(/result\s*=\s*\{\s*data\s*\}/);
    expect(body).not.toMatch(/result\s*=\s*\{\s*amount:\s*data\s*\}/);
  });

  it("routes every money query through an assembled answer", () => {
    const body = toolCallBody();

    for (const tool of [
      "get_owed_to_you",
      "get_you_owe",
      "get_you_owe_counterparty",
      "get_job_profit",
      "get_whats_left",
    ]) {
      expect(body).toContain(tool);
    }

    // One `answer:` per money query — the finished sentence, not the figures.
    const answers = body.match(/answer:/g) ?? [];
    expect(answers.length).toBeGreaterThanOrEqual(5);
  });
});

describe("the formatters this depends on still behave", () => {
  it("words pence into British speech", async () => {
    const { formatAmount } = await import("@/lib/voice/ledger-query-prompt");

    // 240000 must never reach the model; this is what goes instead.
    expect(formatAmount(240000)).toMatch(/pounds/);
    expect(formatAmount(240000)).not.toMatch(/240000/);
  });

  it("withholds a customer name that was not asked for", async () => {
    const { formatOwedToYouResponse } = await import("@/lib/voice/ledger-query-prompt");

    const response = formatOwedToYouResponse(
      [
        {
          customerId: "c1",
          customerName: "Smith Ltd",
          totalOwed: 240000,
          oldestInvoiceAgeDays: 45,
          unpaidInvoiceIds: ["inv-1"],
        },
      ],
      { customerMentionedInQuery: false },
    );

    // The privacy rule is enforced here, in code — which is only true while
    // the handler actually calls this rather than serialising the row.
    expect(response).not.toContain("Smith");
    expect(response).toMatch(/pounds/);
  });
});

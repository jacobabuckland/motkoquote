import { describe, expect, it } from "vitest";
import { buildQuoteCard, sendReadiness } from "@/lib/pa/quote-card";
import { loadJobBundle } from "@/lib/pa/data";
import { findDoubleCharges, reconcileStatedPrice } from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";
import { answeredSow, createFakeDb, labourLine, materialsLine, seedContractor } from "../helpers/pa-scenario";

const bundledLine = (): LineItem =>
  labourLine({
    description: "Replace kitchen tap",
    quantity: 1,
    unit_price: 120,
    includes_tasks: ["Remove existing kitchen tap"],
  });
const overlapLine = (): LineItem =>
  materialsLine({ description: "Remove existing kitchen tap", quantity: 1, unit_price: 30 });

const cardFor = async (lines: LineItem[]) => {
  const db = createFakeDb();
  const seeded = seedContractor(db, { lines, vat: false, sow: answeredSow });
  const bundle = (await loadJobBundle(db.client, seeded.contractor.id, seeded.jobId))!;
  return { bundle, card: buildQuoteCard(bundle, false, null)! };
};

describe("double-charge shows as a card blocker", () => {
  it("findDoubleCharges names the task, the bundled line and the separate line", () => {
    expect(findDoubleCharges([bundledLine(), overlapLine()])).toEqual([
      {
        task: "Remove existing kitchen tap",
        bundled: "Replace kitchen tap",
        separate: "Remove existing kitchen tap",
      },
    ]);
    expect(findDoubleCharges([bundledLine()])).toEqual([]);
  });

  it("reconcileStatedPrice keeps its existing wording for the same lines", () => {
    const message = reconcileStatedPrice(null, [bundledLine(), overlapLine()]);
    expect(message).toContain(
      'Double-charge detected: "Remove existing kitchen tap" is included in the bundled line ' +
        '"Replace kitchen tap" but also charged separately as "Remove existing kitchen tap".',
    );
  });

  it("adds a friendly blocker and disables Send when a bundled task is also charged separately", async () => {
    const { card } = await cardFor([bundledLine(), overlapLine()]);
    expect(card.canSend).toBe(false);
    const blocker = card.blockers.find((b) => b.includes("Replace kitchen tap"));
    expect(blocker).toBeDefined();
    expect(blocker).toContain('"Remove existing kitchen tap"');
    expect(blocker).toMatch(/charged twice/i);
    expect(blocker).not.toMatch(/[a-z]+_[a-z]+/);
    expect(blocker).not.toMatch(/Double-charge detected/);
  });

  it("raises no double-charge blocker for lines that do not overlap", async () => {
    const { card } = await cardFor([
      bundledLine(),
      materialsLine({ description: "Isolation valve", quantity: 1, unit_price: 12 }),
    ]);
    expect(card.blockers.some((b) => /charged twice/i.test(b))).toBe(false);
  });

  it("sendReadiness carries the blocker, so a confirmed send is refused with the same words", async () => {
    const { bundle } = await cardFor([bundledLine(), overlapLine()]);
    const readiness = sendReadiness(bundle, false, null);
    expect(readiness.blockers.some((b) => /charged twice/i.test(b))).toBe(true);
    expect(readiness.customer).toBeNull();
  });
});

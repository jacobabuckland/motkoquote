/**
 * The review screen showed the right numbers and Confirm and Save threw a 500.
 *
 * #811 taught the DRAFT to read a qualified amount — "£45.50 including VAT" —
 * because every such phrase had been parsing to null, refusing the capture and
 * looping the assistant until the contractor gave up. It did not teach the
 * SERVER, which re-parsed the same words with the raw parser and still got
 * null, and a null there is a thrown error rather than a question.
 *
 * So the loop was replaced by a failure one screen later, which is worse: the
 * contractor watched the correct net and VAT appear on a review screen, tapped
 * save, and got nothing. Scenario 105 of the 17 Sep re-run — HTTP 500, no
 * record — on a case that had passed before #811.
 *
 * The client sends intent and the server stays the authority. Being the
 * authority means reading the same words the same way, not reading them twice.
 */

import { describe, expect, it, vi } from "vitest";

type Created = {
  amountNet: number;
  vatAmount: number | null;
  vatTreatment: string;
  paid?: boolean;
};

const save = async (
  amountWords: string,
  extra: Record<string, unknown> = {},
): Promise<{ created: Created[]; threw: string | null }> => {
  const created: Created[] = [];
  vi.resetModules();

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data:
                table === "jobs"
                  ? { id: "job-1", contractor_id: "contractor-1" }
                  : { id: "contractor-1" },
              error: null,
            }),
            eq: () => ({ maybeSingle: async () => ({ data: { id: "contractor-1" }, error: null }) }),
          }),
        }),
      }),
    }),
  }));
  vi.doMock("@/app/jobs/[id]/cost-actions", () => ({
    createJobCost: async (args?: Created) => {
      if (args) created.push(args);
      return { ok: true, id: "cost-1" };
    },
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

  const { completeCostCapture } = await import("@/app/costs/actions");

  try {
    await completeCostCapture({
      jobId: "job-1",
      amountWords,
      counterpartyName: null,
      category: "plant_hire",
      description: "Mixer hire",
      incurredOn: "2026-09-17",
      vatTreatment: "standard",
      ...extra,
    });
    return { created, threw: null };
  } catch (error) {
    return { created, threw: error instanceof Error ? error.message : String(error) };
  }
};

describe("an amount the draft accepted", () => {
  it("saves scenario 105's decimal hire instead of throwing", async () => {
    const { created, threw } = await save("£45.50 including VAT");

    expect(threw, "HTTP 500 on Confirm and Save, with no record").toBeNull();
    expect(created).toHaveLength(1);
    // £45.50 gross is £37.92 net and £7.58 VAT.
    expect(created[0]?.amountNet).toBe(3792);
    expect(created[0]?.vatAmount).toBe(758);
  });

  it("saves the other qualified forms too", async () => {
    for (const words of ["£60 including VAT", "£36 inc VAT", "sixty pounds including VAT"]) {
      const { threw } = await save(words);
      expect(threw, words).toBeNull();
    }
  });

  it("takes the basis from the words when the caller states none", async () => {
    const { created } = await save("£60 including VAT");

    expect(created[0]?.amountNet, "gross £60 is £50 net").toBe(5000);
    expect(created[0]?.vatAmount).toBe(1000);
  });
});

describe("what the server must still refuse", () => {
  it("keeps the caller's reported basis over the words", async () => {
    const { created } = await save("£60 including VAT", { amountBasis: "net" });

    expect(created[0]?.amountNet).toBe(6000);
  });

  it("still asks rather than guessing when nobody named the basis", async () => {
    const { created, threw } = await save("£36 total", { vatTreatment: "unknown" });

    expect(created, "an unresolved basis must not reach the ledger").toEqual([]);
    expect(threw).toBeTruthy();
  });

  it("still refuses an amount that names no figure at all", async () => {
    const { created, threw } = await save("a bit later");

    expect(created).toEqual([]);
    expect(threw).toContain("Could not parse amount");
  });
});

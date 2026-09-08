import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRICING_MODE_NOT_RECORDED } from "@/lib/quote-send-guards";
import { EMPTY_SOW_STATE } from "@/lib/schemas/sow";

// PFIX-8. `setQuotePricingMode` writes twice with no transaction: the quote
// UPDATE first, then the job's sow_json. The quote write is fully guarded — it
// throws on an error and throws again when no editable row came back. The
// sow_json write was not guarded at all, and its error was discarded.
//
// So a failed second write left the quote collapsed into fixed-mode figures
// with NO record of the mode that collapsed it — the same shape as the legacy
// `pricing: null` rows, and indistinguishable from them afterwards. The action
// returned the recomputed lines and reported success while the job page showed
// a mode the contractor never chose.
//
// Throwing is the recoverable outcome, which is why it is the right one: the
// job's sow_json is untouched, so running the switch again recomputes from the
// old mode and rewrites the same quote.

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";

type WriteLog = { table: string; payload: Record<string, unknown> }[];

const runSwitch = async ({ sowWriteFails }: { sowWriteFails: boolean }) => {
  const writes: WriteLog = [];
  vi.resetModules();

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data:
                  table === "jobs"
                    ? {
                        id: JOB_ID,
                        // Built from the real default rather than hand-written:
                        // buildQuoteScope reads rooms, and a partial literal
                        // here would throw before reaching the guard under test.
                        sow_json: {
                          ...EMPTY_SOW_STATE,
                          job_type: "Full rewire",
                          pricing: { mode: "calculated" as const, fixed_amount: null },
                        },
                      }
                    : {
                        id: QUOTE_ID,
                        status: "draft",
                        line_items_json: [
                          {
                            description: "Rewire",
                            category: "labour",
                            quantity: 1,
                            unit: "day",
                            unit_price: 300,
                            multiplier: 1,
                            people_count: 1,
                            overtime: false,
                            assumed: false,
                          },
                        ],
                        drafted_line_items_json: null,
                        contractor_flags_json: [],
                      },
                error: null,
              }),
            }),
            single: async () => ({
              data: { id: "contractor-1", vat_registered: false },
              error: null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          writes.push({ table, payload });
          return {
            eq: () => {
              // The jobs write ends at .eq() and is awaited directly. The quotes
              // write continues into .in().select(), so both shapes are needed.
              const result = {
                error:
                  table === "jobs" && sowWriteFails
                    ? { message: "could not reach the database" }
                    : null,
              };
              return Object.assign(Promise.resolve(result), {
                in: () => ({
                  select: async () => ({ data: [{ id: QUOTE_ID }], error: null }),
                }),
              });
            },
          };
        },
      }),
    }),
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

  const { setQuotePricingMode } = await import("@/app/jobs/actions");
  const call = setQuotePricingMode({
    jobId: JOB_ID,
    quoteId: QUOTE_ID,
    mode: "fixed",
    fixedAmount: 1000,
  });
  return { call, writes };
};

describe("setQuotePricingMode — the sow_json write is guarded", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws an actionable error when the mode cannot be recorded", async () => {
    const { call } = await runSwitch({ sowWriteFails: true });
    await expect(call).rejects.toThrow(PRICING_MODE_NOT_RECORDED);
  });

  it("names the retry rather than leaking the database's message", async () => {
    // The digest is what survives Next's production redaction, so an authored
    // message has to travel on it. A raw Supabase string here would defeat that
    // redaction on purpose.
    const { call } = await runSwitch({ sowWriteFails: true });
    const err = await call.then(
      () => null,
      (e: unknown) => e as Error & { digest?: string },
    );

    expect(err).not.toBeNull();
    expect(err?.digest ?? "").toContain(PRICING_MODE_NOT_RECORDED);
    expect(err?.message ?? "").not.toContain("could not reach the database");
  });

  it("still writes the quote first, so the failure is the recoverable one", async () => {
    // Order is load-bearing and the comment in the action says why: writing
    // sow_json first would leave the mode switched while the quote kept its old
    // figures whenever the quote guard refuses.
    const { call, writes } = await runSwitch({ sowWriteFails: true });
    await call.catch(() => {});

    expect(writes.map((w) => w.table)).toEqual(["quotes", "jobs"]);
  });

  it("records the mode and returns normally when the write succeeds", async () => {
    const { call, writes } = await runSwitch({ sowWriteFails: false });
    const result = await call;

    expect(result.lineItems.length).toBeGreaterThan(0);

    const sowWrite = writes.find((w) => w.table === "jobs");
    expect(sowWrite?.payload.sow_json).toMatchObject({
      pricing: { mode: "fixed", fixed_amount: 1000 },
    });
  });
});

// PASS-14 SERIOUS 3: a second acceptance was never recorded, so the log kept a
// figure the customer had moved past.
//
// Pass 14's job 1c053939: the customer accepted three times — £1,440 at 13:27,
// £1,800 at ~13:37, £1,800 at a different deposit at ~13:40. The log recorded
// only the first. No second "Quote accepted", no second "Quote viewed", and the
// figure £1,800 nowhere in the history — yet the contract that was signed and
// invoiced is the £1,800 one.
//
// So the log read: agreed £1,440 → quote re-issued → contract signed → deposit
// invoice paid. In a dispute that supports the customer's position that they
// never agreed to £1,800. It is migration 84's harm relocated from the FIGURE
// to the EVENT.
//
// A quote is one row: `accepted_at` holds the current acceptance and
// `accepted_first_at` the first, and a column cannot hold a list.
// `quote_acceptances` (migration 85) is one row per acceptance.
//
// Two halves are tested here: that the log reads a list when one exists, and
// that the ACCEPT ACTION writes a row every time. The second is the half that
// would otherwise be a table nobody fills.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTimeline, type QuoteState } from "@/lib/job-stages";
import { mockSupabaseClient } from "../helpers/supabase";

const quote: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-17T13:20:00Z",
  viewed_at: "2026-09-17T13:25:00Z",
  accepted_at: "2026-09-17T13:40:00Z",
  accepted_first_at: "2026-09-17T13:27:00Z",
  accepted_total: 1440,
  reissued_at: "2026-09-17T13:35:00Z",
  declined_at: null,
  total: 1800,
};

const labels = (acceptances?: { accepted_at: string; accepted_total?: number | null }[]) =>
  buildTimeline(quote, null, [], null, [], acceptances).map((e) => e.label);

describe("the log reads every acceptance", () => {
  const three = [
    { accepted_at: "2026-09-17T13:27:00Z", accepted_total: 1440 },
    { accepted_at: "2026-09-17T13:37:00Z", accepted_total: 1800 },
    { accepted_at: "2026-09-17T13:40:00Z", accepted_total: 1800 },
  ];

  it("names the later figure the customer actually agreed to", () => {
    // The finding. £1,800 appeared NOWHERE in the history of a job whose signed
    // contract was for £1,800.
    expect(labels(three)).toContain("Quote accepted — £1,800.00");
  });

  it("keeps the earlier one too, rather than replacing it", () => {
    // Both are true, and the first is what migration 82 exists to protect.
    expect(labels(three)).toContain("Quote accepted — £1,440.00");
  });

  it("records a repeat acceptance at the same figure as its own event", () => {
    // Two acceptances at £1,800 are two events. The customer accepted twice —
    // deduplicating by figure would lose the one the contract was raised from.
    const atEighteen = labels(three).filter((l) => l === "Quote accepted — £1,800.00");

    expect(atEighteen).toHaveLength(2);
  });

  it("orders them newest first, like every other entry", () => {
    const order = buildTimeline(quote, null, [], null, [], three);
    const times = order
      .filter((e) => e.label.startsWith("Quote accepted"))
      .map((e) => e.at);

    expect(times).toEqual([
      "2026-09-17T13:40:00Z",
      "2026-09-17T13:37:00Z",
      "2026-09-17T13:27:00Z",
    ]);
  });

  it("still refuses to guess a figure that was not recorded", () => {
    // Unchanged from pass-13 SERIOUS 3, per acceptance rather than per quote.
    // `total` is 1800 on the fixture and must not be borrowed.
    const unpriced = [{ accepted_at: "2026-09-17T13:27:00Z", accepted_total: null }];

    expect(labels(unpriced)).toContain("Quote accepted");
    expect(labels(unpriced).some((l) => l.includes("£"))).toBe(false);
  });
});

describe("a quote whose acceptances predate the table", () => {
  it("reads from the columns exactly as it does today", () => {
    // The compatibility guard that matters most. Every quote accepted before
    // migration 85 has no rows, for ever — a second acceptance that was never
    // recorded cannot be invented later — so the columns must keep working.
    expect(labels(undefined)).toContain("Quote accepted — £1,440.00");
  });

  it("treats an EMPTY list the same as an absent one", () => {
    // After the backfill, empty means nobody has accepted — but a quote whose
    // embed failed to load looks identical, and dropping the entry would
    // resurrect pass 13's "the acceptance stopped ever having happened".
    expect(labels([])).toContain("Quote accepted — £1,440.00");
  });
});

describe("the accept action writes a row every time", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("inserts into quote_acceptances carrying the figure accepted", async () => {
    // Without this the table is one nobody fills, and the reading half above
    // would be satisfied by a list that is always empty.
    const { client, getWrites } = mockSupabaseClient([
      { id: "quote_1", accepted_first_at: null, total: 1800, line_items_json: [] },
    ]);

    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

    const mod = await import("@/app/q/[id]/actions");
    await mod.acceptQuote("quote_1").catch(() => null);

    const inserted = getWrites().filter(
      (w) => w.table === "quote_acceptances" && w.method === "insert",
    );

    expect(
      inserted,
      "accepting a quote recorded no row in quote_acceptances, so the second " +
        "acceptance onwards leaves no trace — which is the whole finding",
    ).toHaveLength(1);

    const payload = inserted[0]?.payload as { accepted_total?: number | null };
    expect(payload.accepted_total).toBe(1800);
  });
});

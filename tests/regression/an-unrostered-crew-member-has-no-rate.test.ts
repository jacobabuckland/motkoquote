// A person the drafter names who is NOT in team_members used to be billed at
// the OWNER's day rate — the expensive direction, chosen silently.
//
// On the pipeline's scenario-1 that is £320/day against an apprentice's £120:
// £3,200 where £2,200 is right, £1,000 over on a five-day job, on a line whose
// only clue was the label "Team member". The `unresolved_team_member` mismatch
// it recorded went to track("pricing_mismatch") and nowhere else, so nothing
// the contractor could see said a rate had been substituted at all.
//
// It is reachable without anyone doing anything odd: a sole trader who has
// never filled in the team roster says "me and my apprentice" on the call, the
// drafter has no id to cite and writes its own reference, and the helper is
// billed at the principal's rate.
//
// Decision (Jacob, 21 Sep 2026): treat it as no rate — leave the line unpriced
// and flag it, exactly as an unknown material price is handled. Motko prices
// from the trader's rates and never invents one.

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";

const context = (): CompileContext => ({
  day_rate: 320,
  overtime_rate: 480,
  markup_pct: 25,
  team_members: [{ id: "apprentice-1", name: "Apprentice", role: "apprentice", day_rate: 120 }],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: { people_count: 2, duration_days: 5, crew_description: "me and the apprentice" },
});

const draftWith = (secondRef: string): DraftLineItem[] => [
  {
    kind: "labour",
    description: "Full bathroom installation — 2-person crew over 5 working days",
    people: [
      { ref: "owner", days: 5 },
      { ref: secondRef, days: 5 },
    ],
    overtime: false,
    includes_tasks: ["Full strip-out"],
  },
];

describe("an unrostered crew member is not billed at the owner's rate", () => {
  it("gives them no rate rather than the owner's", () => {
    const { lineItems } = compileDraftToLineItems(draftWith("apprentice"), context());

    const labour = lineItems.find((i) => i.category === "labour");
    const other = labour?.people?.find((p) => p.label !== "Owner");

    expect(other?.day_rate).toBe(0);
  });

  // The money, stated as money. 5 x £320 for the owner and nothing for the
  // unknown person — never 5 x £320 twice.
  it("does not charge the customer for days it has no rate for", () => {
    const { lineItems } = compileDraftToLineItems(draftWith("apprentice"), context());

    const labour = lineItems.find((i) => i.category === "labour")!;

    expect(lineItemTotal(labour)).toBe(1600);
    expect(lineItemTotal(labour)).not.toBe(3200);
  });

  it("marks the line unpriced so it cannot go out as a real figure", () => {
    const { lineItems } = compileDraftToLineItems(draftWith("apprentice"), context());

    expect(lineItems.find((i) => i.category === "labour")?.unpriced).toBe(true);
  });

  // The half that was missing entirely: the contractor has to be told, and told
  // something they can act on. "Add your day rate" is the wrong instruction
  // here — theirs is set.
  it("tells the contractor, naming the line and the roster", () => {
    const { contractorFlags } = compileDraftToLineItems(draftWith("apprentice"), context());

    const flag = contractorFlags.find((f) => f.includes("isn't in your team"));

    expect(flag).toBeDefined();
    expect(flag).toContain("Full bathroom installation");
    expect(flag).toContain("Business details");
  });

  it("still records the mismatch, so telemetry is unchanged", () => {
    const { mismatches } = compileDraftToLineItems(draftWith("apprentice"), context());

    expect(mismatches.map((m) => m.reason)).toContain("unresolved_team_member");
  });

  // THE BOUNDARY THIS FIX GOT WRONG FIRST TIME, so it is pinned.
  //
  // The prompt asks for the literal "owner" and the model writes "me" about as
  // often — it is the commonest unresolved ref in the tree. That is the
  // contractor referring to themselves, not an unknown helper, and their own
  // day rate is exactly the right rate for it. Treating every unresolved ref
  // as unrostered made three other regression files fail, all of them on "me".
  it.each(["me", "Me", "myself", "I"])(
    "still prices %s at the owner's own rate — that is the contractor",
    (ref) => {
      const { lineItems, contractorFlags } = compileDraftToLineItems(draftWith(ref), context());

      const labour = lineItems.find((i) => i.category === "labour")!;

      expect(lineItemTotal(labour)).toBe(3200);
      expect(labour.unpriced).toBeUndefined();
      expect(contractorFlags.find((f) => f.includes("isn't in your team"))).toBeUndefined();
    },
  );

  // A real team member always wins on id, even if somebody is called "Me".
  it("prefers a rostered member over the owner-word fallback", () => {
    const ctx = context();
    ctx.team_members = [{ id: "me", name: "Mo", role: "labourer", day_rate: 100 }];

    const { lineItems } = compileDraftToLineItems(draftWith("me"), ctx);

    const labour = lineItems.find((i) => i.category === "labour")!;

    expect(lineItemTotal(labour)).toBe(2100);
    expect(labour.people?.map((p) => p.label)).toContain("Mo (labourer)");
  });

  // The other direction, so the fix cannot be "never price a second person".
  // A ref that DOES resolve is priced from that member's own rate, and the
  // line stays priced and sendable.
  it("prices a rostered crew member from their own rate, as before", () => {
    const { lineItems, contractorFlags } = compileDraftToLineItems(
      draftWith("apprentice-1"),
      context(),
    );

    const labour = lineItems.find((i) => i.category === "labour")!;

    expect(lineItemTotal(labour)).toBe(2200);
    expect(labour.unpriced).toBeUndefined();
    expect(contractorFlags.find((f) => f.includes("isn't in your team"))).toBeUndefined();
    expect(labour.people?.map((p) => p.label)).toContain("Apprentice (apprentice)");
  });
});

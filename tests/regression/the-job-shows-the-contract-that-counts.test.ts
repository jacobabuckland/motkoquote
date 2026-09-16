// Migration 83 lets a quote carry more than one contract, and `embeddedOne`
// returns whichever PostgREST put first.
//
// While `contracts.quote_id` was UNIQUE there was only ever one, so "the first"
// and "the only" were the same answer and `embeddedOne` was right. The partial
// unique index keeps withdrawn and declined contracts as history, so a quote
// that had one taken back and replaced now carries two — and PostgREST does not
// promise an order.
//
// Unfixed, the job page, the dashboard row, the "contract signed" check and the
// Activity timeline would each show whichever came back first: possibly the
// DEAD contract, possibly a different one between two loads of the same page.
// Not a crash — a job quietly reporting the wrong contract's status, which is
// the class this pass has spent its whole time on.
import { describe, expect, it } from "vitest";
import { currentContract, embeddedOne } from "@/lib/postgrest-embed";

const withdrawn = { id: "c1", status: "withdrawn", sent_at: "2026-09-10T09:00:00Z" };
const declined = { id: "c0", status: "declined", sent_at: "2026-09-09T09:00:00Z" };
const live = { id: "c2", status: "sent", sent_at: "2026-09-12T09:00:00Z" };
const signed = { id: "c3", status: "signed", sent_at: "2026-09-13T09:00:00Z" };

describe("choosing the contract a quote is actually on", () => {
  it("prefers the live contract over a withdrawn one, whatever the order", () => {
    // Both orders, because the whole problem is that the order is not promised.
    expect(currentContract([withdrawn, live])?.id).toBe("c2");
    expect(currentContract([live, withdrawn])?.id).toBe("c2");
  });

  it("prefers a signed contract over a declined one", () => {
    expect(currentContract([declined, signed])?.id).toBe("c3");
    expect(currentContract([signed, declined])?.id).toBe("c3");
  });

  it("falls back to the most recently sent when every contract is dead", () => {
    // No live contract to prefer, so the truthful answer is the one the
    // customer last received — not the one that happened to come back first.
    expect(currentContract([declined, withdrawn])?.id).toBe("c1");
    expect(currentContract([withdrawn, declined])?.id).toBe("c1");
  });

  it("is unchanged on the to-one embed that exists today", () => {
    // Migration 83 is not applied yet, so this is the live shape and it must
    // keep behaving exactly as embeddedOne did.
    expect(currentContract(live)?.id).toBe("c2");
    expect(currentContract(live)).toEqual(embeddedOne(live));
    expect(currentContract([live])).toEqual(embeddedOne([live]));
  });

  it("says nothing when there is no contract", () => {
    expect(currentContract(null)).toBeNull();
    expect(currentContract(undefined)).toBeNull();
    expect(currentContract([])).toBeNull();
  });

  it("does not care whether sent_at was selected", () => {
    // The dashboard embed selects sent_at; a caller that does not must still
    // get a live contract rather than undefined behaviour.
    const noTimestamps = [{ id: "a", status: "withdrawn" }, { id: "b", status: "sent" }];
    expect(currentContract(noTimestamps)?.id).toBe("b");

    const allDeadNoTimestamps = [{ id: "a", status: "withdrawn" }, { id: "b", status: "declined" }];
    expect(currentContract(allDeadNoTimestamps)).not.toBeNull();
  });
});

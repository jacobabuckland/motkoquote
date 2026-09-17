// PASS-14 SERIOUS 2: sending a replacement contract erased the original send
// and the withdrawal from the Activity log.
//
// Pass 13 diagnosed this pattern on the QUOTE — a panel built from current row
// state — and pass 14 found it alive on the CONTRACT. `buildTimeline` took one
// contract, so a quote that had three showed the events of one.
//
// What pass 14 watched, on the same job minutes apart:
//
//   Quote re-issued            13:35        Contract sent            13:38
//   Contract withdrawn         13:34   →    Quote re-issued          13:35
//   Contract sent              13:32        Quote accepted — £1,440  13:27
//   Quote accepted — £1,440    13:27
//
// The send and the withdrawal are gone. By the end of the job — three
// contracts, two withdrawals — the log showed exactly one "Contract sent" and
// no withdrawals at all, which does not merely forget: it asserts that a single
// contract was sent after the re-issue and signed.
//
// NOTHING NEW IS STORED. Every contract row has always carried its own
// `sent_at`, `withdrawn_at`, `declined_at` and `signed_at`. Migration 83 made
// more than one such row able to exist; this reads them all.
import { describe, expect, it } from "vitest";
import { buildTimeline, type ContractState, type QuoteState } from "@/lib/job-stages";

const quote: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-17T13:20:00Z",
  viewed_at: "2026-09-17T13:25:00Z",
  accepted_at: "2026-09-17T13:27:00Z",
  accepted_first_at: "2026-09-17T13:27:00Z",
  accepted_total: 1440,
  reissued_at: "2026-09-17T13:35:00Z",
  declined_at: null,
  total: 1800,
};

// The reported job: three contracts, two withdrawals, one signature.
const first: ContractState = {
  id: "contract_1",
  status: "withdrawn",
  sent_at: "2026-09-17T13:32:00Z",
  signed_at: null,
  declined_at: null,
  withdrawn_at: "2026-09-17T13:34:00Z",
  deposit_pct: null,
};

const second: ContractState = {
  id: "contract_2",
  status: "withdrawn",
  sent_at: "2026-09-17T13:38:00Z",
  signed_at: null,
  declined_at: null,
  withdrawn_at: "2026-09-17T13:39:00Z",
  deposit_pct: null,
};

const third: ContractState = {
  id: "contract_3",
  status: "signed",
  sent_at: "2026-09-17T13:40:00Z",
  signed_at: "2026-09-17T13:45:00Z",
  declined_at: null,
  withdrawn_at: null,
  deposit_pct: null,
};

const labels = (contracts: ContractState[]) =>
  buildTimeline(quote, contracts[contracts.length - 1] ?? null, [], null, contracts).map(
    (e) => e.label,
  );

const at = (contracts: ContractState[], label: string) =>
  buildTimeline(quote, contracts[contracts.length - 1] ?? null, [], null, contracts)
    .filter((e) => e.label === label)
    .map((e) => e.at);

describe("a replacement contract does not erase its predecessor", () => {
  it("keeps every send", () => {
    expect(at([first, second, third], "Contract sent")).toEqual([
      "2026-09-17T13:40:00Z",
      "2026-09-17T13:38:00Z",
      "2026-09-17T13:32:00Z",
    ]);
  });

  it("keeps every withdrawal", () => {
    // One row was all that survived, and at the end of the job it was none.
    expect(at([first, second, third], "Contract withdrawn")).toEqual([
      "2026-09-17T13:39:00Z",
      "2026-09-17T13:34:00Z",
    ]);
  });

  it("reads newest first, so a withdrawal follows the send it ended", () => {
    const order = buildTimeline(quote, third, [], null, [first, second, third]);
    const index = (label: string, n: number) =>
      order.map((e) => e.label).reduce<number[]>((acc, l, i) => (l === label ? [...acc, i] : acc), [])[n];

    // The first contract's withdrawal (13:34) must read ABOVE its send (13:32).
    expect(index("Contract withdrawn", 1)).toBeLessThan(index("Contract sent", 2));
  });

  it("does not invent an event for a contract that was only ever sent", () => {
    expect(labels([third])).toContain("Contract sent");
    expect(labels([third])).toContain("Contract signed");
    expect(labels([third])).not.toContain("Contract withdrawn");
    expect(labels([third])).not.toContain("Contract declined");
  });
});

describe("what a caller that passes no contract list still gets", () => {
  it("reads exactly as it does today, from the single contract", () => {
    // The compatibility guard. Every existing caller — and every frozen test —
    // passes four arguments, and must keep producing the same timeline.
    const single = buildTimeline(quote, first, [], null).map((e) => e.label);

    expect(single).toEqual([
      "Quote re-issued",
      "Contract withdrawn",
      "Contract sent",
      "Quote accepted — £1,440.00",
      "Quote viewed",
      "Quote sent",
    ]);
  });

  it("copes with no contract at all", () => {
    expect(buildTimeline(quote, null, [], null).map((e) => e.label)).toEqual([
      "Quote re-issued",
      "Quote accepted — £1,440.00",
      "Quote viewed",
      "Quote sent",
    ]);
  });

  it("copes with an empty list, which is not the same as an absent one", () => {
    // `[]` means "this quote has no contracts", and must not fall back to the
    // single `contract` argument — that fallback exists for callers that pass
    // nothing at all.
    const none = buildTimeline(quote, first, [], null, []).map((e) => e.label);

    expect(none).not.toContain("Contract sent");
    expect(none).not.toContain("Contract withdrawn");
  });
});

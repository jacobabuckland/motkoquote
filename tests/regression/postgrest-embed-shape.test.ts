// A one-to-one PostgREST embed arrives as an OBJECT, and every consumer of the
// `contracts` embed read it as an array.
//
// `contracts.quote_id` carries a UNIQUE constraint (migration 11), which makes
// `quotes → contracts` a to-one relationship, so PostgREST returns
// `contracts: {...}` rather than `contracts: [{...}]`. Six call sites did
// `contracts?.[0]`, which on an object is `undefined`, so a job with a SENT
// contract read as a job with no contract at all: the dashboard offered "Send
// contract" for a job simultaneously listed under "Contracts awaiting
// signature", and `markWorkComplete` refused every job because the signature it
// needed was invisible.
//
// Nothing caught it because each of those rows crosses an `as unknown as` cast
// out of the Supabase client, so the array type was asserted and never checked.
//
// These tests drive the real consumers with the OBJECT shape. Each of them
// fails against the `?.[0]` reading and passes against the accessor, and none
// of them looks at how any of it is written.

import { describe, it, expect } from "vitest";
import { embeddedOne, embeddedMany } from "@/lib/postgrest-embed";
import { normalizeHistoryJob, type RawHistoryJob } from "@/lib/job-history";
import { assessDraftDeletion } from "@/lib/draft-delete-guard";
import { deriveInvoiceAmount, type QuoteContract } from "@/lib/invoice-amount";
import { dashboardSection } from "@/lib/dashboard-sections";
import type { ContractState } from "@/lib/job-stages";

const sentContract: NonNullable<ContractState> = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "sent",
  sent_at: "2026-09-01T09:00:00.000Z",
  signed_at: null,
  deposit_pct: 25,
};

const signedContract: NonNullable<ContractState> = {
  ...sentContract,
  status: "signed",
  signed_at: "2026-09-02T09:00:00.000Z",
};

describe("embeddedOne", () => {
  it("reads a to-one embed delivered as a bare object", () => {
    expect(embeddedOne(sentContract)).toBe(sentContract);
  });

  it("still reads the array shape, so a PostgREST change cannot break it back", () => {
    expect(embeddedOne([sentContract])).toBe(sentContract);
  });

  it("returns null for an absent, empty or unselected embed", () => {
    expect(embeddedOne(null)).toBeNull();
    expect(embeddedOne(undefined)).toBeNull();
    expect(embeddedOne([])).toBeNull();
  });
});

describe("embeddedMany", () => {
  it("wraps a bare object so downstream .find/.filter cannot throw", () => {
    expect(embeddedMany(sentContract)).toEqual([sentContract]);
  });

  it("passes an array through and yields [] for an absent embed", () => {
    expect(embeddedMany([sentContract])).toEqual([sentContract]);
    expect(embeddedMany(null)).toEqual([]);
    expect(embeddedMany(undefined)).toEqual([]);
  });
});

describe("the jobs list, given the object shape", () => {
  const jobWithContract = (contracts: RawHistoryJob["quote"] extends null
    ? never
    : NonNullable<RawHistoryJob["quote"]>["contracts"]): RawHistoryJob => ({
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-08-30T09:00:00.000Z",
    extracted_json: { job_type: "Rewire" },
    customer: { name: "Test Customer" },
    quote: {
      total: 4284,
      status: "accepted",
      sent_at: "2026-08-30T10:00:00.000Z",
      viewed_at: "2026-08-30T11:00:00.000Z",
      accepted_at: "2026-08-31T09:00:00.000Z",
      declined_at: null,
      created_at: "2026-08-30T09:00:00.000Z",
      contracts,
      invoices: [],
    },
  });

  it("sees a sent contract, rather than asking for one to be raised", () => {
    const job = normalizeHistoryJob(jobWithContract(sentContract));

    // The whole defect in one assertion: with `?.[0]` this reads
    // "accepted_need_contract", i.e. a contract that exists and has been sent
    // to the customer is invisible and the trade is asked to send it again.
    expect(job.situation).toBe("contract_sent");
  });

  it("sees a signed contract", () => {
    const job = normalizeHistoryJob(jobWithContract(signedContract));

    expect(job.situation).not.toBe("accepted_need_contract");
  });

  it("still asks for a contract when there genuinely is none", () => {
    expect(normalizeHistoryJob(jobWithContract(null)).situation).toBe(
      "accepted_need_contract",
    );
  });
});

describe("the dashboard section, given the object shape", () => {
  const acceptedQuote = {
    status: "accepted",
    sent_at: "2026-08-30T10:00:00.000Z",
    viewed_at: "2026-08-30T11:00:00.000Z",
    accepted_at: "2026-08-31T09:00:00.000Z",
    declined_at: null,
  };

  it("does not offer 'Send contract' for a job whose contract is out for signature", () => {
    // This is what the dashboard computes once the embed is read correctly:
    // the job belongs in neither action section, because it is with the
    // customer. Reading `?.[0]` put it in "awaiting_contract" while the
    // separate contracts query listed it under "awaiting signature" — one job,
    // two contradictory sections, each offering the other's action.
    expect(dashboardSection(acceptedQuote, embeddedOne(sentContract), [])).toBeNull();
  });

  it("offers an invoice once the contract is signed", () => {
    expect(dashboardSection(acceptedQuote, embeddedOne(signedContract), [])).toBe(
      "awaiting_invoice",
    );
  });

  it("offers 'Send contract' when there is no contract", () => {
    expect(dashboardSection(acceptedQuote, embeddedOne(null), [])).toBe(
      "awaiting_contract",
    );
  });
});

describe("the draft-deletion guard, given the object shape", () => {
  it("refuses to delete a draft whose quote carries a contract", () => {
    const verdict = assessDraftDeletion({
      quotes: [{ status: "draft", contracts: sentContract, invoices: [] }],
      job_costs: [],
    });

    // `contracts.length` on an object is undefined, so the old reading found no
    // contract and called the job safe to hard-delete — and quotes cascade.
    expect(verdict.deletable).toBe(false);
  });

  it("still allows deleting a bare draft", () => {
    expect(
      assessDraftDeletion({
        quotes: [{ status: "draft", contracts: null, invoices: [] }],
        job_costs: [],
      }).deletable,
    ).toBe(true);
  });
});

describe("the invoice amount, given the object shape", () => {
  it("derives the deposit from a contract delivered as an object", () => {
    // deriveInvoiceAmount calls `.find` on this argument, which throws
    // "contracts.find is not a function" when handed the object directly — so
    // every deposit invoice failed outright rather than being mispriced.
    const amount = deriveInvoiceAmount("deposit", 4284, [], embeddedMany(signedContract), {
      workCompletedAt: null,
    });

    expect(amount).toBe(1071);
  });

  it("throws the normal guidance when there is no contract at all", () => {
    expect(() =>
      deriveInvoiceAmount("deposit", 4284, [], embeddedMany<QuoteContract>(null), {
        workCompletedAt: null,
      }),
    ).toThrow(/deposit percentage/i);
  });
});

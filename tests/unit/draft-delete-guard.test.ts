import { describe, expect, it } from "vitest";
import {
  assessDraftDeletion,
  DRAFT_ALREADY_SENT,
  DRAFT_HAS_COSTS,
  DRAFT_HAS_RECORDS,
} from "@/lib/draft-delete-guard";

// The swipe on My work deletes outright rather than archiving, so this guard is
// the whole safety argument: it has to hold that there is nothing behind the
// draft worth keeping before a row is removed.

describe("assessDraftDeletion", () => {
  it("allows a job that never got as far as a quote", () => {
    expect(assessDraftDeletion({})).toEqual({ deletable: true });
    expect(assessDraftDeletion({ quotes: [], job_costs: [] })).toEqual({ deletable: true });
  });

  it("allows a draft quote with nothing raised against it", () => {
    expect(
      assessDraftDeletion({ quotes: [{ status: "draft", contracts: [], invoices: [] }] }),
    ).toEqual({ deletable: true });
  });

  it.each(["sent", "accepted", "declined", "archived"])(
    "refuses a quote that has left draft (%s)",
    (status) => {
      expect(assessDraftDeletion({ quotes: [{ status }] })).toEqual({
        deletable: false,
        reason: DRAFT_ALREADY_SENT,
      });
    },
  );

  it("refuses a draft with a contract against it", () => {
    expect(
      assessDraftDeletion({
        quotes: [{ status: "draft", contracts: [{ id: "contract-1" }], invoices: [] }],
      }),
    ).toEqual({ deletable: false, reason: DRAFT_HAS_RECORDS });
  });

  it("refuses a draft with an invoice against it", () => {
    expect(
      assessDraftDeletion({
        quotes: [{ status: "draft", contracts: [], invoices: [{ id: "invoice-1" }] }],
      }),
    ).toEqual({ deletable: false, reason: DRAFT_HAS_RECORDS });
  });

  it("refuses a draft that already has costs recorded on it", () => {
    expect(
      assessDraftDeletion({
        quotes: [{ status: "draft" }],
        job_costs: [{ id: "cost-1" }],
      }),
    ).toEqual({ deletable: false, reason: DRAFT_HAS_COSTS });
  });

  it("refuses when any one of several quotes has left draft", () => {
    expect(
      assessDraftDeletion({
        quotes: [{ status: "draft" }, { status: "accepted" }],
      }),
    ).toEqual({ deletable: false, reason: DRAFT_ALREADY_SENT });
  });

  it("treats a null embed as nothing there rather than as a failure", () => {
    expect(assessDraftDeletion({ quotes: null, job_costs: null })).toEqual({ deletable: true });
    expect(
      assessDraftDeletion({ quotes: [{ status: "draft", contracts: null, invoices: null }] }),
    ).toEqual({ deletable: true });
  });
});

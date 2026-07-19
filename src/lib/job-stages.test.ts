import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  deriveJobState,
  type ContractState,
  type InvoiceState,
  type QuoteState,
} from "./job-stages";

const quote = (overrides: Partial<NonNullable<QuoteState>> = {}): QuoteState => ({
  status: "sent",
  sent_at: "2026-07-01T09:00:00.000Z",
  viewed_at: null,
  accepted_at: null,
  declined_at: null,
  ...overrides,
});

const contract = (overrides: Partial<NonNullable<ContractState>> = {}): ContractState => ({
  id: "c1",
  status: "sent",
  sent_at: "2026-07-03T09:00:00.000Z",
  signed_at: null,
  deposit_pct: null,
  ...overrides,
});

const invoice = (overrides: Partial<InvoiceState> = {}): InvoiceState => ({
  id: "i1",
  status: "sent",
  invoice_type: "final",
  due_date: null,
  created_at: "2026-07-05T09:00:00.000Z",
  paid_at: null,
  stripe_payment_link_url: null,
  ...overrides,
});

const stageState = (state: ReturnType<typeof deriveJobState>, key: string) =>
  state.stages.find((stage) => stage.key === key)?.state;

describe("deriveJobState — situation and whose move", () => {
  it("draft quote is the contractor's move", () => {
    const state = deriveJobState(quote({ status: "draft", sent_at: null }), null, []);
    expect(state.situation).toBe("draft_quote");
    expect(state.move).toBe("contractor");
    expect(state.overallStatus).toBe("Draft");
  });

  it("sent quote waits on the customer; viewed reflects in the status", () => {
    const state = deriveJobState(quote({ viewed_at: "2026-07-02T09:00:00.000Z" }), null, []);
    expect(state.situation).toBe("quote_sent");
    expect(state.move).toBe("customer");
    expect(state.overallStatus).toBe("Viewed");
  });

  it("declined quote is terminal", () => {
    const state = deriveJobState(
      quote({ status: "declined", declined_at: "2026-07-02T09:00:00.000Z" }),
      null,
      [],
    );
    expect(state.situation).toBe("quote_declined");
    expect(state.move).toBe("none");
    expect(stageState(state, "accepted")).toBe("declined");
    expect(stageState(state, "contract_signed")).toBe("future");
  });

  it("accepted quote with no contract needs the contractor to send one", () => {
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      null,
      [],
    );
    expect(state.situation).toBe("accepted_need_contract");
    expect(state.move).toBe("contractor");
    expect(stageState(state, "contract_signed")).toBe("current");
  });

  it("sent contract waits on the customer to sign", () => {
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      contract({ status: "sent" }),
      [],
    );
    expect(state.situation).toBe("contract_sent");
    expect(state.move).toBe("customer");
  });

  it("signed contract with no invoice needs the contractor to raise one", () => {
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      contract({ status: "signed", signed_at: "2026-07-04T09:00:00.000Z" }),
      [],
    );
    expect(state.situation).toBe("signed_need_invoice");
    expect(state.move).toBe("contractor");
    expect(stageState(state, "contract_signed")).toBe("complete");
    expect(stageState(state, "invoiced")).toBe("current");
  });

  it("unpaid invoice waits on the customer to pay", () => {
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      contract({ status: "signed", signed_at: "2026-07-04T09:00:00.000Z" }),
      [invoice({ status: "sent" })],
    );
    expect(state.situation).toBe("invoice_unpaid");
    expect(state.move).toBe("customer");
    expect(state.activeInvoice?.id).toBe("i1");
  });

  it("flags an overdue invoice", () => {
    const now = new Date("2026-07-20T09:00:00.000Z").getTime();
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      contract({ status: "signed", signed_at: "2026-07-04T09:00:00.000Z" }),
      [invoice({ status: "sent", due_date: "2026-07-10" })],
      now,
    );
    expect(state.situation).toBe("invoice_overdue");
    expect(state.overallStatus).toBe("Overdue");
  });

  it("fully paid job is terminal with every stage complete", () => {
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      contract({ status: "signed", signed_at: "2026-07-04T09:00:00.000Z" }),
      [invoice({ status: "paid", paid_at: "2026-07-06T09:00:00.000Z" })],
    );
    expect(state.situation).toBe("paid");
    expect(state.move).toBe("none");
    expect(state.stages.every((stage) => stage.state === "complete")).toBe(true);
  });

  it("invoicing without a signed contract marks the contract stage skipped, not pending", () => {
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      null,
      [invoice({ status: "sent" })],
    );
    expect(state.situation).toBe("invoice_unpaid");
    expect(stageState(state, "contract_signed")).toBe("skipped");
    expect(stageState(state, "invoiced")).toBe("complete");
    expect(stageState(state, "paid")).toBe("current");
  });

  it("declined contract stops the pipeline at the signing stage", () => {
    const state = deriveJobState(
      quote({ status: "accepted", accepted_at: "2026-07-02T09:00:00.000Z" }),
      contract({ status: "declined" }),
      [],
    );
    expect(state.situation).toBe("contract_declined");
    expect(stageState(state, "accepted")).toBe("complete");
    expect(stageState(state, "contract_signed")).toBe("declined");
  });
});

describe("buildTimeline", () => {
  it("orders known events newest first and only includes what happened", () => {
    const timeline = buildTimeline(
      quote({
        status: "accepted",
        viewed_at: "2026-07-02T09:00:00.000Z",
        accepted_at: "2026-07-03T09:00:00.000Z",
      }),
      contract({ status: "signed", signed_at: "2026-07-05T09:00:00.000Z" }),
      [
        invoice({
          status: "paid",
          paid_at: "2026-07-08T09:00:00.000Z",
          chase_events: [{ channel: "email", sent_at: "2026-07-07T09:00:00.000Z" }],
        }),
      ],
    );
    expect(timeline[0]?.label).toBe("Invoice paid");
    expect(timeline.map((event) => event.label)).toContain("Chased by email");
    expect(timeline.map((event) => event.label)).toContain("Quote viewed");
    // Nothing that didn't happen (e.g. "Quote declined") is present.
    expect(timeline.map((event) => event.label)).not.toContain("Quote declined");
  });
});

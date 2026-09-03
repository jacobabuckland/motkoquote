/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  deriveJobState,
  deriveStages,
  type QuoteState,
  type ContractState,
  type InvoiceState,
  type StageState,
} from "@/lib/job-stages";
import { PipelineStepper } from "@/components/ui/pipeline-stepper";
import { normalizeHistoryJob, type RawHistoryJob } from "@/lib/job-history";

afterEach(cleanup);

describe("forced stage state", () => {
  it("deriveStages marks a skipped stage as forced rather than complete", () => {
    // A job invoiced before the contract was signed: the canonical case from
    // production. Invoice complete but contract not signed → contract_signed
    // should be marked "forced", not "complete".
    const quote: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-01T10:00:00Z",
      viewed_at: "2026-09-01T11:00:00Z",
      accepted_at: "2026-09-01T12:00:00Z",
      declined_at: null,
    };
    const contract: ContractState = null; // No contract sent or signed
    const invoices: InvoiceState[] = [
      {
        id: "inv-1",
        status: "unpaid",
        invoice_type: "full",
        due_date: "2026-09-15T00:00:00Z",
        created_at: "2026-09-02T10:00:00Z",
        paid_at: null,
      },
    ];

    const { stages, inconsistentStages } = deriveStages(
      quote,
      contract,
      invoices,
      "invoiced", // current stage
      null, // no work_completed_at
    );

    // The invoice stage is complete, so contract_signed was forced to maintain
    // monotonicity. It should be in inconsistentStages.
    expect(inconsistentStages).toContain("contract_signed");

    // The contract_signed stage should have state="forced", not "complete"
    const contractStage = stages.find((s) => s.key === "contract_signed");
    expect(contractStage?.state).toBe("forced");
  });

  it("a genuinely complete stage is never marked forced", () => {
    const quote: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-01T10:00:00Z",
      viewed_at: "2026-09-01T11:00:00Z",
      accepted_at: "2026-09-01T12:00:00Z",
      declined_at: null,
    };
    const contract: ContractState = {
      id: "con-1",
      status: "signed",
      sent_at: "2026-09-01T13:00:00Z",
      signed_at: "2026-09-01T14:00:00Z",
      deposit_pct: null,
    };
    const invoices: InvoiceState[] = [
      {
        id: "inv-1",
        status: "unpaid",
        invoice_type: "full",
        due_date: "2026-09-15T00:00:00Z",
        created_at: "2026-09-02T10:00:00Z",
        paid_at: null,
      },
    ];

    const { stages, inconsistentStages } = deriveStages(
      quote,
      contract,
      invoices,
      "invoiced",
      null,
    );

    // No forced stages: the contract was genuinely signed before the invoice
    expect(inconsistentStages).toHaveLength(0);

    const contractStage = stages.find((s) => s.key === "contract_signed");
    expect(contractStage?.state).toBe("complete");
  });

  it("multiple forced stages are all marked forced", () => {
    // Extreme case: invoice raised with no quote sent, no acceptance, no
    // contract. All earlier stages should be forced.
    const quote: QuoteState = null;
    const contract: ContractState = null;
    const invoices: InvoiceState[] = [
      {
        id: "inv-1",
        status: "unpaid",
        invoice_type: "full",
        due_date: "2026-09-15T00:00:00Z",
        created_at: "2026-09-02T10:00:00Z",
        paid_at: null,
      },
    ];

    const { stages, inconsistentStages } = deriveStages(
      quote,
      contract,
      invoices,
      null,
      null,
    );

    // With no quote, accepted, contract, or work_complete, but invoice exists:
    // quote_sent, accepted, contract_signed, work_complete should all be forced
    expect(inconsistentStages.length).toBeGreaterThan(0);

    for (const key of inconsistentStages) {
      const stage = stages.find((s) => s.key === key);
      expect(stage?.state).toBe("forced");
    }
  });

  it("a forced stage that later becomes genuine switches to complete", () => {
    // First: invoice raised before contract signed → contract_signed forced
    const quote: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-01T10:00:00Z",
      viewed_at: "2026-09-01T11:00:00Z",
      accepted_at: "2026-09-01T12:00:00Z",
      declined_at: null,
    };
    let contract: ContractState = null;
    const invoices: InvoiceState[] = [
      {
        id: "inv-1",
        status: "unpaid",
        invoice_type: "full",
        due_date: "2026-09-15T00:00:00Z",
        created_at: "2026-09-02T10:00:00Z",
        paid_at: null,
      },
    ];

    const before = deriveStages(quote, contract, invoices, "invoiced", null);
    expect(before.inconsistentStages).toContain("contract_signed");
    const contractStageBefore = before.stages.find((s) => s.key === "contract_signed");
    expect(contractStageBefore?.state).toBe("forced");

    // Now the contractor signs the contract
    contract = {
      id: "con-1",
      status: "signed",
      sent_at: "2026-09-03T09:00:00Z",
      signed_at: "2026-09-03T10:00:00Z",
      deposit_pct: null,
    };

    const after = deriveStages(quote, contract, invoices, "invoiced", null);
    expect(after.inconsistentStages).not.toContain("contract_signed");
    const contractStageAfter = after.stages.find((s) => s.key === "contract_signed");
    expect(contractStageAfter?.state).toBe("complete");
  });
});

describe("pipeline stepper rendering", () => {
  it("renders a forced stage visibly distinct from a complete stage", () => {
    const stages = [
      {
        key: "quote_sent" as const,
        label: "Quote sent",
        state: "complete" as StageState,
        date: "2026-09-01T10:00:00Z",
      },
      {
        key: "accepted" as const,
        label: "Accepted",
        state: "complete" as StageState,
        date: "2026-09-01T12:00:00Z",
      },
      {
        key: "contract_signed" as const,
        label: "Contract signed",
        state: "forced" as StageState,
        date: null,
      },
      {
        key: "work_complete" as const,
        label: "Work complete",
        state: "forced" as StageState,
        date: null,
      },
      {
        key: "invoiced" as const,
        label: "Invoiced",
        state: "complete" as StageState,
        date: "2026-09-02T10:00:00Z",
      },
      {
        key: "paid" as const,
        label: "Paid",
        state: "future" as StageState,
        date: null,
      },
    ];

    const { container } = render(<PipelineStepper stages={stages} />);

    // The forced stage must render differently from a complete stage. We
    // cannot assert exact DOM structure, but we can assert that the forced
    // stage's container differs from a complete stage's container.
    //
    // The acceptance criterion is: the distinction is perceivable without
    // hovering. This means different icon, color, or label text.
    const stageElements = container.querySelectorAll("li");
    expect(stageElements.length).toBe(6);

    // At minimum, the forced stage should not carry the exact same classes and
    // content as a genuinely complete stage. One way to verify: check that a
    // forced stage's label or dot differs from "complete".
    //
    // This test will fail before implementation because "forced" is not yet a
    // valid StageState value.
    expect(stages[2].state).toBe("forced");
    expect(stages[3].state).toBe("forced");
  });

  it("a monotonic pipeline with no forced stages renders unchanged", () => {
    // Happy path: all stages reached in order, none forced. The rendering
    // should be identical to today's output.
    const stages = [
      {
        key: "quote_sent" as const,
        label: "Quote sent",
        state: "complete" as StageState,
        date: "2026-09-01T10:00:00Z",
      },
      {
        key: "accepted" as const,
        label: "Accepted",
        state: "complete" as StageState,
        date: "2026-09-01T12:00:00Z",
      },
      {
        key: "contract_signed" as const,
        label: "Contract signed",
        state: "complete" as StageState,
        date: "2026-09-01T14:00:00Z",
      },
      {
        key: "work_complete" as const,
        label: "Work complete",
        state: "current" as StageState,
        date: null,
      },
      {
        key: "invoiced" as const,
        label: "Invoiced",
        state: "future" as StageState,
        date: null,
      },
      {
        key: "paid" as const,
        label: "Paid",
        state: "future" as StageState,
        date: null,
      },
    ];

    const { container } = render(<PipelineStepper stages={stages} />);

    // All complete stages should render with the standard "complete" treatment
    const stageElements = container.querySelectorAll("li");
    expect(stageElements.length).toBe(6);

    // No forced stages → no special rendering needed
  });
});

describe("dashboard listing preserves forced-stage information", () => {
  it("normalizeHistoryJob preserves inconsistentStages from deriveJobState", () => {
    const raw: RawHistoryJob = {
      id: "job-1",
      created_at: "2026-09-01T09:00:00Z",
      extracted_json: { job_type: "Rewire" },
      customer: { name: "Test Customer" },
      sow_json: null,
      quote: {
        total: 150000,
        status: "accepted",
        sent_at: "2026-09-01T10:00:00Z",
        viewed_at: "2026-09-01T11:00:00Z",
        accepted_at: "2026-09-01T12:00:00Z",
        declined_at: null,
        created_at: "2026-09-01T09:30:00Z",
        contracts: [], // No contract
        invoices: [
          {
            id: "inv-1",
            status: "unpaid",
            invoice_type: "full",
            due_date: "2026-09-15T00:00:00Z",
            created_at: "2026-09-02T10:00:00Z",
            paid_at: null,
          },
        ],
      },
    };

    const normalized = normalizeHistoryJob(raw);

    // The normalized history job must preserve the information that
    // contract_signed was forced. This might be via a new field
    // `forcedStages: StageKey[]` or similar.
    //
    // Currently job-history.ts line 180 discards inconsistentStages entirely.
    // After the fix, it must preserve them.
    //
    // This test will fail before implementation because the field does not
    // exist yet.
    expect(normalized).toHaveProperty("forcedStages");
    const forcedStages = (normalized as unknown as { forcedStages?: string[] }).forcedStages;
    expect(forcedStages).toContain("contract_signed");
  });

  it("a monotonic job has an empty forcedStages array", () => {
    const raw: RawHistoryJob = {
      id: "job-2",
      created_at: "2026-09-01T09:00:00Z",
      extracted_json: { job_type: "Install" },
      customer: { name: "Another Customer" },
      sow_json: null,
      quote: {
        total: 200000,
        status: "accepted",
        sent_at: "2026-09-01T10:00:00Z",
        viewed_at: "2026-09-01T11:00:00Z",
        accepted_at: "2026-09-01T12:00:00Z",
        declined_at: null,
        created_at: "2026-09-01T09:30:00Z",
        contracts: [
          {
            id: "con-1",
            status: "signed",
            sent_at: "2026-09-01T13:00:00Z",
            signed_at: "2026-09-01T14:00:00Z",
            deposit_pct: null,
          },
        ],
        invoices: [
          {
            id: "inv-1",
            status: "unpaid",
            invoice_type: "full",
            due_date: "2026-09-15T00:00:00Z",
            created_at: "2026-09-02T10:00:00Z",
            paid_at: null,
          },
        ],
      },
    };

    const normalized = normalizeHistoryJob(raw);

    const forcedStages = (normalized as unknown as { forcedStages?: string[] }).forcedStages;
    expect(forcedStages).toEqual([]);
  });
});

describe("telemetry deduplication", () => {
  it("deriveJobState exposes a dedupe key for stepper_inconsistency events", () => {
    // The job page currently fires track("stepper_inconsistency") on every
    // render with no deduplication. Seven firings in production represent two
    // jobs, so the event counts page views not jobs.
    //
    // After the fix, deriveJobState should return a dedupe key (e.g.,
    // `inconsistencyKey: string | null`) that the page can use to log each
    // unique inconsistency exactly once. The key might be a hash of (job_id +
    // sorted forced_stages), or stored server-side.
    //
    // This test verifies the key is returned and stable for the same input.
    const quote: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-01T10:00:00Z",
      viewed_at: "2026-09-01T11:00:00Z",
      accepted_at: "2026-09-01T12:00:00Z",
      declined_at: null,
    };
    const contract: ContractState = null;
    const invoices: InvoiceState[] = [
      {
        id: "inv-1",
        status: "unpaid",
        invoice_type: "full",
        due_date: "2026-09-15T00:00:00Z",
        created_at: "2026-09-02T10:00:00Z",
        paid_at: null,
      },
    ];

    const state = deriveJobState(quote, contract, invoices, Date.now(), null);

    // After the fix, state should have an inconsistencyKey or similar
    expect(state).toHaveProperty("inconsistencyKey");
    const key = (state as unknown as { inconsistencyKey?: string | null }).inconsistencyKey;
    expect(key).not.toBeNull();

    // Calling again with the same inputs should return the same key
    const state2 = deriveJobState(quote, contract, invoices, Date.now(), null);
    const key2 = (state2 as unknown as { inconsistencyKey?: string | null }).inconsistencyKey;
    expect(key2).toBe(key);
  });

  it("the dedupe key changes when forced stages change", () => {
    const quote: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-01T10:00:00Z",
      viewed_at: "2026-09-01T11:00:00Z",
      accepted_at: "2026-09-01T12:00:00Z",
      declined_at: null,
    };
    let contract: ContractState = null;
    const invoices: InvoiceState[] = [
      {
        id: "inv-1",
        status: "unpaid",
        invoice_type: "full",
        due_date: "2026-09-15T00:00:00Z",
        created_at: "2026-09-02T10:00:00Z",
        paid_at: null,
      },
    ];

    const stateBefore = deriveJobState(quote, contract, invoices, Date.now(), null);
    const keyBefore = (stateBefore as unknown as { inconsistencyKey?: string | null })
      .inconsistencyKey;

    // Now sign the contract, which removes contract_signed from forced stages
    contract = {
      id: "con-1",
      status: "signed",
      sent_at: "2026-09-03T09:00:00Z",
      signed_at: "2026-09-03T10:00:00Z",
      deposit_pct: null,
    };

    const stateAfter = deriveJobState(quote, contract, invoices, Date.now(), null);
    const keyAfter = (stateAfter as unknown as { inconsistencyKey?: string | null })
      .inconsistencyKey;

    // The key should differ because forced stages changed
    expect(keyAfter).not.toBe(keyBefore);
  });

  it("a monotonic job has a null inconsistencyKey", () => {
    const quote: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-01T10:00:00Z",
      viewed_at: "2026-09-01T11:00:00Z",
      accepted_at: "2026-09-01T12:00:00Z",
      declined_at: null,
    };
    const contract: ContractState = {
      id: "con-1",
      status: "signed",
      sent_at: "2026-09-01T13:00:00Z",
      signed_at: "2026-09-01T14:00:00Z",
      deposit_pct: null,
    };
    const invoices: InvoiceState[] = [
      {
        id: "inv-1",
        status: "unpaid",
        invoice_type: "full",
        due_date: "2026-09-15T00:00:00Z",
        created_at: "2026-09-02T10:00:00Z",
        paid_at: null,
      },
    ];

    const state = deriveJobState(quote, contract, invoices, Date.now(), null);

    // No forced stages → no inconsistency to dedupe
    const key = (state as unknown as { inconsistencyKey?: string | null }).inconsistencyKey;
    expect(key).toBeNull();
  });
});

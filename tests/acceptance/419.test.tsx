/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "glob";

afterEach(cleanup);

describe("Work complete job state (#419)", () => {
  it("adds work_complete stage between contract_signed and invoiced", async () => {
    const mod = await import("@/lib/job-stages");

    // STAGE_ORDER is not exported, but we can check via deriveStages
    const stages = mod.deriveStages(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      "invoiced", // current stage
    );

    const stageKeys = stages.stages.map((s) => s.key);
    const contractIndex = stageKeys.indexOf("contract_signed");
    const invoicedIndex = stageKeys.indexOf("invoiced");
    const workCompleteIndex = stageKeys.indexOf("work_complete");

    expect(workCompleteIndex).toBeGreaterThan(contractIndex);
    expect(workCompleteIndex).toBeLessThan(invoicedIndex);
  });

  it("derives work_complete situation when contract signed and work completed", async () => {
    const mod = await import("@/lib/job-stages");

    const result = mod.deriveSituation(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      Date.now(),
      "2026-01-05T10:00:00Z", // work_completed_at
    );

    expect(result.situation).toBe("work_complete");
  });

  it("derives signed_need_invoice when contract signed but work not completed", async () => {
    const mod = await import("@/lib/job-stages");

    const result = mod.deriveSituation(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      Date.now(),
      null, // work_completed_at is null
    );

    expect(result.situation).toBe("signed_need_invoice");
  });

  it("derives work_complete situation when work completed before invoice raised", async () => {
    const mod = await import("@/lib/job-stages");

    const withCompletion = mod.deriveSituation(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      Date.now(),
      "2026-01-05T10:00:00Z",
    );

    const withoutCompletion = mod.deriveSituation(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      Date.now(),
      null,
    );

    expect(withCompletion.situation).not.toBe(withoutCompletion.situation);
    expect(withCompletion.situation).toBe("work_complete");
    expect(withoutCompletion.situation).toBe("signed_need_invoice");
  });

  it("derives invoice_unpaid when already invoiced, even if work completed later", async () => {
    const mod = await import("@/lib/job-stages");

    const result = mod.deriveSituation(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [
        {
          id: "i1",
          status: "unpaid",
          invoice_type: "final",
          due_date: "2027-02-01", // future date to avoid overdue
          created_at: "2026-01-10",
          paid_at: null,
        },
      ],
      Date.now(),
      "2026-01-15T10:00:00Z", // completed after invoice raised
    );

    expect(result.situation).toBe("invoice_unpaid");
  });

  it("does not break jobs with no contract and an existing invoice", async () => {
    const mod = await import("@/lib/job-stages");

    const result = mod.deriveSituation(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      null, // no contract
      [
        {
          id: "i1",
          status: "unpaid",
          invoice_type: "final",
          due_date: "2027-02-01", // future date to avoid overdue
          created_at: "2026-01-10",
          paid_at: null,
        },
      ],
      Date.now(),
      null, // work_completed_at
    );

    // Should still derive invoice_unpaid as it does today
    expect(result.situation).toBe("invoice_unpaid");
  });

  it("maps work_complete situation to null in dashboardSection", async () => {
    const mod = await import("@/lib/dashboard-sections");

    const section = mod.dashboardSection(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      Date.now(),
      "2026-01-05T10:00:00Z", // work_completed_at
    );

    expect(section).toBeNull();
  });

  it("includes work complete event in timeline when work_completed_at is set", async () => {
    const mod = await import("@/lib/job-stages");

    const timeline = mod.buildTimeline(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      "2026-01-05T10:00:00Z", // work_completed_at
    );

    const workCompleteEvent = timeline.find((e) => e.label === "Work marked complete");
    expect(workCompleteEvent).toBeDefined();
    expect(workCompleteEvent?.at).toBe("2026-01-05T10:00:00Z");
  });

  it("does not include work complete event when work_completed_at is null", async () => {
    const mod = await import("@/lib/job-stages");

    const timeline = mod.buildTimeline(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      null, // work_completed_at is null
    );

    const workCompleteEvent = timeline.find((e) => e.label === "Work marked complete");
    expect(workCompleteEvent).toBeUndefined();
  });

  it("creates the work_completed_at migration file", () => {
    const migrationsDir = join(process.cwd(), "supabase", "migrations");
    const migrations = globSync("*_job_work_completed_at.sql", { cwd: migrationsDir });

    expect(migrations.length).toBeGreaterThan(0);

    const migrationPath = join(migrationsDir, migrations[0]);
    const content = readFileSync(migrationPath, "utf-8");

    expect(content).toContain("jobs");
    expect(content).toContain("work_completed_at");
    expect(content).toMatch(/timestamptz|timestamp with time zone/i);
  });

  it("does not select work_completed_at without the migration present", async () => {
    // The job page selects work_completed_at from jobs
    const pageSource = readFileSync(
      join(process.cwd(), "src", "app", "jobs", "[id]", "page.tsx"),
      "utf-8",
    );

    if (pageSource.includes("work_completed_at")) {
      const migrationsDir = join(process.cwd(), "supabase", "migrations");
      const migrations = globSync("*_job_work_completed_at.sql", { cwd: migrationsDir });
      expect(migrations.length).toBeGreaterThan(0);
    }
  });

  it("renders a mark complete control on the job page when contract is signed", async () => {
    const markCompleteButtonPath = join(
      process.cwd(),
      "src",
      "app",
      "jobs",
      "[id]",
      "mark-complete-button.tsx",
    );
    expect(existsSync(markCompleteButtonPath)).toBe(true);
  });

  it("exports a markWorkComplete action from jobs/actions.ts", async () => {
    const mod = await import("@/app/jobs/actions");
    expect(mod.markWorkComplete).toBeDefined();
    expect(typeof mod.markWorkComplete).toBe("function");
  });

  it("records the decision in areas/motko.md with Precedent: yes", () => {
    const motkoPath = join(process.cwd(), "areas", "motko.md");
    const content = readFileSync(motkoPath, "utf-8");

    // Should contain a decision about stored pipeline state or work_completed_at
    expect(content).toMatch(/stored pipeline state|work_completed_at/i);
    expect(content).toContain("Precedent: yes");
    expect(content).toContain("Ticket: #419");
  });

  it("deriveStages marks work_complete stage as complete when work_completed_at is set", async () => {
    const mod = await import("@/lib/job-stages");

    const stages = mod.deriveStages(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      "invoiced", // current stage
      "2026-01-05T10:00:00Z", // work_completed_at
    );

    const workCompleteStage = stages.stages.find((s) => s.key === "work_complete");
    expect(workCompleteStage).toBeDefined();
    expect(workCompleteStage?.state).toBe("complete");
    expect(workCompleteStage?.date).toBe("2026-01-05T10:00:00Z");
  });

  it("deriveStages marks work_complete stage as current or future when work_completed_at is null", async () => {
    const mod = await import("@/lib/job-stages");

    const stages = mod.deriveStages(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      "work_complete", // current stage
      null, // work_completed_at is null
    );

    const workCompleteStage = stages.stages.find((s) => s.key === "work_complete");
    expect(workCompleteStage).toBeDefined();
    expect(workCompleteStage?.state).toBe("current");
    expect(workCompleteStage?.date).toBeNull();
  });

  it("ensures no job appears in two dashboard sections", async () => {
    const mod = await import("@/lib/dashboard-sections");

    // Test all common situations return exactly one section or null
    const situations = [
      {
        quote: { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
        contract: null,
        invoices: [],
        workCompletedAt: null,
        expectedSection: "awaiting_contract",
      },
      {
        quote: { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
        contract: { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
        invoices: [],
        workCompletedAt: null,
        expectedSection: "awaiting_invoice",
      },
      {
        quote: { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
        contract: { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
        invoices: [],
        workCompletedAt: "2026-01-05T10:00:00Z",
        expectedSection: null,
      },
    ];

    for (const scenario of situations) {
      const section = mod.dashboardSection(
        scenario.quote,
        scenario.contract,
        scenario.invoices,
        Date.now(),
        scenario.workCompletedAt,
      );
      expect(section).toBe(scenario.expectedSection);
    }
  });

  it("stays monotonic when work is marked complete", async () => {
    const mod = await import("@/lib/job-stages");

    // Work complete but invoice not raised yet
    const stages = mod.deriveStages(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      "work_complete",
      "2026-01-05T10:00:00Z",
    );

    const stageStates = stages.stages.map((s) => s.state);
    let seenFuture = false;
    for (const state of stageStates) {
      if (state === "future") seenFuture = true;
      if (seenFuture && state === "complete") {
        throw new Error("Monotonicity broken: complete stage after future stage");
      }
    }

    expect(stages.inconsistentStages).toHaveLength(0);
  });

  it("handles legacy jobs with null work_completed_at without breaking", async () => {
    const mod = await import("@/lib/job-stages");

    // A signed job with null work_completed_at should derive signed_need_invoice
    const legacyJobState = mod.deriveJobState(
      { status: "accepted", sent_at: "2026-01-01", viewed_at: null, accepted_at: "2026-01-02", declined_at: null },
      { id: "c1", status: "signed", sent_at: "2026-01-03", signed_at: "2026-01-04", deposit_pct: null },
      [],
      Date.now(),
      null, // work_completed_at is null
    );

    expect(legacyJobState.situation).toBe("signed_need_invoice");
    expect(legacyJobState.move).toBe("contractor");
  });
});

import { describe, expect, it, vi } from "vitest";

// PNL-4: Voice "What's left?" must name what came off
//
// The voice interface currently reports collected - costs with no VAT or fee
// term. For a VAT-registered trade this includes money that belongs to HMRC.
// This ticket migrates it to report safeToSpend.total and name the deductions.

describe("PNL-4: Voice 'What's left?' reports safe-to-spend total", () => {
  // 1. The spoken figure is the safe-to-spend total, not collected - costs
  it("speaks the safe-to-spend total, not collected minus costs", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    // Fixture: collected £119.04, no costs, no fees, VAT-registered
    // Safe to spend: £99.20 (£119.04 - £0 - £0 - £19.84 VAT)
    const answer = {
      total: 9920,
      costsPaid: 0,
      motkoFees: 0,
      vatToSetAside: 1984,
    };

    const spoken = formatWhatsLeftResponse(answer);

    // Must contain the safe-to-spend figure
    expect(spoken).toMatch(/99.*20|ninety.*nine.*twenty/i);
    // Must NOT contain the collected figure
    expect(spoken).not.toMatch(/119.*04|hundred.*nineteen/i);
  });

  // 2. It names VAT when there is VAT
  it("names VAT and the VAT amount when VAT-registered", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const answer = {
      total: 9920,
      costsPaid: 0,
      motkoFees: 0,
      vatToSetAside: 1984,
    };

    const spoken = formatWhatsLeftResponse(answer);

    expect(spoken).toMatch(/VAT/i);
    expect(spoken).toMatch(/19.*84|nineteen.*eighty.*four/i);
  });

  // 3. It never mentions VAT when not registered — MOST IMPORTANT
  it("never mentions VAT when vatToSetAside is null", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const answer = {
      total: 10000,
      costsPaid: 5000,
      motkoFees: 500,
      vatToSetAside: null, // not VAT-registered
    };

    const spoken = formatWhatsLeftResponse(answer);

    // A non-registered trade told to set aside VAT will act on it
    expect(spoken).not.toMatch(/VAT/i);
  });

  // 4. It omits zero terms
  it("omits zero deductions from the sentence", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    // No costs, no fees, not VAT-registered
    const answer = {
      total: 11904,
      costsPaid: 0,
      motkoFees: 0,
      vatToSetAside: null,
    };

    const spoken = formatWhatsLeftResponse(answer);

    // Should not mention any deductions
    expect(spoken).not.toMatch(/after|cost|fee|VAT/i);
    // But still states the total
    expect(spoken).toMatch(/119.*04|hundred.*nineteen/i);
  });

  // 5. It names fees when a fee was collected
  it("names motko's fees when motkoFees > 0", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const answer = {
      total: 9500,
      costsPaid: 0,
      motkoFees: 500,
      vatToSetAside: null,
    };

    const spoken = formatWhatsLeftResponse(answer);

    expect(spoken).toMatch(/fee/i);
  });

  // 6. Negative total speaks as a shortfall
  it("renders negative total as a shortfall, not a bare minus", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const answer = {
      total: -5000, // down £50.00
      costsPaid: 10000,
      motkoFees: 500,
      vatToSetAside: null,
    };

    const spoken = formatWhatsLeftResponse(answer);

    // Should say "down" and the absolute amount
    expect(spoken).toMatch(/down/i);
    expect(spoken).toMatch(/50|fifty/i);
    // The wording must work in speech, not just contain the digits
    expect(spoken).not.toMatch(/^-|minus -/);
  });

  // 7. The old sentence is gone
  it("does not use the old 'after paying your costs' phrasing", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const answer = {
      total: 5000,
      costsPaid: 3000,
      motkoFees: 0,
      vatToSetAside: null,
    };

    const spoken = formatWhatsLeftResponse(answer);

    // The old sentence said "after paying your costs" — that phrasing
    // described the old arithmetic (collected - costs, nothing else) and
    // would be true of the new number only by accident
    expect(spoken).not.toMatch(/after paying your costs/i);
  });

  // 8. getWhatsLeft returns PNL-1's total (integration test)
  it("getWhatsLeft().total equals getMoneyPosition().safeToSpend.total", async () => {
    // Recording Supabase client pattern from owed-to-you-status-filter.test.ts
    type Filters = Record<string, unknown>;

    const applied: { table: string; filters: Filters }[] = [];
    const rows: Record<string, Record<string, unknown>[]> = {
      contractors: [
        {
          id: "test-contractor-id",
          vat_registered: true,
        },
      ],
      invoices: [],
      costs: [],
      quotes: [],
    };

    const resolvePath = (row: Record<string, unknown>, path: string): unknown =>
      path.split(".").reduce<unknown>((value, key) => {
        if (value === null || typeof value !== "object") return undefined;
        return (value as Record<string, unknown>)[key];
      }, row);

    const applyFilters = (
      table: string,
      filters: Filters,
    ): Record<string, unknown>[] =>
      (rows[table] ?? []).filter((row) =>
        Object.entries(filters).every(
          ([column, value]) => resolvePath(row, column) === value,
        ),
      );

    const makeQuery = (table: string) => {
      const currentFilters: Filters = {};
      applied.push({ table, filters: currentFilters });

      const queryMethods = {
        eq(column: string, value: unknown) {
          currentFilters[column] = value;
          return this;
        },
        single() {
          return {
            data: applyFilters(table, currentFilters)[0] ?? null,
            error: null,
          };
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        select(_columns: string) {
          return {
            eq: queryMethods.eq.bind(queryMethods),
            single: queryMethods.single.bind(queryMethods),
            data: applyFilters(table, currentFilters),
            error: null,
          };
        },
        get data() {
          return applyFilters(table, currentFilters);
        },
        error: null,
      };

      return queryMethods;
    };

    const stubClient = {
      from: (table: string) => makeQuery(table),
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "test-contractor-id" } },
          error: null,
        })),
      },
    };

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: () => stubClient,
    }));

    const { getWhatsLeft } = await import("@/app/ledger/query-actions");
    const { getMoneyPosition } = await import(
      "@/app/jobs/money-position-actions"
    );

    // Call both on the same fixture
    const whatsLeftAnswer = await getWhatsLeft("test-contractor-id");
    const position = await getMoneyPosition("test-contractor-id");

    // The two must agree — comparing the calls, not against a hardcoded
    // number, so they can never drift
    expect(whatsLeftAnswer.total).toBe(position.safeToSpend.total);

    vi.doUnmock("@/lib/supabase/server");
  });

  // 9. The prompt strings agree with the behaviour
  it("prompt strings no longer say 'collected minus costs paid'", async () => {
    const mod = await import("@/lib/voice/ledger-query-prompt");

    // The tool list is exported
    const tools = mod.LEDGER_QUERY_TOOLS;
    const whatsLeftTool = tools.find((t) => t.name === "get_whats_left");

    expect(whatsLeftTool).toBeDefined();

    // The description must not still say "collected minus costs paid"
    const description = whatsLeftTool!.description;
    expect(description).not.toMatch(/collected minus.*costs paid/i);
    expect(description).not.toMatch(/collected.*minus.*paid costs/i);

    // The supported-query list is in the instructions string
    const instructions = mod.buildLedgerQueryInstructions();

    // Find the "what's left" entry (line 156 in the original)
    // Should be something like "5. What's left? — <description>"
    const lines = instructions.split("\n");
    const whatsLeftLine = lines.find((line) =>
      line.match(/5\.\s+What'?s left\?/i),
    );
    expect(whatsLeftLine).toBeDefined();

    // It must not still say "collected minus paid costs"
    expect(whatsLeftLine).not.toMatch(/collected minus.*paid costs/i);
    expect(whatsLeftLine).not.toMatch(/collected.*minus.*costs paid/i);
  });

  // Edge case: total exactly zero
  it("handles zero total with spoken form, not £0.00", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const answer = {
      total: 0,
      costsPaid: 5000,
      motkoFees: 500,
      vatToSetAside: null,
    };

    const spoken = formatWhatsLeftResponse(answer);

    // Should say "nothing" not "zero pounds" or "£0.00"
    expect(spoken).toMatch(/nothing/i);
  });

  // Edge case: multiple deductions present
  it("names all non-zero deductions when multiple are present", async () => {
    const { formatWhatsLeftResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const answer = {
      total: 5000,
      costsPaid: 3000,
      motkoFees: 500,
      vatToSetAside: 1500,
    };

    const spoken = formatWhatsLeftResponse(answer);

    // Should mention costs
    expect(spoken).toMatch(/cost/i);
    // Should mention fees
    expect(spoken).toMatch(/fee/i);
    // Should mention VAT
    expect(spoken).toMatch(/VAT/i);
  });
});

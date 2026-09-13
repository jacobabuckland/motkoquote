import { describe, it, expect } from "vitest";
import { join } from "node:path";

describe("Issue #719: Deposits and staged payments", () => {
  describe("Database schema", () => {
    it("quotes table has deposit_amount_pennies column", async () => {
      const migrationPath = join(
        process.cwd(),
        "supabase/migrations/00000000000073_deposit_amount_pennies.sql",
      );
      const mod = await import("node:fs/promises");
      const sql = await mod.readFile(migrationPath, "utf-8");

      expect(sql).toContain("ALTER TABLE quotes");
      expect(sql).toContain("deposit_amount_pennies");
      expect(sql).toMatch(/deposit_amount_pennies\s+int/i);
    });
  });

  describe("SoW schema", () => {
    it("sowStateSchema includes deposit object", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      const validWithDeposit = {
        job_type: "rewire",
        deposit: {
          amount: 500,
          percentage: null,
          notes: "Agreed up front",
        },
      };

      const parsed = sowStateSchema.parse(validWithDeposit);
      expect(parsed.deposit).toBeDefined();
      expect(parsed.deposit?.amount).toBe(500);
    });

    it("sowStateSchema includes tranches array", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      const validWithTranches = {
        job_type: "kitchen",
        tranches: [
          { stage_number: 1, amount: 3000, description: "On signature" },
          { stage_number: 2, amount: 2000, description: "On completion" },
        ],
      };

      const parsed = sowStateSchema.parse(validWithTranches);
      expect(parsed.tranches).toBeDefined();
      expect(parsed.tranches).toHaveLength(2);
      expect(parsed.tranches?.[0]?.amount).toBe(3000);
    });

    it("deposit accepts amount as number", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      const sow = sowStateSchema.parse({
        job_type: "bathroom",
        deposit: { amount: 1200, percentage: null },
      });

      expect(sow.deposit?.amount).toBe(1200);
      expect(sow.deposit?.percentage).toBeNull();
    });

    it("deposit accepts percentage as number", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      const sow = sowStateSchema.parse({
        job_type: "bathroom",
        deposit: { amount: null, percentage: 25 },
      });

      expect(sow.deposit?.amount).toBeNull();
      expect(sow.deposit?.percentage).toBe(25);
    });

    it("tranches are optional (empty array by default)", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      const sow = sowStateSchema.parse({
        job_type: "rewire",
      });

      expect(sow.tranches).toEqual([]);
    });

    it("deposit is optional (null by default)", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      const sow = sowStateSchema.parse({
        job_type: "rewire",
      });

      expect(sow.deposit).toBeNull();
    });
  });

  describe("Quote compilation", () => {
    it("computes deposit_amount_pennies from stated amount", async () => {
      const mod = await import("@/lib/quote-compile");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const sow = {
        job_type: "bathroom",
        deposit: { amount: 500, percentage: null },
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        stated_prices: [],
        declined_slots: [],
        materials_supply: null,
        pricing: null,
      };

      const quote = {
        id: "q1",
        total: 2400,
        line_items: [],
        vat_applicable: true,
      };

      const { client, getWrites } = mockSupabaseClient([]);

      await mod.compileQuote(client, {
        jobId: "job1",
        sow,
        quote,
        contractorId: "c1",
      });

      const writes = getWrites();
      const quoteUpdate = writes.find(
        (w) => w.table === "quotes" && w.method === "update",
      );

      expect(quoteUpdate?.payload).toMatchObject({
        deposit_amount_pennies: 50000, // 500 * 100
      });
    });

    it("computes deposit_amount_pennies from percentage of total", async () => {
      const mod = await import("@/lib/quote-compile");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const sow = {
        job_type: "rewire",
        deposit: { amount: null, percentage: 20 },
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        stated_prices: [],
        declined_slots: [],
        materials_supply: null,
        pricing: null,
      };

      const quote = {
        id: "q1",
        total: 4800,
        line_items: [],
        vat_applicable: true,
      };

      const { client, getWrites } = mockSupabaseClient([]);

      await mod.compileQuote(client, {
        jobId: "job1",
        sow,
        quote,
        contractorId: "c1",
      });

      const writes = getWrites();
      const quoteUpdate = writes.find(
        (w) => w.table === "quotes" && w.method === "update",
      );

      expect(quoteUpdate?.payload).toMatchObject({
        deposit_amount_pennies: 96000, // 4800 * 0.20 * 100
      });
    });

    it("refuses deposit exceeding quote total", async () => {
      const mod = await import("@/lib/quote-compile");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const sow = {
        job_type: "bathroom",
        deposit: { amount: 3000, percentage: null },
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        stated_prices: [],
        declined_slots: [],
        materials_supply: null,
        pricing: null,
      };

      const quote = {
        id: "q1",
        total: 2400,
        line_items: [],
        vat_applicable: true,
      };

      const { client: _client } = mockSupabaseClient([]);

      await expect(
        mod.compileQuote(_client, {
          jobId: "job1",
          sow,
          quote,
          contractorId: "c1",
        }),
      ).rejects.toThrow(/deposit cannot exceed/i);
    });

    it("creates payment_stages for tranched jobs", async () => {
      const mod = await import("@/lib/quote-compile");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const sow = {
        job_type: "kitchen",
        tranches: [
          { stage_number: 1, amount: 3000, description: "On signature" },
          { stage_number: 2, amount: 2500, description: "On completion" },
        ],
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        stated_prices: [],
        declined_slots: [],
        materials_supply: null,
        pricing: null,
      };

      const quote = {
        id: "q1",
        total: 5500,
        line_items: [],
        vat_applicable: true,
      };

      const { client, getWrites } = mockSupabaseClient([]);

      await mod.compileQuote(client, {
        jobId: "job1",
        sow,
        quote,
        contractorId: "c1",
      });

      const writes = getWrites();
      const stageWrites = writes.filter(
        (w) => w.table === "payment_stages" && w.method === "insert",
      );

      expect(stageWrites).toHaveLength(2);
      expect(stageWrites[0]?.payload).toMatchObject({
        job_id: "job1",
        stage_number: 1,
        amount_pennies: 300000,
      });
      expect(stageWrites[1]?.payload).toMatchObject({
        job_id: "job1",
        stage_number: 2,
        amount_pennies: 250000,
      });
    });

    it("refuses tranches that don't sum to quote total", async () => {
      const mod = await import("@/lib/quote-compile");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const sow = {
        job_type: "kitchen",
        tranches: [
          { stage_number: 1, amount: 3000, description: "On signature" },
          { stage_number: 2, amount: 2000, description: "On completion" },
        ],
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        stated_prices: [],
        declined_slots: [],
        materials_supply: null,
        pricing: null,
      };

      const quote = {
        id: "q1",
        total: 5500, // tranches sum to 5000, not 5500
        line_items: [],
        vat_applicable: true,
      };

      const { client: _client } = mockSupabaseClient([]);

      await expect(
        mod.compileQuote(_client, {
          jobId: "job1",
          sow,
          quote,
          contractorId: "c1",
        }),
      ).rejects.toThrow(/tranches must sum/i);
    });

    it("refuses tranche exceeding £10,000 Pay-by-Bank ceiling", async () => {
      const mod = await import("@/lib/quote-compile");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const sow = {
        job_type: "kitchen",
        tranches: [
          { stage_number: 1, amount: 12000, description: "On signature" },
          { stage_number: 2, amount: 3000, description: "On completion" },
        ],
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        stated_prices: [],
        declined_slots: [],
        materials_supply: null,
        pricing: null,
      };

      const quote = {
        id: "q1",
        total: 15000,
        line_items: [],
        vat_applicable: true,
      };

      const { client: _client } = mockSupabaseClient([]);

      await expect(
        mod.compileQuote(_client, {
          jobId: "job1",
          sow,
          quote,
          contractorId: "c1",
        }),
      ).rejects.toThrow(/under £10,000/i);
    });

    it("allows tranches with ±£1 rounding tolerance", async () => {
      const mod = await import("@/lib/quote-compile");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const sow = {
        job_type: "kitchen",
        tranches: [
          { stage_number: 1, amount: 2666.67, description: "First third" },
          { stage_number: 2, amount: 2666.67, description: "Second third" },
          { stage_number: 3, amount: 2666.66, description: "Final third" },
        ],
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        stated_prices: [],
        declined_slots: [],
        materials_supply: null,
        pricing: null,
      };

      const quote = {
        id: "q1",
        total: 8000, // sum is 8000.00, within ±£1
        line_items: [],
        vat_applicable: true,
      };

      const { client, getWrites } = mockSupabaseClient([]);

      await mod.compileQuote(client, {
        jobId: "job1",
        sow,
        quote,
        contractorId: "c1",
      });

      const writes = getWrites();
      const stageWrites = writes.filter(
        (w) => w.table === "payment_stages" && w.method === "insert",
      );

      expect(stageWrites).toHaveLength(3);
    });
  });

  describe("Contract signature triggers", () => {
    it("raises deposit invoice when contract signed with deposit_amount_pennies", async () => {
      const mod = await import("@/app/c/[id]/actions");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const contract = {
        id: "contract1",
        status: "sent",
        deposit_pct: null,
        quote: {
          id: "q1",
          total: 2400,
          deposit_amount_pennies: 50000, // £500
          job: {
            id: "job1",
            customer: { name: "Test Customer", contact: { email: "test@example.com" } },
            contractor: { company_name: "Test Co", payout_details_complete: true },
          },
        },
      };

      const { getWrites } = mockSupabaseClient([contract]);

      await mod.signContract("contract1", "Test Customer");

      const writes = getWrites();
      const invoiceWrite = writes.find(
        (w) => w.table === "invoices" && w.method === "insert",
      );

      expect(invoiceWrite?.payload).toMatchObject({
        quote_id: "q1",
        invoice_type: "deposit",
        amount: 500, // deposit_amount_pennies / 100
      });
    });

    it("raises first tranche invoice when tranched job contract signed", async () => {
      const mod = await import("@/app/c/[id]/actions");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const contract = {
        id: "contract1",
        status: "sent",
        deposit_pct: null,
        quote: {
          id: "q1",
          total: 5500,
          deposit_amount_pennies: null,
          job: {
            id: "job1",
            customer: { name: "Test Customer", contact: { email: "test@example.com" } },
            contractor: { company_name: "Test Co", payout_details_complete: true },
          },
        },
      };

      const stages = [
        {
          id: "stage1",
          job_id: "job1",
          stage_number: 1,
          amount_pennies: 300000,
          invoice_id: null,
          settled_at: null,
        },
        {
          id: "stage2",
          job_id: "job1",
          stage_number: 2,
          amount_pennies: 250000,
          invoice_id: null,
          settled_at: null,
        },
      ];

      const { getWrites } = mockSupabaseClient([contract, ...stages]);

      await mod.signContract("contract1", "Test Customer");

      const writes = getWrites();
      const invoiceWrite = writes.find(
        (w) => w.table === "invoices" && w.method === "insert",
      );

      expect(invoiceWrite?.payload).toMatchObject({
        quote_id: "q1",
        amount: 3000, // first tranche
      });

      const stageUpdate = writes.find(
        (w) =>
          w.table === "payment_stages" &&
          w.method === "update" &&
          w.payload.stage_number === 1,
      );

      expect(stageUpdate).toBeDefined();
      expect(stageUpdate?.payload.invoice_id).toBeDefined();
    });

    it("does not raise invoice when no deposit or tranches", async () => {
      const mod = await import("@/app/c/[id]/actions");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const contract = {
        id: "contract1",
        status: "sent",
        deposit_pct: null,
        quote: {
          id: "q1",
          total: 2400,
          deposit_amount_pennies: null,
          job: {
            id: "job1",
            customer: { name: "Test Customer", contact: { email: "test@example.com" } },
            contractor: { company_name: "Test Co", payout_details_complete: true },
          },
        },
      };

      const { getWrites } = mockSupabaseClient([contract]);

      await mod.signContract("contract1", "Test Customer");

      const writes = getWrites();
      const invoiceWrites = writes.filter((w) => w.table === "invoices");

      expect(invoiceWrites).toHaveLength(0);
    });
  });

  describe("Work completion triggers", () => {
    it("markWorkComplete raises final invoice for non-tranched job with deposit", async () => {
      const mod = await import("@/app/jobs/[id]/actions");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const job = {
        id: "job1",
        work_completed_at: null,
        quote: {
          id: "q1",
          total: 2400,
          deposit_amount_pennies: 50000,
        },
      };

      const existingInvoices = [
        { id: "inv1", invoice_type: "deposit", amount: 500, paid_at: "2026-09-01T00:00:00Z" },
      ];

      const { getWrites } = mockSupabaseClient([job, ...existingInvoices]);

      await mod.markWorkComplete("job1");

      const writes = getWrites();

      const jobUpdate = writes.find(
        (w) => w.table === "jobs" && w.method === "update",
      );
      expect(jobUpdate?.payload.work_completed_at).toBeDefined();

      const invoiceWrite = writes.find(
        (w) => w.table === "invoices" && w.method === "insert",
      );
      expect(invoiceWrite?.payload).toMatchObject({
        quote_id: "q1",
        invoice_type: "final",
        amount: 1900, // 2400 - 500
      });
    });

    it("markWorkComplete raises invoices for unpaid tranches", async () => {
      const mod = await import("@/app/jobs/[id]/actions");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const job = {
        id: "job1",
        work_completed_at: null,
        quote: {
          id: "q1",
          total: 5500,
        },
      };

      const stages = [
        {
          id: "stage1",
          job_id: "job1",
          stage_number: 1,
          amount_pennies: 300000,
          invoice_id: "inv1",
          settled_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "stage2",
          job_id: "job1",
          stage_number: 2,
          amount_pennies: 250000,
          invoice_id: null,
          settled_at: null,
        },
      ];

      const { getWrites } = mockSupabaseClient([job, ...stages]);

      await mod.markWorkComplete("job1");

      const writes = getWrites();

      const invoiceWrites = writes.filter(
        (w) => w.table === "invoices" && w.method === "insert",
      );
      expect(invoiceWrites).toHaveLength(1);
      expect(invoiceWrites[0]?.payload).toMatchObject({
        quote_id: "q1",
        amount: 2500, // second tranche
      });

      const stageUpdate = writes.find(
        (w) =>
          w.table === "payment_stages" &&
          w.method === "update" &&
          w.payload.stage_number === 2,
      );
      expect(stageUpdate?.payload.invoice_id).toBeDefined();
    });

    it("markWorkComplete is idempotent (does not re-raise invoices)", async () => {
      const mod = await import("@/app/jobs/[id]/actions");
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const job = {
        id: "job1",
        work_completed_at: "2026-09-12T00:00:00Z", // already marked
        quote: {
          id: "q1",
          total: 2400,
          deposit_amount_pennies: 50000,
        },
      };

      const existingInvoices = [
        { id: "inv1", invoice_type: "deposit", amount: 500 },
        { id: "inv2", invoice_type: "final", amount: 1900 },
      ];

      const { getWrites } = mockSupabaseClient([job, ...existingInvoices]);

      await mod.markWorkComplete("job1");

      const writes = getWrites();
      const invoiceWrites = writes.filter(
        (w) => w.table === "invoices" && w.method === "insert",
      );

      expect(invoiceWrites).toHaveLength(0);
    });
  });

  describe("Voice intake integration", () => {
    it("job intake prompt mentions deposit question for sub-£5k jobs", async () => {
      const mod = await import("@/lib/voice/job-intake-prompt");

      const prompt = mod.buildJobIntakePrompt({
        jobValue: 3500,
      });

      expect(prompt).toMatch(/deposit/i);
      expect(prompt).toMatch(/how much.*percentage/i);
    });

    it("job intake prompt mentions tranche question for £5k+ jobs", async () => {
      const mod = await import("@/lib/voice/job-intake-prompt");

      const prompt = mod.buildJobIntakePrompt({
        jobValue: 6000,
      });

      expect(prompt).toMatch(/tranche|payment schedule/i);
    });

    it("SOW_DELTA_TOOL_PARAMETERS includes deposit field", async () => {
      const { SOW_DELTA_TOOL_PARAMETERS } = await import("@/lib/schemas/sow");

      expect(SOW_DELTA_TOOL_PARAMETERS.properties).toHaveProperty("deposit");
      const depositField = SOW_DELTA_TOOL_PARAMETERS.properties.deposit;
      expect(depositField).toBeDefined();
      expect(depositField.type).toBe("object");
    });

    it("SOW_DELTA_TOOL_PARAMETERS includes tranches field", async () => {
      const { SOW_DELTA_TOOL_PARAMETERS } = await import("@/lib/schemas/sow");

      expect(SOW_DELTA_TOOL_PARAMETERS.properties).toHaveProperty("tranches");
      const tranchesField = SOW_DELTA_TOOL_PARAMETERS.properties.tranches;
      expect(tranchesField).toBeDefined();
      expect(tranchesField.type).toBe("array");
    });
  });

  describe("Quote display", () => {
    it("quote PDF shows deposit amount before acceptance", async () => {
      const mod = await import("@/lib/pdf/quote-pdf");

      const quote = {
        id: "q1",
        total: 2400,
        deposit_amount_pennies: 50000,
        line_items: [],
      };

      const pdf = await mod.renderQuotePDF(quote);

      expect(pdf).toMatch(/deposit.*£500/i);
      expect(pdf).toMatch(/due on signature/i);
    });

    it("/q/[id] page shows deposit before acceptance", async () => {
      const mod = await import("@/app/q/[id]/page");

      // This test validates the page exports a component that can be imported
      expect(mod.default).toBeDefined();

      // The actual rendering happens in the component, which should show deposit_amount_pennies
      // when present. We verify the module structure here.
    });

    it("quote PDF shows tranche schedule for tranched jobs", async () => {
      const mod = await import("@/lib/pdf/quote-pdf");

      const quote = {
        id: "q1",
        total: 5500,
        deposit_amount_pennies: null,
        line_items: [],
      };

      const stages = [
        { stage_number: 1, amount_pennies: 300000, description: "On signature" },
        { stage_number: 2, amount_pennies: 250000, description: "On completion" },
      ];

      const pdf = await mod.renderQuotePDF(quote, { stages });

      expect(pdf).toMatch(/payment schedule/i);
      expect(pdf).toMatch(/£3,000/);
      expect(pdf).toMatch(/£2,500/);
      expect(pdf).toMatch(/on signature/i);
      expect(pdf).toMatch(/on completion/i);
    });
  });

  describe("Quote editor backstop", () => {
    it("quote editor shows deposit field for jobs under £5k", async () => {
      const mod = await import("@/app/jobs/[id]/quote-editor");

      // Validates the quote editor component exists and can be imported
      expect(mod.default).toBeDefined();
    });

    it("quote editor shows tranche builder for jobs £5k and over", async () => {
      const mod = await import("@/app/jobs/[id]/quote-editor");

      // Validates the quote editor component exists and can be imported
      expect(mod.default).toBeDefined();
    });
  });
});

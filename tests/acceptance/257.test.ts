import { describe, it, expect, vi, beforeEach } from "vitest";

describe("LED-6: Voice query over the ledger (bounded question set)", () => {
  describe("Query interpretation", () => {
    it("classifies 'What am I owed?' as owed_to_you query", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const result = await interpretLedgerQuery("What am I owed?");

      expect(result.type).toBe("owed_to_you");
    });

    it("classifies 'What do I owe?' as you_owe query", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const result = await interpretLedgerQuery("What do I owe?");

      expect(result.type).toBe("you_owe");
      expect(result.counterparty).toBeUndefined();
    });

    it("classifies 'What do I owe Screwfix?' as you_owe query with counterparty", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const result = await interpretLedgerQuery("What do I owe Screwfix?");

      expect(result.type).toBe("you_owe");
      expect(result.counterparty).toBe("Screwfix");
    });

    it("classifies 'What did the Henderson job make?' as job_profit query", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const result = await interpretLedgerQuery(
        "What did the Henderson job make?",
      );

      expect(result.type).toBe("job_profit");
      expect(result.job_reference).toBeTruthy();
      expect(result.job_reference?.toLowerCase()).toContain("henderson");
    });

    it("classifies \"What's left?\" as whats_left query", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const result = await interpretLedgerQuery("What's left?");

      expect(result.type).toBe("whats_left");
    });

    it("classifies out-of-scope question as out_of_scope", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const result = await interpretLedgerQuery(
        "How much did I make last month?",
      );

      expect(result.type).toBe("out_of_scope");
    });

    it("classifies trend comparison as out_of_scope", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const result = await interpretLedgerQuery(
        "Compare the Henderson job to the Smith job",
      );

      expect(result.type).toBe("out_of_scope");
    });

    it("recognizes common rephrasings of 'What am I owed?'", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const phrasings = [
        "Who owes me money?",
        "What's owed to me?",
        "How much am I owed?",
        "What are my outstanding invoices?",
      ];

      for (const phrasing of phrasings) {
        const result = await interpretLedgerQuery(phrasing);
        expect(result.type).toBe("owed_to_you");
      }
    });

    it("recognizes common rephrasings of 'What do I owe?'", async () => {
      const { interpretLedgerQuery } = await import(
        "@/app/ledger/query-actions"
      );

      const phrasings = [
        "Who do I owe?",
        "What costs haven't I paid?",
        "What's outstanding?",
        "What bills do I need to pay?",
      ];

      for (const phrasing of phrasings) {
        const result = await interpretLedgerQuery(phrasing);
        expect(result.type).toBe("you_owe");
      }
    });
  });

  describe("Computation delegates to existing functions (no new arithmetic)", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("owed_to_you query calls getMoneyPosition and returns owedToYou", async () => {
      // Mock getMoneyPosition from LED-4
      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: vi.fn(async () => ({
          owedToYou: [
            {
              customerId: "c1",
              customerName: "Henderson",
              totalOwed: 152000, // £1,520 in pence
              oldestInvoiceAgeDays: 12,
              unpaidInvoiceIds: ["inv1"],
            },
          ],
          youOwe: [],
          vat: null,
          whatsLeft: 0,
        })),
      }));

      const { computeLedgerAnswer } = await import("@/lib/ledger-answer");
      const { getMoneyPosition } = await import(
        "@/app/jobs/money-position-actions"
      );

      await computeLedgerAnswer(
        { type: "owed_to_you" },
        "contractor-id-123",
      );

      expect(getMoneyPosition).toHaveBeenCalledOnce();
    });

    it("you_owe query calls getMoneyPosition and returns youOwe", async () => {
      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: vi.fn(async () => ({
          owedToYou: [],
          youOwe: [
            {
              counterpartyId: "cp1",
              counterpartyName: "Screwfix",
              totalOwed: 24000, // £240 in pence
              jobCount: 2,
              costIds: ["cost1", "cost2"],
            },
          ],
          vat: null,
          whatsLeft: 0,
        })),
      }));

      const { computeLedgerAnswer } = await import("@/lib/ledger-answer");
      const { getMoneyPosition } = await import(
        "@/app/jobs/money-position-actions"
      );

      await computeLedgerAnswer({ type: "you_owe" }, "contractor-id-123");

      expect(getMoneyPosition).toHaveBeenCalledOnce();
    });

    it("job_profit query calls getJobPnL from LED-2", async () => {
      // Mock getJobPnL from LED-2
      vi.doMock("@/app/jobs/[id]/pnl-actions", () => ({
        getJobPnL: vi.fn(async () => ({
          invoicedNet: 120000, // £1,200 in pence
          costsNet: 72000, // £720 in pence
          grossProfit: 48000, // £480 in pence
          marginPct: 40.0,
          vatCollected: 24000,
          vatOnCosts: 14400,
          vatPosition: 9600,
          unpaidCosts: 0,
          hasInvoice: true,
        })),
      }));

      const { computeLedgerAnswer } = await import("@/lib/ledger-answer");
      const { getJobPnL } = await import("@/app/jobs/[id]/pnl-actions");

      await computeLedgerAnswer(
        { type: "job_profit", job_reference: "henderson" },
        "contractor-id-123",
      );

      expect(getJobPnL).toHaveBeenCalledOnce();
    });

    it("whats_left query calls getMoneyPosition and returns whatsLeft", async () => {
      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: vi.fn(async () => ({
          owedToYou: [],
          youOwe: [],
          vat: null,
          whatsLeft: 210000, // £2,100 in pence
        })),
      }));

      const { computeLedgerAnswer } = await import("@/lib/ledger-answer");
      const { getMoneyPosition } = await import(
        "@/app/jobs/money-position-actions"
      );

      await computeLedgerAnswer({ type: "whats_left" }, "contractor-id-123");

      expect(getMoneyPosition).toHaveBeenCalledOnce();
    });

    it("computeLedgerAnswer performs NO arithmetic itself", async () => {
      // This test asserts that computeLedgerAnswer is pure composition:
      // it calls existing functions and returns their results, but never
      // performs addition, subtraction, multiplication, or division.
      const { computeLedgerAnswer } = await import("@/lib/ledger-answer");

      const sourceCode = computeLedgerAnswer.toString();

      // Reject any arithmetic operators in the function body
      expect(sourceCode).not.toMatch(/\s+\+\s+/); // addition
      expect(sourceCode).not.toMatch(/\s+-\s+/); // subtraction
      expect(sourceCode).not.toMatch(/\s+\*\s+/); // multiplication
      expect(sourceCode).not.toMatch(/\s+\/\s+/); // division
      expect(sourceCode).not.toMatch(/Math\.(round|floor|ceil)/); // rounding
    });
  });

  describe("Answer rendering (prose only, no arithmetic)", () => {
    it("renderLedgerAnswer receives pence amounts and returns prose", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "owed_to_you" },
        {
          owedToYou: [
            {
              customerId: "c1",
              customerName: "Henderson",
              totalOwed: 80000, // £800 in pence
              oldestInvoiceAgeDays: 12,
            },
          ],
        },
      );

      expect(typeof answer).toBe("string");
      expect(answer.length).toBeGreaterThan(0);
      // Answer should mention the amount in words
      expect(answer.toLowerCase()).toMatch(/eight hundred|800/);
      expect(answer.toLowerCase()).toMatch(/pound/);
    });

    it("renderLedgerAnswer performs NO arithmetic", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const sourceCode = renderLedgerAnswer.toString();

      // Reject any arithmetic operators in the rendering function
      expect(sourceCode).not.toMatch(/\s+\+\s+/);
      expect(sourceCode).not.toMatch(/\s+-\s+/);
      expect(sourceCode).not.toMatch(/\s+\*\s+/);
      expect(sourceCode).not.toMatch(/\s+\/\s+/);
      expect(sourceCode).not.toMatch(/Math\.(round|floor|ceil)/);
    });

    it("amounts are spoken in British English forms", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "whats_left" },
        { whatsLeft: 124000 }, // £1,240
      );

      // Accept either "twelve hundred and forty" or "one thousand two hundred and forty"
      const britishForms = [
        /twelve hundred (and )?forty/i,
        /one thousand,? two hundred (and )?forty/i,
      ];

      const matchesAnyForm = britishForms.some((pattern) =>
        pattern.test(answer),
      );
      expect(matchesAnyForm).toBe(true);
    });
  });

  describe("Privacy: customer names only when named in question", () => {
    it("owed_to_you query does NOT speak customer names when question is generic", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "owed_to_you", speakCustomerNames: false },
        {
          owedToYou: [
            {
              customerId: "c1",
              customerName: "Henderson",
              totalOwed: 80000,
              oldestInvoiceAgeDays: 12,
            },
          ],
        },
      );

      // Should NOT contain customer name when generic query
      expect(answer).not.toContain("Henderson");
    });

    it("job_profit query DOES speak customer name when named in question", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        {
          type: "job_profit",
          job_reference: "Henderson",
          speakCustomerNames: true,
        },
        {
          jobProfit: {
            customerName: "Henderson",
            invoicedNet: 120000,
            costsNet: 72000,
            grossProfit: 48000,
            hasInvoice: true,
          },
        },
      );

      // SHOULD contain customer name when explicitly named in question
      expect(answer).toContain("Henderson");
    });

    it("you_owe query always speaks counterparty names", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "you_owe" },
        {
          youOwe: [
            {
              counterpartyName: "Screwfix",
              totalOwed: 24000,
              jobCount: 2,
            },
          ],
        },
      );

      // ALWAYS speak counterparty names (they are business entities, not homeowners)
      expect(answer).toContain("Screwfix");
    });
  });

  describe("Out-of-scope refusal", () => {
    it("out-of-scope query receives plain-language refusal listing available queries", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer({ type: "out_of_scope" }, {});

      expect(answer.toLowerCase()).toMatch(/can'?t answer|don'?t know/);
      // Should list at least some of the available queries
      expect(answer.toLowerCase()).toMatch(/owe|left|job|made/);
    });

    it("subsequent out-of-scope queries use shorter refusal", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const firstRefusal = await renderLedgerAnswer(
        { type: "out_of_scope", isFirstRefusal: true },
        {},
      );
      const secondRefusal = await renderLedgerAnswer(
        { type: "out_of_scope", isFirstRefusal: false },
        {},
      );

      // Second refusal should be shorter than first
      expect(secondRefusal.length).toBeLessThan(firstRefusal.length);
    });
  });

  describe("Empty states", () => {
    it("owed_to_you with no invoices says nothing is owed", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "owed_to_you" },
        { owedToYou: [] },
      );

      expect(answer.toLowerCase()).toMatch(
        /not owed|no (outstanding )?invoices|nothing/,
      );
    });

    it("you_owe with no unpaid costs says all costs are paid", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "you_owe" },
        { youOwe: [] },
      );

      expect(answer.toLowerCase()).toMatch(
        /all (costs )?paid|don'?t owe|nothing/,
      );
    });

    it("job with no invoice yet explains costs but no revenue", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "job_profit", job_reference: "Henderson" },
        {
          jobProfit: {
            customerName: "Henderson",
            invoicedNet: 0,
            costsNet: 24000, // £240 spent
            grossProfit: -24000,
            hasInvoice: false,
          },
        },
      );

      expect(answer.toLowerCase()).toMatch(/not (yet )?invoiced/);
      expect(answer.toLowerCase()).toMatch(/spent|costs/);
    });

    it("job with costs exceeding revenue speaks the loss plainly", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        { type: "job_profit", job_reference: "Henderson" },
        {
          jobProfit: {
            customerName: "Henderson",
            invoicedNet: 20000, // £200
            costsNet: 26000, // £260
            grossProfit: -6000, // -£60
            hasInvoice: true,
          },
        },
      );

      expect(answer.toLowerCase()).toMatch(/lost|loss/);
      expect(answer.toLowerCase()).toMatch(/sixty|60/);
    });
  });

  describe("Ambiguous matches", () => {
    it("multiple jobs matching customer name asks for clarification", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        {
          type: "job_profit",
          job_reference: "Smith",
          ambiguousMatches: [
            { job_reference: "MK-1234", updated_at: "2026-08-10" },
            { job_reference: "MK-1189", updated_at: "2026-07-28" },
          ],
        },
        {},
      );

      expect(answer.toLowerCase()).toMatch(/found|which/);
      expect(answer).toContain("MK-1234");
      expect(answer).toContain("MK-1189");
    });

    it("no matching counterparty asks for clarification", async () => {
      const { renderLedgerAnswer } = await import("@/lib/ledger-answer");

      const answer = await renderLedgerAnswer(
        {
          type: "you_owe",
          counterparty: "Wickes",
          noMatch: true,
          suggestions: ["Screwfix", "Travis Perkins"],
        },
        {},
      );

      expect(answer.toLowerCase()).toMatch(/don'?t have|no costs/);
      expect(answer).toContain("Wickes");
      // Should offer suggestions
      expect(answer).toContain("Screwfix");
    });
  });

  describe("Module existence", () => {
    it("voice query page exists", async () => {
      const mod = await import("@/app/ledger/voice/page");
      expect(mod.default).toBeDefined();
    });

    it("voice query loading skeleton exists", async () => {
      const mod = await import("@/app/ledger/voice/loading");
      expect(mod.default).toBeDefined();
    });

    it("query actions module exists", async () => {
      const mod = await import("@/app/ledger/query-actions");
      expect(mod.interpretLedgerQuery).toBeDefined();
    });

    it("ledger answer module exists", async () => {
      const mod = await import("@/lib/ledger-answer");
      expect(mod.computeLedgerAnswer).toBeDefined();
      expect(mod.renderLedgerAnswer).toBeDefined();
    });

    it("ledger query prompts module exists", async () => {
      const mod = await import("@/lib/ledger-query-prompts");
      expect(mod.LEDGER_QUERY_SYSTEM_PROMPT).toBeDefined();
      expect(mod.LEDGER_ANSWER_SYSTEM_PROMPT).toBeDefined();
    });

    it("voice ledger query component exists", async () => {
      const mod = await import("@/components/voice/ledger-query");
      expect(mod.LedgerQuery).toBeDefined();
    });
  });
});

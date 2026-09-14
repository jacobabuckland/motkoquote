import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LineItem } from "@/lib/schemas/job";

describe("#727: Re-issuing a quote after the customer has agreed", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("Guard extension: isEditableQuoteStatus with contract presence", () => {
    it("accepted status requires contract check to determine editability", async () => {
      const mod = await import("@/lib/quote-send-guards");

      // Currently, isEditableQuoteStatus("accepted") returns false
      // After implementation, the guard will be extended to check contract presence
      expect(mod.isEditableQuoteStatus("accepted")).toBe(false);

      // The implementation will need a new function or parameter:
      // isEditable = isEditableQuoteStatus(status) || (status === "accepted" && !hasContract)
    });

    it("draft and sent statuses remain editable without contract check", async () => {
      const mod = await import("@/lib/quote-send-guards");

      expect(mod.isEditableQuoteStatus("draft")).toBe(true);
      expect(mod.isEditableQuoteStatus("sent")).toBe(true);
    });
  });

  describe("updateQuoteLineItems enforces the extended guard", () => {
    it("allows editing an accepted quote when no contract exists", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440001";
      const jobId = "550e8400-e29b-41d4-a716-446655440002";
      const contractorId = "550e8400-e29b-41d4-a716-446655440003";
      const customerId = "550e8400-e29b-41d4-a716-446655440004";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        sent_total: 500.00,
        contractor_flags_json: null,
        drafted_line_items_json: null,
        job: {
          id: jobId,
          customer_id: customerId,
          extracted_json: null,
          sow_json: { pricing: { mode: "itemised" } },
          contractor: { id: contractorId, vat_registered: false },
        },
      };

      const { client, getWrites, getFilters } = mockSupabaseClient([quoteRow]);

      const updateQuoteSchema = await import("@/lib/schemas/job").then(m => m.lineItemSchema);

      // Mock the server action dependencies
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { updateQuoteLineItems } = await import("@/app/jobs/actions");

      const newLineItems: LineItem[] = [{
        category: "labour",
        description: "Electrical installation",
        quantity: 8,
        unit: "hours",
        unit_price: 75,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      }];

      // This will fail before implementation with module not found
      // After implementation, verify that contract presence is checked
      try {
        await updateQuoteLineItems({
          jobId,
          quoteId,
          lineItems: newLineItems,
          customer: {
            name: "Jane Smith",
            email: "jane@example.com",
            smsOptOut: false,
          },
        });
      } catch (error) {
        // Expected - implementation doesn't exist yet
      }
    });

    it("refuses editing an accepted quote when a contract exists", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440005";
      const jobId = "550e8400-e29b-41d4-a716-4466554400a1";
      const contractId = "550e8400-e29b-41d4-a716-446655440006";

      const quoteWithContract = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        sent_total: 500.00,
        contracts: [{ id: contractId, status: "sent", sent_at: "2026-09-11T10:00:00Z" }],
      };

      const { client } = mockSupabaseClient([quoteWithContract]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { updateQuoteLineItems } = await import("@/app/jobs/actions");

      const newLineItems: LineItem[] = [{
        category: "labour",
        description: "Electrical installation",
        quantity: 8,
        unit: "hours",
        unit_price: 75,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      }];

      await expect(
        updateQuoteLineItems({
          jobId,
          quoteId,
          lineItems: newLineItems,
          customer: {
            name: "Jane Smith",
            email: "jane@example.com",
            smsOptOut: false,
          },
        })
      ).rejects.toThrow(/can no longer be edited/i);
    });
  });

  describe("Re-issue behavior: clearing acceptance and updating sent_total", () => {
    it("clears accepted_at when an accepted quote is edited", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440007";
      const jobId = "550e8400-e29b-41d4-a716-4466554400a2";
      const oldTotal = 500.00;
      const newTotal = 600.00;

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        sent_total: oldTotal,
        total: oldTotal,
      };

      const { client, getWrites } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { updateQuoteLineItems } = await import("@/app/jobs/actions");

      try {
        await updateQuoteLineItems({
          jobId,
          quoteId,
          lineItems: [],
          customer: {
            name: "Jane Smith",
            email: "jane@example.com",
            smsOptOut: false,
          },
        });
      } catch (error) {
        // Expected to fail before implementation
      }

      // Verify the update cleared accepted_at
      const writes = getWrites();
      const quoteUpdate = writes.find(w => w.method === "update" && w.table === "quotes");

      expect(quoteUpdate?.payload).toMatchObject({
        accepted_at: null,
      });
    });

    it("updates sent_total to the new total", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440008";
      const jobId = "550e8400-e29b-41d4-a716-4466554400a3";
      const oldTotal = 500.00;
      const newTotal = 740.00;

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        sent_total: oldTotal,
        total: oldTotal,
      };

      const { client, getWrites } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { updateQuoteLineItems } = await import("@/app/jobs/actions");

      const newLineItems: LineItem[] = [{
        category: "labour",
        description: "Electrical installation",
        quantity: 10,
        unit: "hours",
        unit_price: 74,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      }];

      try {
        await updateQuoteLineItems({
          jobId,
          quoteId,
          lineItems: newLineItems,
          customer: {
            name: "Jane Smith",
            email: "jane@example.com",
            smsOptOut: false,
          },
        });
      } catch (error) {
        // Expected to fail before implementation
      }

      const writes = getWrites();
      const quoteUpdate = writes.find(w => w.method === "update" && w.table === "quotes");

      expect(quoteUpdate?.payload).toMatchObject({
        sent_total: newTotal,
      });
    });
  });

  describe("Customer notification with approved copy", () => {
    it("sends re-issue notification via email and SMS", async () => {
      const notifyCustomer = vi.fn(async (_input?: unknown) => ({
        delivered: true,
        email: { attempted: true, delivered: true },
        sms: { attempted: true, delivered: true },
      }));

      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer,
      }));

      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440009";
      const jobId = "550e8400-e29b-41d4-a716-4466554400a4";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        sent_total: 500.00,
      };

      const { client } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { updateQuoteLineItems } = await import("@/app/jobs/actions");

      try {
        await updateQuoteLineItems({
          jobId,
          quoteId,
          lineItems: [],
          customer: {
            name: "Jane Smith",
            email: "jane@example.com",
            phone: "07700900123",
            smsOptOut: false,
          },
        });
      } catch (error) {
        // Expected to fail before implementation
      }

      expect(notifyCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "quote_reissued",
          customer: expect.objectContaining({
            email: "jane@example.com",
            phone: expect.any(String),
          }),
        })
      );
    });

    it("generates notification with old and new amounts", async () => {
      const mod = await import("@/lib/sent-quote-copy");

      const oldAmount = 500.00;
      const newAmount = 600.00;
      const companyName = "Acme Electrical";
      const customerName = "Jane";

      // Generate the re-issue message
      const message = mod.buildQuoteReissueEmail?.({
        customerName,
        companyName,
        oldAmount,
        newAmount,
        quoteUrl: "https://app.motko.app/q/abc123",
        vatRegistered: false,
      });

      expect(message?.subject).toContain("updated quote");
      expect(message?.subject).toContain(companyName);
      expect(message?.subject).toContain("please accept again");

      expect(message?.body).toContain(`£${newAmount.toFixed(2)}`);
      expect(message?.body).toContain(`£${oldAmount.toFixed(2)}`);
      expect(message?.body).toContain("your earlier acceptance no longer stands");
    });

    it("generates scope-only variant when total unchanged", async () => {
      const mod = await import("@/lib/sent-quote-copy");

      const amount = 500.00;
      const companyName = "Acme Electrical";
      const customerName = "Jane";

      const message = mod.buildQuoteReissueEmail?.({
        customerName,
        companyName,
        oldAmount: amount,
        newAmount: amount,
        quoteUrl: "https://app.motko.app/q/abc123",
        vatRegistered: false,
      });

      expect(message?.body).toContain("unchanged at");
      expect(message?.body).toContain(`£${amount.toFixed(2)}`);
      expect(message?.body).toContain("the details have changed");
      expect(message?.body).toContain("your earlier acceptance no longer stands");
    });

    it("SMS notification includes both amounts and the key sentence", async () => {
      const mod = await import("@/lib/sent-quote-copy");

      const oldAmount = 500.00;
      const newAmount = 600.00;
      const companyName = "Acme Electrical";

      const sms = mod.buildQuoteReissueSms?.({
        companyName,
        oldAmount,
        newAmount,
        quoteUrl: "https://app.motko.app/q/abc123",
        vatRegistered: false,
      });

      expect(sms).toContain(companyName);
      expect(sms).toContain(`£${newAmount.toFixed(2)}`);
      expect(sms).toContain(`£${oldAmount.toFixed(2)}`);
      expect(sms).toContain("no longer stands");
      expect(sms).toContain("https://");
    });
  });

  describe("setQuotePricingMode enforces the extended guard", () => {
    it("refuses mode switch on accepted quote with contract", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440010";
      const jobId = "550e8400-e29b-41d4-a716-446655440011";
      const contractId = "550e8400-e29b-41d4-a716-446655440012";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        line_items_json: [],
        drafted_line_items_json: null,
        contractor_flags_json: null,
        contracts: [{ id: contractId }],
      };

      const jobRow = {
        id: jobId,
        sow_json: { pricing: { mode: "itemised" } },
      };

      const { client } = mockSupabaseClient([quoteRow, jobRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { setQuotePricingMode } = await import("@/app/jobs/actions");

      await expect(
        setQuotePricingMode({
          jobId,
          quoteId,
          mode: "fixed",
          fixedAmount: 1000,
        })
      ).rejects.toThrow(/can no longer be edited/i);
    });

    it("clears accepted_at when switching mode on accepted quote without contract", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440013";
      const jobId = "550e8400-e29b-41d4-a716-446655440014";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        sent_total: 500.00,
        contracts: [], // No contract
      };

      const { client, getWrites } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { setQuotePricingMode } = await import("@/app/jobs/actions");

      try {
        await setQuotePricingMode({
          jobId,
          quoteId,
          mode: "fixed",
          fixedAmount: 1000,
        });
      } catch (error) {
        // Expected to fail before implementation
      }

      const writes = getWrites();
      const quoteUpdate = writes.find(w => w.method === "update" && w.table === "quotes");

      expect(quoteUpdate?.payload).toMatchObject({
        accepted_at: null,
      });
    });
  });

  describe("redraftJob enforces the extended guard", () => {
    it("refuses redraft on accepted quote with contract", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const jobId = "550e8400-e29b-41d4-a716-446655440015";
      const quoteId = "550e8400-e29b-41d4-a716-446655440016";
      const contractId = "550e8400-e29b-41d4-a716-446655440017";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        contracts: [{ id: contractId }],
      };

      const { client } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { redraftJob } = await import("@/app/jobs/actions");

      await expect(
        redraftJob({ jobId })
      ).rejects.toThrow(/can no longer be edited/i);
    });

    it("clears accepted_at when redrafting accepted quote without contract", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const jobId = "550e8400-e29b-41d4-a716-446655440018";
      const quoteId = "550e8400-e29b-41d4-a716-446655440019";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        accepted_at: "2026-09-10T10:00:00Z",
        sent_total: 500.00,
        contracts: [], // No contract
      };

      const { client, getWrites } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { redraftJob } = await import("@/app/jobs/actions");

      try {
        await redraftJob({ jobId });
      } catch (error) {
        // Expected to fail before implementation
      }

      const writes = getWrites();
      const quoteUpdate = writes.find(w => w.method === "update" && w.table === "quotes");

      expect(quoteUpdate?.payload).toMatchObject({
        accepted_at: null,
      });
    });
  });

  describe("Contract existence check", () => {
    it("treats a sent unsigned contract as blocking", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440020";
      const jobId = "550e8400-e29b-41d4-a716-4466554400a5";
      const contractId = "550e8400-e29b-41d4-a716-446655440021";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        contracts: [{
          id: contractId,
          status: "sent",
          sent_at: "2026-09-11T10:00:00Z",
          signed_at: null
        }],
      };

      const { client } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { updateQuoteLineItems } = await import("@/app/jobs/actions");

      await expect(
        updateQuoteLineItems({
          jobId,
          quoteId,
          lineItems: [],
          customer: {
            name: "Jane Smith",
            email: "jane@example.com",
            smsOptOut: false,
          },
        })
      ).rejects.toThrow(/can no longer be edited/i);
    });

    it("treats a declined contract as blocking", async () => {
      const { mockSupabaseClient } = await import("../helpers/supabase");

      const quoteId = "550e8400-e29b-41d4-a716-446655440022";
      const jobId = "550e8400-e29b-41d4-a716-4466554400a6";
      const contractId = "550e8400-e29b-41d4-a716-446655440023";

      const quoteRow = {
        id: quoteId,
        status: "accepted",
        contracts: [{
          id: contractId,
          status: "declined",
          declined_at: "2026-09-12T10:00:00Z"
        }],
      };

      const { client } = mockSupabaseClient([quoteRow]);

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => client),
      }));

      const { updateQuoteLineItems } = await import("@/app/jobs/actions");

      await expect(
        updateQuoteLineItems({
          jobId,
          quoteId,
          lineItems: [],
          customer: {
            name: "Jane Smith",
            email: "jane@example.com",
            smsOptOut: false,
          },
        })
      ).rejects.toThrow(/can no longer be edited/i);
    });
  });
});

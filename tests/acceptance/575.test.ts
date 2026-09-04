import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("CFIX-1: contract whose delivery fails is marked sent, cannot be re-sent, and says nothing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("delivery failure does not prevent contract creation", () => {
    it("completes and returns delivered: false when notifyCustomer throws", async () => {
      const mockSupabase = createMockSupabase({
        quote: {
          total: 5000,
          line_items_json: [
            {
              description: "Kitchen rewire",
              category: "labour",
              quantity: 1,
              unit_price: 5000,
              multiplier: 1,
              people_count: 1,
              unit: "job",
              overtime: false,
              assumed: false,
            },
          ],
          job: {
            customer: {
              name: "Test Customer",
              contact: { email: "test@example.com", phone: undefined, sms_opt_out: false },
            },
            contractor: {
              company_name: "Test Electrical",
              company_number: null,
              trade: "Electrician",
              vat_registered: false,
              vat_number: null,
              business_profile: "sole_trader",
              payout_account_holder_name: null,
              payout_sort_code: null,
              payout_account_number: null,
              stripe_account_id: null,
              stripe_payouts_enabled: false,
              payout_details_complete: false,
            },
          },
        },
        insertedContractId: "contract-123",
      });

      // Mock notifyCustomer to throw
      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer: vi.fn(async () => {
          throw new Error("Email service unavailable");
        }),
      }));

      // Mock renderContractPdf (already guarded, but needs mock)
      vi.doMock("@/lib/pdf/render-contract", () => ({
        renderContractPdf: vi.fn(async () => Buffer.from("pdf")),
      }));

      // Mock createClient to return our mock
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => mockSupabase,
      }));

      // Mock revalidatePath
      const revalidatePath = vi.fn();
      vi.doMock("next/cache", () => ({ revalidatePath }));

      const { createContract } = await import("@/app/dashboard/actions");

      const result = await createContract({
        quoteId: "00000000-0000-4000-8000-000000000001",
        depositPct: 25,
        templateKey: "standard_project",
        jobInput: {
          client_address: "123 Test St",
          client_phone: "07700900000",
          site_address: "123 Test St",
          scope_of_work: "Kitchen rewire",
          exclusions: "",
          materials_by: "Contractor",
          materials_notes: "",
          payment_schedule: "",
          start_date: "2026-09-10",
          estimated_duration: "3 days",
          completion_date: "2026-09-13",
          access_arrangements: "",
          warranty_period: "",
          building_regs_responsibility: "",
          cancellation_start: "No",
          special_terms: "",
        },
      });

      // Contract was created despite delivery failure
      expect(result.contractId).toBe("contract-123");
      expect(result.delivered).toBe(false);
      expect(result.hadContactChannel).toBe(true);

      // revalidatePath was called (not skipped due to throw)
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
      expect(revalidatePath).toHaveBeenCalledWith("/jobs/[id]", "page");
    });

    it("completes when both PDF render and delivery fail", async () => {
      const mockSupabase = createMockSupabase({
        quote: {
          total: 5000,
          line_items_json: [
            {
              description: "Kitchen rewire",
              category: "labour",
              quantity: 1,
              unit_price: 5000,
              multiplier: 1,
              people_count: 1,
              unit: "job",
              overtime: false,
              assumed: false,
            },
          ],
          job: {
            customer: {
              name: "Test Customer",
              contact: { email: "test@example.com", phone: undefined, sms_opt_out: false },
            },
            contractor: {
              company_name: "Test Electrical",
              company_number: null,
              trade: "Electrician",
              vat_registered: false,
              vat_number: null,
              business_profile: "sole_trader",
              payout_account_holder_name: null,
              payout_sort_code: null,
              payout_account_number: null,
              stripe_account_id: null,
              stripe_payouts_enabled: false,
              payout_details_complete: false,
            },
          },
        },
        insertedContractId: "contract-456",
      });

      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer: vi.fn(async () => {
          throw new Error("Email service unavailable");
        }),
      }));

      vi.doMock("@/lib/pdf/render-contract", () => ({
        renderContractPdf: vi.fn(async () => {
          throw new Error("PDF render failed");
        }),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => mockSupabase,
      }));

      const revalidatePath = vi.fn();
      vi.doMock("next/cache", () => ({ revalidatePath }));

      const { createContract } = await import("@/app/dashboard/actions");

      const result = await createContract({
        quoteId: "00000000-0000-4000-8000-000000000002",
        depositPct: 25,
        templateKey: "standard_project",
        jobInput: {
          client_address: "123 Test St",
          client_phone: "07700900000",
          site_address: "123 Test St",
          scope_of_work: "Kitchen rewire",
          exclusions: "",
          materials_by: "Contractor",
          materials_notes: "",
          payment_schedule: "",
          start_date: "2026-09-10",
          estimated_duration: "3 days",
          completion_date: "2026-09-13",
          access_arrangements: "",
          warranty_period: "",
          building_regs_responsibility: "",
          cancellation_start: "No",
          special_terms: "",
        },
      });

      // Still completes and reports the delivery failure
      expect(result.contractId).toBe("contract-456");
      expect(result.delivered).toBe(false);
      expect(revalidatePath).toHaveBeenCalled();
    });
  });

  describe("duplicate contract attempts return authored errors", () => {
    it("returns an actionable error when contract already exists for quote", async () => {
      const mockSupabase = createMockSupabase({
        quote: {
          total: 5000,
          line_items_json: [
            {
              description: "Kitchen rewire",
              category: "labour",
              quantity: 1,
              unit_price: 5000,
              multiplier: 1,
              people_count: 1,
              unit: "job",
              overtime: false,
              assumed: false,
            },
          ],
          job: {
            customer: {
              name: "Test Customer",
              contact: { email: "test@example.com", phone: undefined, sms_opt_out: false },
            },
            contractor: {
              company_name: "Test Electrical",
              company_number: null,
              trade: "Electrician",
              vat_registered: false,
              vat_number: null,
              business_profile: "sole_trader",
              payout_account_holder_name: null,
              payout_sort_code: null,
              payout_account_number: null,
              stripe_account_id: null,
              stripe_payouts_enabled: false,
              payout_details_complete: false,
            },
          },
        },
        duplicateKeyError: true,
        existingContractId: "contract-existing",
      });

      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer: vi.fn(async () => ({
          delivered: true,
          email: { attempted: true, delivered: true },
          sms: { attempted: false, delivered: false },
        })),
      }));

      vi.doMock("@/lib/pdf/render-contract", () => ({
        renderContractPdf: vi.fn(async () => Buffer.from("pdf")),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => mockSupabase,
      }));

      const revalidatePath = vi.fn();
      vi.doMock("next/cache", () => ({ revalidatePath }));

      const { createContract } = await import("@/app/dashboard/actions");
      const { actionableMessage } = await import("@/lib/actionable-error");

      let thrownError: unknown = null;
      try {
        await createContract({
          quoteId: "00000000-0000-4000-8000-00000000000d",
          depositPct: 25,
          templateKey: "standard_project",
          jobInput: {
            client_address: "123 Test St",
            client_phone: "07700900000",
            site_address: "123 Test St",
            scope_of_work: "Kitchen rewire",
            exclusions: "",
            materials_by: "Contractor",
            materials_notes: "",
            payment_schedule: "",
            start_date: "2026-09-10",
            estimated_duration: "3 days",
            completion_date: "2026-09-13",
            access_arrangements: "",
            warranty_period: "",
            building_regs_responsibility: "",
            cancellation_start: "No",
            special_terms: "",
          },
        });
        expect.fail("Expected createContract to throw on duplicate");
      } catch (err) {
        thrownError = err;
      }

      // Error is actionable (not a raw Postgres message)
      const message = actionableMessage(thrownError);
      expect(message).toBeTruthy();
      expect(message).toMatch(/contract.*already.*sent/i);

      // Error does NOT contain raw Postgres constraint name
      expect(message).not.toMatch(/contracts_quote_id_key/);
      expect(message).not.toMatch(/duplicate key value/);

      // Error includes the existing contract URL
      expect(message).toMatch(/contract-existing/);
    });
  });

  describe("all errors use actionableError", () => {
    it("uses actionableError when quote is not found", async () => {
      const mockSupabase = createMockSupabase({ quoteNotFound: true });

      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer: vi.fn(async () => ({
          delivered: true,
          email: { attempted: true, delivered: true },
          sms: { attempted: false, delivered: false },
        })),
      }));

      vi.doMock("@/lib/pdf/render-contract", () => ({
        renderContractPdf: vi.fn(async () => Buffer.from("pdf")),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => mockSupabase,
      }));

      const revalidatePath = vi.fn();
      vi.doMock("next/cache", () => ({ revalidatePath }));

      const { createContract } = await import("@/app/dashboard/actions");
      const { actionableMessage } = await import("@/lib/actionable-error");

      let thrownError: unknown = null;
      try {
        await createContract({
          quoteId: "00000000-0000-4000-8000-00000000000f",
          depositPct: 25,
          templateKey: "standard_project",
          jobInput: {
            client_address: "123 Test St",
            client_phone: "07700900000",
            site_address: "123 Test St",
            scope_of_work: "Kitchen rewire",
            exclusions: "",
            materials_by: "Contractor",
            materials_notes: "",
            payment_schedule: "",
            start_date: "2026-09-10",
            estimated_duration: "3 days",
            completion_date: "2026-09-13",
            access_arrangements: "",
            warranty_period: "",
            building_regs_responsibility: "",
            cancellation_start: "No",
            special_terms: "",
          },
        });
        expect.fail("Expected createContract to throw when quote not found");
      } catch (err) {
        thrownError = err;
      }

      // Error is actionable
      const message = actionableMessage(thrownError);
      expect(message).toBeTruthy();
      expect(message).toMatch(/quote.*not found/i);
    });

    it("uses actionableError when contract insert fails", async () => {
      const mockSupabase = createMockSupabase({
        quote: {
          total: 5000,
          line_items_json: [
            {
              description: "Kitchen rewire",
              category: "labour",
              quantity: 1,
              unit_price: 5000,
              multiplier: 1,
              people_count: 1,
              unit: "job",
              overtime: false,
              assumed: false,
            },
          ],
          job: {
            customer: {
              name: "Test Customer",
              contact: { email: "test@example.com", phone: undefined, sms_opt_out: false },
            },
            contractor: {
              company_name: "Test Electrical",
              company_number: null,
              trade: "Electrician",
              vat_registered: false,
              vat_number: null,
              business_profile: "sole_trader",
              payout_account_holder_name: null,
              payout_sort_code: null,
              payout_account_number: null,
              stripe_account_id: null,
              stripe_payouts_enabled: false,
              payout_details_complete: false,
            },
          },
        },
        insertFails: true,
      });

      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer: vi.fn(async () => ({
          delivered: true,
          email: { attempted: true, delivered: true },
          sms: { attempted: false, delivered: false },
        })),
      }));

      vi.doMock("@/lib/pdf/render-contract", () => ({
        renderContractPdf: vi.fn(async () => Buffer.from("pdf")),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => mockSupabase,
      }));

      const revalidatePath = vi.fn();
      vi.doMock("next/cache", () => ({ revalidatePath }));

      const { createContract } = await import("@/app/dashboard/actions");
      const { actionableMessage } = await import("@/lib/actionable-error");

      let thrownError: unknown = null;
      try {
        await createContract({
          quoteId: "00000000-0000-4000-8000-000000000003",
          depositPct: 25,
          templateKey: "standard_project",
          jobInput: {
            client_address: "123 Test St",
            client_phone: "07700900000",
            site_address: "123 Test St",
            scope_of_work: "Kitchen rewire",
            exclusions: "",
            materials_by: "Contractor",
            materials_notes: "",
            payment_schedule: "",
            start_date: "2026-09-10",
            estimated_duration: "3 days",
            completion_date: "2026-09-13",
            access_arrangements: "",
            warranty_period: "",
            building_regs_responsibility: "",
            cancellation_start: "No",
            special_terms: "",
          },
        });
        expect.fail("Expected createContract to throw when insert fails");
      } catch (err) {
        thrownError = err;
      }

      // Error is actionable
      const message = actionableMessage(thrownError);
      expect(message).toBeTruthy();
      expect(message).toMatch(/couldn't create|failed to create/i);
    });
  });

  describe("successful sends are unchanged", () => {
    it("returns delivered: true and navigates normally when delivery succeeds", async () => {
      const mockSupabase = createMockSupabase({
        quote: {
          total: 5000,
          line_items_json: [
            {
              description: "Kitchen rewire",
              category: "labour",
              quantity: 1,
              unit_price: 5000,
              multiplier: 1,
              people_count: 1,
              unit: "job",
              overtime: false,
              assumed: false,
            },
          ],
          job: {
            customer: {
              name: "Test Customer",
              contact: { email: "test@example.com", phone: "07700900000", sms_opt_out: false },
            },
            contractor: {
              company_name: "Test Electrical",
              company_number: null,
              trade: "Electrician",
              vat_registered: false,
              vat_number: null,
              business_profile: "sole_trader",
              payout_account_holder_name: null,
              payout_sort_code: null,
              payout_account_number: null,
              stripe_account_id: null,
              stripe_payouts_enabled: false,
              payout_details_complete: false,
            },
          },
        },
        insertedContractId: "contract-success",
      });

      vi.doMock("@/lib/notify-customer", () => ({
        notifyCustomer: vi.fn(async () => ({
          delivered: true,
          email: { attempted: true, delivered: true },
          sms: { attempted: false, delivered: false },
        })),
      }));

      vi.doMock("@/lib/pdf/render-contract", () => ({
        renderContractPdf: vi.fn(async () => Buffer.from("pdf")),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => mockSupabase,
      }));

      const revalidatePath = vi.fn();
      vi.doMock("next/cache", () => ({ revalidatePath }));

      const { createContract } = await import("@/app/dashboard/actions");

      const result = await createContract({
        quoteId: "00000000-0000-4000-8000-00000000000a",
        depositPct: 25,
        templateKey: "standard_project",
        jobInput: {
          client_address: "123 Test St",
          client_phone: "07700900000",
          site_address: "123 Test St",
          scope_of_work: "Kitchen rewire",
          exclusions: "",
          materials_by: "Contractor",
          materials_notes: "",
          payment_schedule: "",
          start_date: "2026-09-10",
          estimated_duration: "3 days",
          completion_date: "2026-09-13",
          access_arrangements: "",
          warranty_period: "",
          building_regs_responsibility: "",
          cancellation_start: "No",
          special_terms: "",
        },
      });

      expect(result.contractId).toBe("contract-success");
      expect(result.delivered).toBe(true);
      expect(result.hadContactChannel).toBe(true);
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
      expect(revalidatePath).toHaveBeenCalledWith("/jobs/[id]", "page");
    });
  });
});

// Test helper to create a mock Supabase client
function createMockSupabase(config: {
  quote?: {
    total: number;
    line_items_json: Array<{
      description: string;
      category: string;
      quantity: number;
      unit_price: number;
      multiplier: number;
      people_count: number;
      unit: string;
      overtime: boolean;
      assumed: boolean;
    }>;
    job: {
      customer: {
        name: string;
        contact: { email?: string; phone?: string; sms_opt_out?: boolean };
      } | null;
      contractor: {
        company_name: string;
        company_number: string | null;
        trade: string | null;
        vat_registered: boolean;
        vat_number: string | null;
        business_profile: string;
        payout_account_holder_name: string | null;
        payout_sort_code: string | null;
        payout_account_number: string | null;
        stripe_account_id: string | null;
        stripe_payouts_enabled: boolean;
        payout_details_complete: boolean;
      };
    };
  };
  quoteNotFound?: boolean;
  insertedContractId?: string;
  insertFails?: boolean;
  duplicateKeyError?: boolean;
  existingContractId?: string;
}): SupabaseClient {
  const from = vi.fn((table: string) => {
    if (table === "quotes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => {
              if (config.quoteNotFound) {
                return { data: null, error: null };
              }
              return { data: config.quote, error: null };
            }),
          })),
        })),
      };
    }

    if (table === "contracts") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => {
              if (config.duplicateKeyError) {
                return {
                  data: null,
                  error: {
                    code: "23505",
                    message: 'duplicate key value violates unique constraint "contracts_quote_id_key"',
                  },
                };
              }
              if (config.insertFails) {
                return {
                  data: null,
                  error: { message: "Database error" },
                };
              }
              return {
                data: { id: config.insertedContractId ?? "contract-default" },
                error: null,
              };
            }),
          })),
        })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => {
              if (config.duplicateKeyError && config.existingContractId) {
                return {
                  data: { id: config.existingContractId },
                  error: null,
                };
              }
              return { data: null, error: null };
            }),
          })),
        })),
      };
    }

    return {};
  });

  return { from } as unknown as SupabaseClient;
}

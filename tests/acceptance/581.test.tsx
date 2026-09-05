import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("CFIX-2: already-sent contract navigates rather than erroring on form", () => {
  describe("server action: createContract with duplicate", () => {
    it("returns the existing contract ID when a duplicate is found and can be read", async () => {
      const { createContract } = await import("@/app/dashboard/actions");
      const { createClient } = await import("@/lib/supabase/server");

      // Mock createClient to return a stub with controlled responses
      const mockSelect = vi.fn();
      const mockInsert = vi.fn();
      const mockFrom = vi.fn((table: string) => {
        if (table === "quotes") {
          return {
            select: mockSelect.mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    total: 10000,
                    line_items_json: [{ category: "labour", quantity: 1, unit_price: 10000, multiplier: 1, description: "Work", unit: "job", overtime: false, assumed: false, people_count: 1 }],
                    job: {
                      customer: { name: "Test Customer", contact: { email: "test@example.com" } },
                      contractor: {
                        company_name: "Test Contractor",
                        company_number: null,
                        trade: null,
                        vat_registered: false,
                        vat_number: null,
                        business_profile: {},
                        payout_account_holder_name: null,
                        payout_sort_code: null,
                        payout_account_number: null,
                        payout_details_complete: false,
                        stripe_account_id: null,
                        stripe_payouts_enabled: false,
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "contracts") {
          return {
            insert: mockInsert.mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "23505", message: "duplicate key" },
                }),
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "existing-contract-id" },
                  error: null,
                }),
              }),
            }),
          };
        }
        return { select: vi.fn(), insert: vi.fn() };
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await createContract({
        quoteId: "550e8400-e29b-41d4-a716-446655440000",
        templateKey: "standard_project",
        jobInput: {
          client_address: "123 Test St",
          client_phone: "07700900000",
          site_address: "123 Test St",
          scope_of_work: "Test work",
          exclusions: "",
          materials_by: "Contractor",
          materials_notes: "",
          payment_schedule: "",
          start_date: "",
          estimated_duration: "",
          completion_date: "",
          access_arrangements: "",
          warranty_period: "",
          building_regs_responsibility: "",
          cancellation_start: "No",
          special_terms: "",
        },
      });

      expect(result.contractId).toBe("existing-contract-id");
      expect(result.alreadySent).toBe(true);
      expect(result.contractUrl).toContain("/c/existing-contract-id");
    });

    it("throws an error when duplicate exists but cannot be read back", async () => {
      const { createContract } = await import("@/app/dashboard/actions");
      const { createClient } = await import("@/lib/supabase/server");

      const mockFrom = vi.fn((table: string) => {
        if (table === "quotes") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    total: 10000,
                    line_items_json: [{ category: "labour", quantity: 1, unit_price: 10000, multiplier: 1, description: "Work", unit: "job", overtime: false, assumed: false, people_count: 1 }],
                    job: {
                      customer: { name: "Test", contact: {} },
                      contractor: {
                        company_name: "Test",
                        company_number: null,
                        trade: null,
                        vat_registered: false,
                        vat_number: null,
                        business_profile: {},
                        payout_account_holder_name: null,
                        payout_sort_code: null,
                        payout_account_number: null,
                        payout_details_complete: false,
                        stripe_account_id: null,
                        stripe_payouts_enabled: false,
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "contracts") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "23505" },
                }),
              }),
            }),
            // Read-back fails
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          };
        }
        return { select: vi.fn(), insert: vi.fn() };
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      await expect(
        createContract({
          quoteId: "550e8400-e29b-41d4-a716-446655440001",
          templateKey: "standard_project",
          jobInput: {
            client_address: "123 Test St",
            client_phone: "07700900000",
            site_address: "123 Test St",
            scope_of_work: "Test work",
            exclusions: "",
            materials_by: "Contractor",
            materials_notes: "",
            payment_schedule: "",
            start_date: "",
            estimated_duration: "",
            completion_date: "",
            access_arrangements: "",
            warranty_period: "",
            building_regs_responsibility: "",
            cancellation_start: "No",
            special_terms: "",
          },
        })
      ).rejects.toThrow("already been sent");
    });

    it("returns alreadySent: false (or undefined) for a successful new insert", async () => {
      const { createContract } = await import("@/app/dashboard/actions");
      const { createClient } = await import("@/lib/supabase/server");

      const mockFrom = vi.fn((table: string) => {
        if (table === "quotes") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    total: 10000,
                    line_items_json: [{ category: "labour", quantity: 1, unit_price: 10000, multiplier: 1, description: "Work", unit: "job", overtime: false, assumed: false, people_count: 1 }],
                    job: {
                      customer: { name: "Test", contact: { email: "test@example.com" } },
                      contractor: {
                        company_name: "Test",
                        company_number: null,
                        trade: null,
                        vat_registered: false,
                        vat_number: null,
                        business_profile: {},
                        payout_account_holder_name: null,
                        payout_sort_code: null,
                        payout_account_number: null,
                        payout_details_complete: false,
                        stripe_account_id: null,
                        stripe_payouts_enabled: false,
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "contracts") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "new-contract-id" },
                  error: null,
                }),
              }),
            }),
          };
        }
        return { select: vi.fn(), insert: vi.fn() };
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await createContract({
        quoteId: "550e8400-e29b-41d4-a716-446655440000",
        templateKey: "standard_project",
        jobInput: {
          client_address: "123 Test St",
          client_phone: "07700900000",
          site_address: "123 Test St",
          scope_of_work: "Test work",
          exclusions: "",
          materials_by: "Contractor",
          materials_notes: "",
          payment_schedule: "",
          start_date: "",
          estimated_duration: "",
          completion_date: "",
          access_arrangements: "",
          warranty_period: "",
          building_regs_responsibility: "",
          cancellation_start: "No",
          special_terms: "",
        },
      });

      expect(result.contractId).toBe("new-contract-id");
      expect(result.alreadySent).toBeUndefined();
    });
  });

  describe("banner builder: already-sent variant", () => {
    it("buildSentBanner produces an 'already sent' banner distinguishable from 'just sent'", async () => {
      const { buildSentBanner } = await import("@/app/jobs/[id]/sent-banner");

      const alreadySentBanner = buildSentBanner({
        sent: "contract",
        delivered: undefined,
        payout: undefined,
        already: "1",
        firstName: "Sam",
        channelSuffix: "",
        quoteUrl: null,
        contractUrl: "https://motko.app/c/CONTRACT",
        paymentUrl: null,
      });

      const justSentBanner = buildSentBanner({
        sent: "contract",
        delivered: undefined,
        payout: undefined,
        already: undefined,
        firstName: "Sam",
        channelSuffix: "",
        quoteUrl: null,
        contractUrl: "https://motko.app/c/CONTRACT",
        paymentUrl: null,
      });

      expect(alreadySentBanner).not.toBeNull();
      expect(justSentBanner).not.toBeNull();

      // They must be different
      expect(alreadySentBanner?.title).not.toBe(justSentBanner?.title);

      // "Already sent" banner should indicate it was already sent
      expect(alreadySentBanner?.title.toLowerCase()).toContain("already");

      // Both should include the contract link
      expect(alreadySentBanner?.link).toBe("https://motko.app/c/CONTRACT");
      expect(justSentBanner?.link).toBe("https://motko.app/c/CONTRACT");
    });

    it("already-sent banner does not imply the contractor just sent it", async () => {
      const { buildSentBanner } = await import("@/app/jobs/[id]/sent-banner");

      const banner = buildSentBanner({
        sent: "contract",
        delivered: undefined,
        payout: undefined,
        already: "1",
        firstName: "Sam",
        channelSuffix: "",
        quoteUrl: null,
        contractUrl: "https://motko.app/c/CONTRACT",
        paymentUrl: null,
      });

      expect(banner).not.toBeNull();
      // Should not say "sent to Sam" which implies it just happened
      expect(banner?.title).not.toContain("sent to Sam");
      // Should indicate it was already sent
      expect(banner?.title.toLowerCase()).toContain("already");
    });
  });

  describe("integration: no second contract created", () => {
    it("attempting to send a duplicate contract does not create a second row", async () => {
      // This test verifies the server action returns the existing contract
      // without attempting a second insert after the first one fails
      const { createContract } = await import("@/app/dashboard/actions");
      const { createClient } = await import("@/lib/supabase/server");

      let insertAttempts = 0;
      const mockFrom = vi.fn((table: string) => {
        if (table === "quotes") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    total: 10000,
                    line_items_json: [{ category: "labour", quantity: 1, unit_price: 10000, multiplier: 1, description: "Work", unit: "job", overtime: false, assumed: false, people_count: 1 }],
                    job: {
                      customer: { name: "Test", contact: {} },
                      contractor: {
                        company_name: "Test",
                        company_number: null,
                        trade: null,
                        vat_registered: false,
                        vat_number: null,
                        business_profile: {},
                        payout_account_holder_name: null,
                        payout_sort_code: null,
                        payout_account_number: null,
                        payout_details_complete: false,
                        stripe_account_id: null,
                        stripe_payouts_enabled: false,
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "contracts") {
          return {
            insert: vi.fn(() => {
              insertAttempts++;
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { code: "23505" },
                  }),
                }),
              };
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "existing-id" },
                  error: null,
                }),
              }),
            }),
          };
        }
        return { select: vi.fn(), insert: vi.fn() };
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      await createContract({
        quoteId: "550e8400-e29b-41d4-a716-446655440000",
        templateKey: "standard_project",
        jobInput: {
          client_address: "123 Test St",
          client_phone: "07700900000",
          site_address: "123 Test St",
          scope_of_work: "Test work",
          exclusions: "",
          materials_by: "Contractor",
          materials_notes: "",
          payment_schedule: "",
          start_date: "",
          estimated_duration: "",
          completion_date: "",
          access_arrangements: "",
          warranty_period: "",
          building_regs_responsibility: "",
          cancellation_start: "No",
          special_terms: "",
        },
      });

      // Only one insert attempt should have been made
      expect(insertAttempts).toBe(1);
    });
  });

  describe("job page: reads already param and passes to banner", () => {
    it("page.tsx passes the already query param to buildSentBanner", async () => {
      // This verifies the page reads searchParams.already and passes it through
      const mod = await import("@/app/jobs/[id]/page");
      expect(mod.default).toBeDefined();

      // The page is a server component that reads searchParams.already
      // and passes it to buildSentBanner. We can't render it here, but we
      // can verify the module exists and buildSentBanner accepts the param.
      const { buildSentBanner } = await import("@/app/jobs/[id]/sent-banner");

      // Verify buildSentBanner signature accepts already
      const result = buildSentBanner({
        sent: "contract",
        delivered: undefined,
        payout: undefined,
        already: "1",
        firstName: "Test",
        channelSuffix: "",
        quoteUrl: null,
        contractUrl: "https://motko.app/c/TEST",
        paymentUrl: null,
      });

      expect(result).not.toBeNull();
    });
  });

  describe("edge case: existing contract already signed", () => {
    it("already-sent navigation works even if the contract is signed", async () => {
      // The banner must not imply it's awaiting signature
      const { buildSentBanner } = await import("@/app/jobs/[id]/sent-banner");

      const banner = buildSentBanner({
        sent: "contract",
        delivered: undefined,
        payout: undefined,
        already: "1",
        firstName: "Sam",
        channelSuffix: "",
        quoteUrl: null,
        contractUrl: "https://motko.app/c/CONTRACT",
        paymentUrl: null,
      });

      expect(banner).not.toBeNull();
      // Should not mention signature or waiting
      expect(banner?.body.toLowerCase()).not.toContain("sign");
      expect(banner?.body.toLowerCase()).not.toContain("waiting");
    });
  });

  describe("first successful send unchanged", () => {
    it("a normal first send does not include alreadySent flag", async () => {
      const { createContract } = await import("@/app/dashboard/actions");
      const { createClient } = await import("@/lib/supabase/server");

      const mockFrom = vi.fn((table: string) => {
        if (table === "quotes") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    total: 10000,
                    line_items_json: [{ category: "labour", quantity: 1, unit_price: 10000, multiplier: 1, description: "Work", unit: "job", overtime: false, assumed: false, people_count: 1 }],
                    job: {
                      customer: { name: "Test", contact: { email: "test@example.com" } },
                      contractor: {
                        company_name: "Test",
                        company_number: null,
                        trade: null,
                        vat_registered: false,
                        vat_number: null,
                        business_profile: {},
                        payout_account_holder_name: null,
                        payout_sort_code: null,
                        payout_account_number: null,
                        payout_details_complete: false,
                        stripe_account_id: null,
                        stripe_payouts_enabled: false,
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "contracts") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "new-contract-id" },
                  error: null,
                }),
              }),
            }),
          };
        }
        return { select: vi.fn(), insert: vi.fn() };
      });

      vi.mocked(createClient).mockResolvedValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await createContract({
        quoteId: "550e8400-e29b-41d4-a716-446655440000",
        templateKey: "standard_project",
        jobInput: {
          client_address: "123 Test St",
          client_phone: "07700900000",
          site_address: "123 Test St",
          scope_of_work: "Test work",
          exclusions: "",
          materials_by: "Contractor",
          materials_notes: "",
          payment_schedule: "",
          start_date: "",
          estimated_duration: "",
          completion_date: "",
          access_arrangements: "",
          warranty_period: "",
          building_regs_responsibility: "",
          cancellation_start: "No",
          special_terms: "",
        },
      });

      expect(result.alreadySent).toBeUndefined();
      expect(result.delivered).toBeDefined(); // Normal flow includes delivered flag
    });
  });
});

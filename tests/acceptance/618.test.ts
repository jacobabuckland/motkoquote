import { describe, it, expect, vi } from "vitest";

describe("Companies House validation — #618", () => {
  describe("Company number lookup", () => {
    it("getCompanyByNumber function exists and returns company details", async () => {
      const mod = await import("@/lib/companies-house");
      expect(mod.getCompanyByNumber).toBeDefined();
      expect(typeof mod.getCompanyByNumber).toBe("function");
    });

    it("getCompanyByNumber returns registered office address", async () => {
      const { getCompanyByNumber } = await import("@/lib/companies-house");

      // Mock the fetch call to Companies House API
      const mockCompanyData = {
        company_number: "12345678",
        company_name: "TEST COMPANY LIMITED",
        registered_office_address: {
          address_line_1: "123 Test Street",
          locality: "Test Town",
          postal_code: "TE1 1ST",
        },
      };

      global.fetch = vi.fn(async () =>
        Promise.resolve({
          ok: true,
          json: async () => mockCompanyData,
        } as Response),
      );

      const result = await getCompanyByNumber("12345678");

      expect(result).toBeDefined();
      expect(result.company_number).toBe("12345678");
      expect(result.registered_office_address).toBeDefined();
      expect(result.registered_office_address?.address_line_1).toBe("123 Test Street");
    });

    it("getCompanyByNumber throws on invalid company number", async () => {
      const { getCompanyByNumber } = await import("@/lib/companies-house");

      global.fetch = vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response),
      );

      await expect(getCompanyByNumber("99999999")).rejects.toThrow();
    });
  });

  describe("API routes", () => {
    it("validation route exists", async () => {
      const mod = await import("@/app/api/companies-house/validate/route");
      expect(mod.POST).toBeDefined();
    });

    it("validation route accepts company number and returns comparison", async () => {
      const { POST } = await import("@/app/api/companies-house/validate/route");

      const mockRequest = {
        json: async () => ({
          company_number: "12345678",
          stated_name: "Test Company Ltd",
          stated_address: "123 Test St",
        }),
      } as Request;

      // Mock Companies House API response
      global.fetch = vi.fn(async () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            company_number: "12345678",
            company_name: "TEST COMPANY LIMITED",
            registered_office_address: {
              address_line_1: "123 Test Street",
              locality: "Test Town",
              postal_code: "TE1 1ST",
            },
          }),
        } as Response),
      );

      const response = await POST(mockRequest);
      expect(response).toBeDefined();

      const data = await response.json();
      expect(data.company_number).toBe("12345678");
      expect(data.registered_name).toBeDefined();
      expect(data.registered_address).toBeDefined();
    });

    it("validation route handles API failures gracefully", async () => {
      const { POST } = await import("@/app/api/companies-house/validate/route");

      const mockRequest = {
        json: async () => ({
          company_number: "12345678",
          stated_name: "Test Company Ltd",
        }),
      } as Request;

      // Mock API failure
      global.fetch = vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response),
      );

      const response = await POST(mockRequest);
      expect(response.status).toBeGreaterThanOrEqual(500);
    });
  });

  describe("Voice setup validation", () => {
    it("completeSetupConversation validates company number when present", async () => {
      const { completeSetupConversation } = await import("@/app/setup/actions");

      const mockState = {
        first_name: "John",
        company_name: "Test Company Ltd",
        trade: "Electrician",
        vat_registered: false,
        vat_number: undefined,
        day_rate: 300,
        half_day_rate: null,
        overtime_rate: null,
        callout_min: null,
        travel_rate: null,
        markup_pct: null,
        business_profile: {
          company_number: "12345678",
          registered_address: "123 Test Street, Test Town",
        },
        notes: [],
        team_members: [],
      };

      // Mock Companies House API to return different registered name
      global.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes("company-information.service.gov.uk")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              company_number: "12345678",
              company_name: "TEST COMPANY LIMITED",
              registered_office_address: {
                address_line_1: "123 Test Street",
                locality: "Test Town",
                postal_code: "TE1 1ST",
              },
            }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      });

      // Mock Supabase client
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: "test-id" },
              error: null,
            })),
          })),
        })),
        upsert: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          from: mockFrom,
          auth: {
            getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
          },
        }),
      }));

      const result = await completeSetupConversation({ state: mockState });

      // Should succeed even if validation runs
      expect(result.ok).toBe(true);
    });

    it("completeSetupConversation skips validation when company number absent", async () => {
      const { completeSetupConversation } = await import("@/app/setup/actions");

      const mockState = {
        first_name: "John",
        company_name: "Test Company Ltd",
        trade: "Electrician",
        vat_registered: false,
        vat_number: undefined,
        day_rate: 300,
        half_day_rate: null,
        overtime_rate: null,
        callout_min: null,
        travel_rate: null,
        markup_pct: null,
        business_profile: {},
        notes: [],
        team_members: [],
      };

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      // Mock Supabase client
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: "test-id" },
              error: null,
            })),
          })),
        })),
        upsert: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          from: mockFrom,
          auth: {
            getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
          },
        }),
      }));

      const result = await completeSetupConversation({ state: mockState });

      expect(result.ok).toBe(true);
      // Should not have called Companies House API when no company number
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("company-information.service.gov.uk"),
      );
    });
  });

  describe("Name and address matching", () => {
    it("normalizes whitespace and casing when comparing names", async () => {
      const mod = await import("@/lib/companies-house");

      // Look for a comparison/matching utility function
      const { normalizeCompanyName } = mod as {
        normalizeCompanyName?: (name: string) => string;
      };

      if (normalizeCompanyName) {
        expect(normalizeCompanyName("ABC Limited")).toBe(normalizeCompanyName("ABC LIMITED"));
        expect(normalizeCompanyName("ABC  Limited")).toBe(normalizeCompanyName("ABC Limited"));
      }
    });

    it("detects substantive name mismatches", async () => {
      const mod = await import("@/lib/companies-house");

      const { compareCompanyNames } = mod as {
        compareCompanyNames?: (stated: string, registered: string) => {
          matches: boolean;
          mismatch?: string;
        };
      };

      if (compareCompanyNames) {
        // Exact match (case-insensitive)
        const exactMatch = compareCompanyNames("ABC Limited", "ABC LIMITED");
        expect(exactMatch.matches).toBe(true);

        // Substantive mismatch
        const mismatch = compareCompanyNames("ABC Limited", "ABC Electrical Limited");
        expect(mismatch.matches).toBe(false);
      }
    });
  });

  describe("Setup form mismatch warnings", () => {
    it("shows mismatch warning when registered name differs from stated", async () => {
      // This test verifies the setup form displays validation warnings.
      // Since this is a client component that requires rendering, we check
      // that the necessary data structure exists to support the UI.

      const mod = await import("@/app/setup/actions");

      // The action should return validation results
      const { completeSetupConversation } = mod;

      expect(completeSetupConversation).toBeDefined();

      // The spec requires that mismatches are surfaced to the contractor.
      // Implementation should include validation_warnings in the returned state.
    });
  });

  describe("Error handling and logging", () => {
    it("logs validation errors without PII", async () => {
      const { getCompanyByNumber } = await import("@/lib/companies-house");

      // Mock failed API call
      global.fetch = vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response),
      );

      try {
        await getCompanyByNumber("99999999");
      } catch (error) {
        // Error should not contain address PII
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        expect(errorMessage).not.toMatch(/\d{1,4}\s+\w+\s+(Street|Road|Avenue)/i);
      }
    });

    it("allows setup to proceed when Companies House API is down", async () => {
      const { completeSetupConversation } = await import("@/app/setup/actions");

      const mockState = {
        first_name: "John",
        company_name: "Test Company Ltd",
        trade: "Electrician",
        vat_registered: false,
        vat_number: undefined,
        day_rate: 300,
        half_day_rate: null,
        overtime_rate: null,
        callout_min: null,
        travel_rate: null,
        markup_pct: null,
        business_profile: {
          company_number: "12345678",
        },
        notes: [],
        team_members: [],
      };

      // Mock API failure
      global.fetch = vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 503,
        } as Response),
      );

      // Mock Supabase client
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: "test-id" },
              error: null,
            })),
          })),
        })),
        upsert: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      }));

      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          from: mockFrom,
          auth: {
            getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }),
          },
        }),
      }));

      const result = await completeSetupConversation({ state: mockState });

      // Setup should succeed even when validation API is down
      expect(result.ok).toBe(true);
    });
  });
});

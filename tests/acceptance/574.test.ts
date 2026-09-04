import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock next/navigation to prevent redirect errors
const mockRedirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT: ${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  revalidatePath: vi.fn(),
}));

// Store for simulating database state across operations
type ContractorRow = {
  id: string;
  owner_user_id: string;
  company_name: string;
  business_profile: Record<string, unknown> | null;
  [key: string]: unknown;
};

let mockContractorStore: ContractorRow | null = null;

// Mock Supabase client creation
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => createMockSupabaseClient()),
}));

// Mock admin client (used for referral provisioning)
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => createMockSupabaseClient()),
}));

// Mock referral provisioning (best-effort, doesn't affect the test)
vi.mock("@/lib/referral-signup", () => ({
  provisionNewContractor: vi.fn(async () => ({})),
}));

function createMockSupabaseClient(): SupabaseClient {
  const client = {
    from: vi.fn((table: string) => {
      if (table === "contractors") {
        return {
          // SELECT query to fetch existing contractor
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          select: vi.fn((columns?: string) => ({
            eq: vi.fn((column: string, value: string) => ({
              maybeSingle: vi.fn(async () => {
                if (column === "owner_user_id" && mockContractorStore?.owner_user_id === value) {
                  return { data: mockContractorStore, error: null };
                }
                return { data: null, error: null };
              }),
            })),
          })),
          // UPSERT operation
          upsert: vi.fn((row: ContractorRow) => {
            // Simulate upsert: update if exists, insert if not
            const contractorId = mockContractorStore?.id ?? "new-contractor-id";
            mockContractorStore = { ...row, id: contractorId } as ContractorRow;

            // Return a chainable mock for .select().single()
            const singleFn = vi.fn(async () => ({ data: { id: contractorId }, error: null }));
            const selectFn = vi.fn(() => ({ single: singleFn }));

            return { select: selectFn };
          }),
        };
      }
      // Mock other tables (team_members, merchant_accounts, rate_cards)
      return {
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({})),
        })),
        insert: vi.fn(async () => ({ error: null })),
      };
    }),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "test-user-id" } },
        error: null,
      })),
      updateUser: vi.fn(async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;

  return client;
}

describe("SETUP-1: business_profile merge on save", () => {
  beforeEach(() => {
    mockContractorStore = null;
    mockRedirect.mockClear();
  });

  it("preserves existing business_structure when voice path omits it", async () => {
    // Simulate form-collected profile with business_structure
    mockContractorStore = {
      id: "contractor-1",
      owner_user_id: "test-user-id",
      company_name: "Acme Electric",
      business_profile: {
        business_structure: "Sole trader",
        business_email: "info@acme.com",
      },
    };

    const { completeSetupConversation } = await import("@/app/setup/actions");

    // Voice path provides certifications but not business_structure
    const result = await completeSetupConversation({
      state: {
        company_name: "Acme Electric",
        trade: "Electrician",
        business_profile: {
          certifications: "Gas Safe 123456",
        },
      },
    });

    expect(result.ok).toBe(true);
    // business_structure should be preserved, certifications added
    expect(mockContractorStore?.business_profile).toMatchObject({
      business_structure: "Sole trader",
      business_email: "info@acme.com",
      certifications: "Gas Safe 123456",
    });
  });

  it("preserves form-collected fields when voice path runs second", async () => {
    // Form collected several fields
    mockContractorStore = {
      id: "contractor-2",
      owner_user_id: "test-user-id",
      company_name: "Quality Plumbing",
      business_profile: {
        business_structure: "Limited company",
        registered_address: "123 High St, London",
        business_email: "hello@quality.com",
      },
    };

    const { completeSetupConversation } = await import("@/app/setup/actions");

    // Voice collects additional fields but doesn't have the form-only ones
    const result = await completeSetupConversation({
      state: {
        company_name: "Quality Plumbing",
        trade: "Plumber",
        business_profile: {
          certifications: "City & Guilds Level 3",
          insurer_name: "Acme Insurance",
        },
      },
    });

    expect(result.ok).toBe(true);
    // All fields should be present
    expect(mockContractorStore?.business_profile).toMatchObject({
      business_structure: "Limited company",
      registered_address: "123 High St, London",
      business_email: "hello@quality.com",
      certifications: "City & Guilds Level 3",
      insurer_name: "Acme Insurance",
    });
  });

  it("allows explicitly clearing a field with empty string", async () => {
    // Existing profile has certifications
    mockContractorStore = {
      id: "contractor-3",
      owner_user_id: "test-user-id",
      company_name: "Test Co",
      business_profile: {
        business_structure: "Sole trader",
        certifications: "Old cert",
      },
    };

    const { completeSetupConversation } = await import("@/app/setup/actions");

    // User explicitly clears certifications by setting empty string
    const result = await completeSetupConversation({
      state: {
        company_name: "Test Co",
        trade: "Builder",
        business_profile: {
          certifications: "",
        },
      },
    });

    expect(result.ok).toBe(true);
    // business_structure should be preserved, certifications cleared
    expect(mockContractorStore?.business_profile).toMatchObject({
      business_structure: "Sole trader",
    });
    // Verify certifications was explicitly cleared (empty string or undefined)
    const profile = mockContractorStore?.business_profile as Record<string, unknown>;
    expect(profile?.certifications === "" || profile?.certifications === undefined).toBe(true);
  });

  it("handles null existing business_profile gracefully", async () => {
    // Existing contractor but no business_profile set
    mockContractorStore = {
      id: "contractor-4",
      owner_user_id: "test-user-id",
      company_name: "New Business",
      business_profile: null,
    };

    const { completeSetupConversation } = await import("@/app/setup/actions");

    const result = await completeSetupConversation({
      state: {
        company_name: "New Business",
        trade: "Carpenter",
        business_profile: {
          business_structure: "Sole trader",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(mockContractorStore?.business_profile).toMatchObject({
      business_structure: "Sole trader",
    });
  });

  it("handles empty object existing business_profile gracefully", async () => {
    // Existing contractor with empty business_profile
    mockContractorStore = {
      id: "contractor-5",
      owner_user_id: "test-user-id",
      company_name: "Empty Profile Co",
      business_profile: {},
    };

    const { completeSetupConversation } = await import("@/app/setup/actions");

    const result = await completeSetupConversation({
      state: {
        company_name: "Empty Profile Co",
        trade: "Plasterer",
        business_profile: {
          business_structure: "Limited company",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(mockContractorStore?.business_profile).toMatchObject({
      business_structure: "Limited company",
    });
  });

  it("first-time setup with no existing row behaves as before", async () => {
    // No existing contractor
    mockContractorStore = null;

    const { completeSetupConversation } = await import("@/app/setup/actions");

    const result = await completeSetupConversation({
      state: {
        company_name: "Brand New Co",
        trade: "Roofer",
        business_profile: {
          business_structure: "Sole trader",
          business_email: "new@example.com",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(mockContractorStore).not.toBeNull();
    // Read through a typed local: the only assignment to mockContractorStore is
    // inside a vi.fn callback, so control-flow analysis still sees the `null`
    // initialiser here and narrows `?.` to never.
    const stored = mockContractorStore as ContractorRow | null;
    expect(stored?.business_profile).toMatchObject({
      business_structure: "Sole trader",
      business_email: "new@example.com",
    });
  });

  it("replaces nested objects entirely (shallow merge)", async () => {
    // Existing profile with registered_address_components
    mockContractorStore = {
      id: "contractor-6",
      owner_user_id: "test-user-id",
      company_name: "Address Test Co",
      business_profile: {
        registered_address: "123 Old St, London",
        registered_address_components: {
          formatted: "123 Old St, London, SW1A 1AA",
          line1: "123 Old St",
          town: "London",
          postcode: "SW1A 1AA",
        },
      },
    };

    const { completeSetupConversation } = await import("@/app/setup/actions");

    // Update address with new components
    const result = await completeSetupConversation({
      state: {
        company_name: "Address Test Co",
        trade: "Electrician",
        business_profile: {
          registered_address: "456 New Rd, Manchester",
          registered_address_components: {
            formatted: "456 New Rd, Manchester, M1 1AA",
            line1: "456 New Rd",
            town: "Manchester",
            postcode: "M1 1AA",
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    // Entire components object should be replaced, not merged
    expect(mockContractorStore?.business_profile).toMatchObject({
      registered_address: "456 New Rd, Manchester",
      registered_address_components: {
        formatted: "456 New Rd, Manchester, M1 1AA",
        line1: "456 New Rd",
        town: "Manchester",
        postcode: "M1 1AA",
      },
    });
    // Old town should not be present (was London, should be Manchester)
    const components = (mockContractorStore?.business_profile as Record<string, unknown>)
      ?.registered_address_components as Record<string, unknown>;
    expect(components?.town).toBe("Manchester");
    expect(components?.town).not.toBe("London");
  });

  it("running form after voice preserves voice-collected fields", async () => {
    // Voice collected certifications
    mockContractorStore = {
      id: "contractor-7",
      owner_user_id: "test-user-id",
      company_name: "Both Paths Co",
      business_profile: {
        certifications: "Gas Safe 987654",
        insurer_name: "Umbrella Insurance",
      },
    };

    const { autosaveContractorSetup } = await import("@/app/setup/actions");

    // Form adds business_structure
    await autosaveContractorSetup({
      company_name: "Both Paths Co",
      trade: "Gas Engineer",
      vat_registered: false,
      business_profile: {
        business_structure: "Limited company",
      },
      team_members: [],
      merchant_accounts: [],
      rate_cards: [],
    });

    // Voice-collected fields should still be present
    expect(mockContractorStore?.business_profile).toMatchObject({
      business_structure: "Limited company",
      certifications: "Gas Safe 987654",
      insurer_name: "Umbrella Insurance",
    });
  });
});

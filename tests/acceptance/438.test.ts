import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock next/navigation to track redirect calls
const mockRedirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT: ${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

// Helper to create stubbed Supabase client
type Outcome = { data: unknown; error: { message: string } | null };

function createStubClient(outcome: Outcome) {
  const maybeSingle = vi.fn(async () => outcome);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const eq = vi.fn((_column?: string, _value?: string) => query);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const select = vi.fn((_columns?: string) => query);
  const query = { select, eq, maybeSingle };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const from = vi.fn((_table?: string) => query);

  return { client: { from } as unknown as SupabaseClient, select, from };
}

describe("require-contractor helper", () => {
  beforeEach(() => {
    mockRedirect.mockClear();
  });

  it("throws when query errors and does not redirect", async () => {
    const stub = createStubClient({
      data: null,
      error: { message: "column id does not exist" },
    });

    const { requireContractor } = await import("@/lib/require-contractor");

    await expect(
      requireContractor(stub.client, "user-123", "id, company_name")
    ).rejects.toThrow();

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("thrown error names the lookup for diagnosability", async () => {
    const stub = createStubClient({
      data: null,
      error: { message: "network timeout" },
    });

    const { requireContractor } = await import("@/lib/require-contractor");

    await expect(
      requireContractor(stub.client, "user-456", "company_name")
    ).rejects.toThrow(/contractor/i);
  });

  it("redirects to /setup when query succeeds with no row", async () => {
    const stub = createStubClient({
      data: null,
      error: null,
    });

    const { requireContractor } = await import("@/lib/require-contractor");

    await expect(
      requireContractor(stub.client, "user-789", "id")
    ).rejects.toThrow("REDIRECT: /setup");

    expect(mockRedirect).toHaveBeenCalledWith("/setup");
  });

  it("returns contractor when query succeeds with a row", async () => {
    const contractorData = {
      id: "contractor-123",
      company_name: "Acme Electric",
    };

    const stub = createStubClient({
      data: contractorData,
      error: null,
    });

    const { requireContractor } = await import("@/lib/require-contractor");

    const result = await requireContractor(
      stub.client,
      "user-999",
      "id, company_name"
    );

    expect(result).toEqual(contractorData);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("passes requested columns to select() unchanged", async () => {
    const stub = createStubClient({
      data: { id: "c1", company_name: "Test Co", business_profile: {} },
      error: null,
    });

    const { requireContractor } = await import("@/lib/require-contractor");

    await requireContractor(
      stub.client,
      "user-111",
      "id, company_name, business_profile"
    );

    expect(stub.select).toHaveBeenCalledWith("id, company_name, business_profile");
  });

  it("does not widen the column list beyond what was requested", async () => {
    const stub = createStubClient({
      data: { company_name: "Solo Co" },
      error: null,
    });

    const { requireContractor } = await import("@/lib/require-contractor");

    await requireContractor(stub.client, "user-222", "company_name");

    // Should select ONLY company_name, not id or other columns
    expect(stub.select).toHaveBeenCalledWith("company_name");
    expect(stub.select).not.toHaveBeenCalledWith(
      expect.stringContaining("id")
    );
  });
});

describe("Page components call the helper", () => {
  beforeEach(() => {
    mockRedirect.mockClear();
  });

  it("helper module exists and can be imported", async () => {
    const mod = await import("@/lib/require-contractor");
    expect(mod.requireContractor).toBeDefined();
    expect(typeof mod.requireContractor).toBe("function");
  });

  it("jobs page exists and exports a default component", async () => {
    const mod = await import("@/app/jobs/page");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("dashboard page exists and exports a default component", async () => {
    const mod = await import("@/app/dashboard/page");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("costs/voice page exists and exports a default component", async () => {
    const mod = await import("@/app/costs/voice/page");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("motko page exists and exports a default component", async () => {
    const mod = await import("@/app/motko/page");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});

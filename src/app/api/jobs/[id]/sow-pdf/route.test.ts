import { describe, it, expect, vi, beforeEach } from "vitest";

// Query-chain stub: .select(...).eq(...).maybeSingle() resolves to `result`.
const chain = (result: unknown) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.maybeSingle = async () => result;
  return c;
};

const getUser = vi.fn();
const userFrom = vi.fn();
const adminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from: userFrom }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: adminFrom }),
}));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: async () => Buffer.from("%PDF-1.4"),
}));
vi.mock("@/lib/pdf/sow-pdf", () => ({ SowPdf: () => null }));

import { GET } from "./route";

const call = (id = "job-1") =>
  GET({} as never, { params: Promise.resolve({ id }) } as never);

const sowJob = {
  sow_json: { customer_name: "Real Customer" },
  created_at: "2026-01-01T00:00:00.000Z",
  customer: { name: "Real Customer", contact: { email: "c@example.com" } },
  contractor: {
    company_name: "Acme",
    company_number: null,
    trade: "Plumber",
    vat_number: null,
    branding: {},
  },
};

describe("GET /api/jobs/[id]/sow-pdf — tenant-scoped access (H3)", () => {
  beforeEach(() => {
    getUser.mockReset();
    userFrom.mockReset();
    adminFrom.mockReset();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
    expect(res.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("returns 404 (not 200) when an authenticated trade requests another tenant's job", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "attacker" } } });
    // RLS returns no row for a job the caller does not own.
    userFrom.mockReturnValue(chain({ data: null }));
    const res = await call("victim-job");
    expect(res.status).toBe(404);
    // The admin client must never render the victim's PII.
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("renders the PDF when the authenticated trade owns the job", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
    userFrom.mockReturnValue(chain({ data: { id: "job-1" } }));
    adminFrom.mockReturnValue(chain({ data: sowJob }));
    const res = await call("job-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });
});

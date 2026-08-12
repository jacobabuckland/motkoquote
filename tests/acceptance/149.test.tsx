/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock the Supabase admin client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatDate: (iso: string) => {
    if (!iso) return "";
    // Simple mock: just return a formatted date string
    return "12 Aug 2026";
  },
  formatGBP: (pounds: number) => {
    if (!Number.isFinite(pounds)) return "£0.00";
    return `£${pounds.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },
}));

vi.mock("@/components/ui/made-with-motko", () => ({
  MadeWithMotko: () => null,
}));

// We need to import the page component after the mocks are set up
// But Next.js 15 server components are async functions, so we'll need to await them
type PageComponent = (props: { params: Promise<{ id: string }> }) => Promise<React.ReactElement>;
let InvoicePaidPage: PageComponent;

describe("Issue #149: Brand the payment receipt page", () => {
  beforeEach(async () => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Set up the mock chain
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });

    // Dynamically import the page component
    const mod = await import("@/app/i/[id]/paid/page");
    InvoicePaidPage = mod.default as unknown as PageComponent;
  });

  afterEach(() => {
    cleanup();
  });

  describe("Logo rendering", () => {
    it("renders the trade's logo when logo_url exists", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 8132,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Smith Joinery",
              branding: {
                logo_url: "https://example.com/logo.png",
              },
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      const logo = screen.getByRole("img");
      expect(logo).toBeDefined();
      expect(logo.getAttribute("src")).toBe("https://example.com/logo.png");
      expect(logo.getAttribute("alt")).toBe("Smith Joinery");
    });

    it("renders monogram fallback when logo_url is absent", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 5000,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Acme Plumbing",
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      // The monogram should render the first letter of the company name
      expect(screen.getByText("A")).toBeDefined();
    });

    it("renders monogram with uppercase first letter", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 3000,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "smith builders",
              branding: { logo_url: null },
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      expect(screen.getByText("S")).toBeDefined();
    });
  });

  describe("Amount and payee rendering", () => {
    it("renders amount in the form 'You paid £X to Company Name'", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 8132.5,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Smith Joinery",
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      expect(screen.getByText(/You paid £8,132\.50 to Smith Joinery/)).toBeDefined();
    });

    it("omits 'to Company' when company_name is missing", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 1500,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: null,
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      expect(screen.getByText(/You paid £1,500\.00/)).toBeDefined();
      // Should NOT contain "to" when company name is missing
      expect(screen.queryByText(/to\s*$/)).toBeNull();
    });

    it("uses the recorded amount from the database", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 12345.67,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Test Ltd",
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      expect(screen.getByText(/£12,345\.67/)).toBeDefined();
    });
  });

  describe("Payment date rendering", () => {
    it("renders the payment date", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 5000,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Acme",
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      // The mock formatDate returns "12 Aug 2026"
      expect(screen.getByText(/12 Aug 2026/)).toBeDefined();
    });

    it("omits the date when paid_at is null", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 5000,
          paid_at: null,
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Acme",
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      // Should not render a date or date placeholder
      expect(screen.queryByText(/12 Aug 2026/)).toBeNull();
      expect(screen.queryByText(/Paid on/)).toBeNull();
    });
  });

  describe("Edge cases", () => {
    it("omits the amount line when amount is null", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: null,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Acme",
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      // Should not render "You paid £0" or any amount
      expect(screen.queryByText(/You paid/)).toBeNull();
      expect(screen.queryByText(/£0/)).toBeNull();
    });

    it("renders correctly for zero amount (different from null)", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 0,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Acme",
              branding: null,
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      // Zero is a valid amount and should be rendered
      expect(screen.getByText(/You paid £0\.00/)).toBeDefined();
    });

    it("sets logo alt to empty string when company_name is missing", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 5000,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: null,
              branding: {
                logo_url: "https://example.com/logo.png",
              },
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });
      render(result);

      const logo = screen.getByRole("img");
      expect(logo.getAttribute("alt")).toBe("");
    });

    it("renders correctly when opened later (uses persisted data)", async () => {
      // This test verifies that the page uses the recorded payment data
      // rather than recalculating or re-querying external systems
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 9999,
          paid_at: "2025-01-15T09:00:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Historical Trade",
              branding: {
                logo_url: "https://example.com/old-logo.png",
              },
            },
          },
        },
      });

      const result = await InvoicePaidPage({ params: Promise.resolve({ id: "old-invoice" }) });
      render(result);

      // Should render the historical amount and date exactly as recorded
      expect(screen.getByText(/£9,999\.00/)).toBeDefined();
      expect(screen.getByText(/Historical Trade/)).toBeDefined();
    });
  });

  describe("Database query", () => {
    it("queries invoices with joins to job and contractor", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          amount: 5000,
          paid_at: "2026-08-12T10:30:00Z",
          payment_method: "motko_bank",
          job: {
            contractor: {
              company_name: "Test",
              branding: null,
            },
          },
        },
      });

      await InvoicePaidPage({ params: Promise.resolve({ id: "test-id" }) });

      // Verify the query includes the necessary fields
      expect(mockFrom).toHaveBeenCalledWith("invoices");
      expect(mockSelect).toHaveBeenCalled();

      // The select call should include amount, paid_at, and joins to job/contractor
      const selectArg = mockSelect.mock.calls[0][0];
      expect(selectArg).toContain("amount");
      expect(selectArg).toContain("paid_at");
      expect(selectArg).toContain("job");
      expect(selectArg).toContain("contractor");
      expect(selectArg).toContain("company_name");
      expect(selectArg).toContain("branding");
    });
  });
});

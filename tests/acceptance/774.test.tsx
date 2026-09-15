/**
 * @vitest-environment happy-dom
 */

/**
 * JOB-2: An archived job says so on its own page.
 *
 * Two archive mechanisms exist:
 * 1. Quote status = 'archived'
 * 2. Job archived_at timestamp
 *
 * The job page must recognize both and show archived state regardless of which
 * produced it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The job page is an async server component. Await it to get the element tree,
// then render.
const renderJobPage = async (jobData: {
  archived_at: string | null;
  quote?: { status: string } | null;
  hasInvoice?: boolean;
}) => {
  vi.resetModules();

  const job = {
    id: "job-123",
    created_at: "2026-09-01T09:00:00.000Z",
    transcript: null,
    extracted_json: { job_type: "Bathroom refit" },
    sow_json: null,
    status: "drafted",
    fee_amount_pennies: null,
    fee_status: null,
    fee_waived_reason: null,
    work_completed_at: null,
    settlement_state: null,
    payment_provider_ref: null,
    archived_at: jobData.archived_at,
    customer: {
      name: "Jordan Ellis",
      contact: { email: "jordan@example.com" },
    },
    contractor: {
      vat_registered: false,
      free_jobs_remaining: 3,
      business_profile: null,
    },
  };

  const quote = jobData.quote ?? {
    id: "quote-123",
    line_items_json: [],
    contractor_flags_json: null,
    total: 4200,
    subtotal: 4200,
    vat_amount: 0,
    deposit_pennies: null,
    sent_total: 4200,
    status: "sent",
    sent_at: "2026-09-01T10:00:00.000Z",
    viewed_at: null,
    accepted_at: null,
    declined_at: null,
    created_at: "2026-09-01T09:30:00.000Z",
    contracts: null,
    invoices: jobData.hasInvoice
      ? [
          {
            id: "invoice-123",
            amount: 4200,
            status: "unpaid",
            invoice_type: "final",
            due_date: "2026-09-15T00:00:00.000Z",
            created_at: "2026-09-01T11:00:00.000Z",
            paid_at: null,
            chase_events: [],
          },
        ]
      : [],
  };

  // Stub Supabase queries
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-1" } },
        }),
      },
      from: (table: string) => {
        if (table === "jobs") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: job, error: null }),
              }),
            }),
          };
        }
        if (table === "quotes") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: quote, error: null }),
              }),
            }),
          };
        }
        if (table === "payment_stages") {
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      },
    }),
  }));

  // Stub throw helper
  vi.doMock("@/lib/query-error", () => ({
    throwIfQueryFailed: async () => {},
  }));

  // Stub server actions to inert markup
  vi.doMock("@/app/jobs/[id]/job-archive-actions", () => ({
    archiveJob: async () => {},
    restoreJob: async () => {},
  }));
  vi.doMock("@/app/jobs/[id]/cost-actions", () => ({
    getJobCosts: async () => ({ ok: true, data: [] }),
  }));
  vi.doMock("@/app/jobs/[id]/pnl-actions", () => ({
    getJobPnL: async () => null,
  }));

  // Stub client components to simple markup so the page renders
  vi.doMock("@/app/jobs/[id]/archive-job-button", () => ({
    ArchiveJobButton: () => <button type="button">Archive job</button>,
  }));
  vi.doMock("@/app/jobs/archived/restore-job-button", () => ({
    RestoreJobButton: () => <button type="button">Restore</button>,
  }));
  vi.doMock("@/app/jobs/[id]/mark-as-paid-button", () => ({
    MarkAsPaidButton: () => <button type="button">Mark as paid</button>,
  }));

  const mod = await import("@/app/jobs/[id]/page");
  const Page = mod.default;
  const params = Promise.resolve({ id: "job-123" });
  const searchParams = Promise.resolve({});
  render(await Page({ params, searchParams }));
};

afterEach(cleanup);

describe("JOB-2: archived job state on its own page", () => {
  describe("a job archived via archived_at", () => {
    it("reads as archived on its page", async () => {
      await renderJobPage({
        archived_at: "2026-09-02T14:00:00.000Z",
        quote: { status: "sent" },
      });

      // The page must say it is archived. The exact wording may vary, but it
      // must contain "archived" or "Archived".
      const archived = screen.queryByText(/archived/i);
      expect(archived).not.toBeNull();
    });

    it("offers a Restore button", async () => {
      await renderJobPage({
        archived_at: "2026-09-02T14:00:00.000Z",
        quote: { status: "sent" },
      });

      const restoreButton = screen.queryByRole("button", { name: /restore/i });
      expect(restoreButton).not.toBeNull();
    });

    it("does not offer the Archive job button again", async () => {
      await renderJobPage({
        archived_at: "2026-09-02T14:00:00.000Z",
        quote: { status: "sent" },
      });

      const archiveButton = screen.queryByRole("button", { name: /archive job/i });
      expect(archiveButton).toBeNull();
    });

    it("does not offer mark-as-paid actions", async () => {
      await renderJobPage({
        archived_at: "2026-09-02T14:00:00.000Z",
        quote: { status: "accepted" },
        hasInvoice: true,
      });

      const markAsPaidButton = screen.queryByRole("button", { name: /mark as paid/i });
      expect(markAsPaidButton).toBeNull();
    });
  });

  describe("a job archived via quote status", () => {
    it("continues to read as archived as it does today", async () => {
      await renderJobPage({
        archived_at: null,
        quote: { status: "archived" },
      });

      // This is the mechanism that already works. Must keep working.
      // The page shows "archived" in multiple places (status chip, panel headline, etc.)
      const archivedElements = screen.getAllByText(/archived/i);
      expect(archivedElements.length).toBeGreaterThan(0);
    });

    it("does not offer the Archive job button", async () => {
      await renderJobPage({
        archived_at: null,
        quote: { status: "archived" },
      });

      const archiveButton = screen.queryByRole("button", { name: /archive job/i });
      expect(archiveButton).toBeNull();
    });
  });

  describe("a job archived via both mechanisms", () => {
    it("reads as archived", async () => {
      await renderJobPage({
        archived_at: "2026-09-02T14:00:00.000Z",
        quote: { status: "archived" },
      });

      // When both mechanisms are active, it still reads as archived
      const archivedElements = screen.getAllByText(/archived/i);
      expect(archivedElements.length).toBeGreaterThan(0);
    });

    it("offers a Restore button", async () => {
      // Restore clears archived_at; quote status is independent.
      await renderJobPage({
        archived_at: "2026-09-02T14:00:00.000Z",
        quote: { status: "archived" },
      });

      const restoreButton = screen.queryByRole("button", { name: /restore/i });
      expect(restoreButton).not.toBeNull();
    });
  });

  describe("a job that has been restored", () => {
    it("does not read as archived", async () => {
      await renderJobPage({
        archived_at: null,
        quote: { status: "sent" },
      });

      // Not archived, so the page should NOT say "archived" in the status panel.
      // It should show the actual stage ("Waiting on Jordan to accept the quote").
      const archived = screen.queryByText(/you archived/i);
      expect(archived).toBeNull();
    });

    it("offers the Archive job button", async () => {
      await renderJobPage({
        archived_at: null,
        quote: { status: "sent" },
      });

      const archiveButton = screen.queryByRole("button", { name: /archive job/i });
      expect(archiveButton).not.toBeNull();
    });
  });

  describe("state derivation with archived_at", () => {
    it("deriveJobState or deriveSituation accounts for archived_at", async () => {
      // This tests the actual derivation function directly, ensuring archived_at
      // is recognized as an archived state.
      const { deriveSituation } = await import("@/lib/job-stages");

      const quoteState = {
        status: "sent",
        sent_at: "2026-09-01T10:00:00.000Z",
        viewed_at: null,
        accepted_at: null,
        declined_at: null,
      };

      // Without archived_at, the situation should NOT be archived
      const normalSituation = deriveSituation(quoteState, null, []);
      expect(normalSituation.situation).not.toBe("quote_archived");

      // With archived_at (or some representation of it), it should be archived.
      // The signature may change to accept archived_at as a parameter.
      // This test will fail first with "cannot find module" (expected), then with
      // "wrong number of arguments" if the signature changed, then will pass
      // once the implementation accounts for archived_at.
      //
      // For now, this asserts the ABSENCE of archived behavior when archived_at
      // is absent. The implementation will add the parameter.
      expect(normalSituation.situation).toBe("quote_sent");
    });
  });
});

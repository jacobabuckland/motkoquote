/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// JOB-1. The archived-jobs page has to say something useful when there is
// nothing archived — that is the state most contractors will see, most of the
// time, and an empty page reads as broken rather than as empty.
//
// The frozen acceptance test for this reads the page's source and checks the
// strings "EmptyState" and "Nothing archived" appear in it. That asserts how
// the page is WRITTEN, so it breaks on any correct refactor — renaming the
// component, moving the copy into a constant, or extracting the branch — while
// telling you nothing about what a contractor actually sees. QA raised it three
// cycles running and was right every time; the file is frozen, so it stays.
//
// This asserts the same requirement as behaviour: render the real page and read
// what lands in the document. It covers the branch in both directions, because
// an empty-state test that only ever renders the empty case cannot tell a
// correct page from one that shows "Nothing archived" over the top of a list.

// The page is an async server component. It is awaited to get its element tree,
// then handed to render() — no request context is involved, because everything
// it reaches for is stubbed below.
const ARCHIVED_JOB = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-08-01T09:00:00.000Z",
  archived_at: "2026-09-01T09:00:00.000Z",
  extracted_json: { job_type: "Bathroom refit" },
  customer: { name: "Rowan Ellis" },
  quote: { total: 4200, status: "accepted" },
};

type ArchivedRow = typeof ARCHIVED_JOB;

const renderPage = async (rows: ArchivedRow[]) => {
  vi.resetModules();

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => ({
        select: () => ({
          not: () => ({
            order: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  }));

  vi.doMock("@/lib/require-contractor", () => ({
    requireContractor: async () => ({ id: "contractor-1", company_name: "Ellis Bathrooms" }),
  }));

  // Both pull in server actions, which are not the subject here and cannot be
  // invoked outside a request. Stubbed to inert markup so the page still renders.
  vi.doMock("@/app/actions", () => ({ signOut: async () => {} }));
  vi.doMock("@/app/jobs/archived/restore-job-button", () => ({
    RestoreJobButton: () => <button type="button">Restore</button>,
  }));

  const mod = await import("@/app/jobs/archived/page");
  const Page = mod.default;
  render(await Page());
};

afterEach(cleanup);

describe("the archived jobs page tells the contractor what they are looking at", () => {
  it("shows the empty state, and says what archiving does, when nothing is archived", async () => {
    await renderPage([]);

    expect(screen.getByText("Nothing archived")).toBeDefined();

    // The copy is the point, not the component. A contractor arriving here has
    // to learn where archived jobs come from and that chasing stops — that is
    // the whole reason this page is not simply blank.
    const description = screen.getByText(/Jobs you archive/i);
    expect(description.textContent).toMatch(/stops automated chasing/i);
  });

  it("shows the archived job, and no empty state, when there is one", async () => {
    await renderPage([ARCHIVED_JOB]);

    expect(screen.getByText("Rowan Ellis")).toBeDefined();
    expect(screen.getByText("Archived")).toBeDefined();

    // The other half of the branch. Without this, a page that rendered the
    // empty state unconditionally would still pass the test above.
    expect(screen.queryByText("Nothing archived")).toBeNull();
  });

  it("offers a way back for every archived job", async () => {
    // Archiving is never destructive, so the restore path has to be present on
    // the surface a contractor lands on when they archived something by mistake.
    await renderPage([ARCHIVED_JOB]);

    expect(screen.getByRole("button", { name: "Restore" })).toBeDefined();
  });
});

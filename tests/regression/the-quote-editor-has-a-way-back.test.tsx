/**
 * @vitest-environment happy-dom
 *
 * 20 Sep. Opening a job's quote for detail left the contractor on a screen
 * with no way back to the job: nothing under /jobs/[id] renders a layout, so
 * the editor had the browser's own back gesture and nothing else — and inside
 * the Capacitor shell there isn't one.
 *
 * Its two siblings, /jobs/[id]/sow and /jobs/[id]/run, have rendered PageHeader
 * with this exact href and label all along. The editor was the one that was
 * missed, which is why this asserts the LINK a contractor can follow rather
 * than the presence of a component.
 *
 * `QuoteEditor` is stubbed. It is a large client component with its own state,
 * and rendering it here would test it rather than the route's shell — the
 * claim is about what wraps it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const JOB = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }),
    },
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => {
          if (table === "contractors") {
            return { data: { id: "contractor_1", vat_registered: false }, error: null };
          }
          if (table === "jobs") {
            return {
              data: {
                id: "33333333-3333-4333-8333-333333333333",
                transcript: null,
                sow_json: null,
                customer: { name: "Megan Farrant", contact: {} },
              },
              error: null,
            };
          }
          if (table === "quotes") {
            return {
              data: {
                id: "quote_1",
                line_items_json: [],
                contractor_flags_json: [],
                status: "draft",
                sent_total: null,
                total: 884.16,
                subtotal: 736.8,
                vat_amount: 147.36,
                deposit_pennies: null,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };

  return { client };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
}));

vi.mock("@/app/jobs/[id]/quote-editor", () => ({
  QuoteEditor: () => <div data-testid="quote-editor" />,
}));

afterEach(cleanup);

const renderPage = async () => {
  const mod = await import("@/app/jobs/[id]/quote/page");
  render(await mod.default({ params: Promise.resolve({ id: JOB }) }));
};

describe("the quote editor", () => {
  it("offers a way back to the job it belongs to", async () => {
    await renderPage();

    const back = screen.getByRole("link", { name: /back to job/i });

    expect(back.getAttribute("href")).toBe(`/jobs/${JOB}`);
  });

  it("still renders the editor itself", async () => {
    // The shell must not have replaced what the contractor came here for.
    await renderPage();

    expect(screen.getByTestId("quote-editor")).toBeTruthy();
  });
});

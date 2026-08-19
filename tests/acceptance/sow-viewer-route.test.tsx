/**
 * Acceptance: the in-app statement-of-work viewer at /jobs/[id]/sow.
 *
 * It replaces a target="_blank" link to the authenticated PDF route, which the
 * Capacitor WKWebView handed to Safari — no session cookie there, so the
 * middleware served a /login page to a contractor who was already signed in.
 *
 * The route's own auth must be unchanged: ownership is proved through RLS, and
 * a non-owner gets a 404 that is indistinguishable from an unknown id.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

const NOT_FOUND = "NEXT_NOT_FOUND";

const h = vi.hoisted(() => {
  const state = {
    user: { id: "u-1" } as { id: string } | null,
    // null models both "not yours" and "doesn't exist" — RLS returns no row
    // either way, which is exactly the indistinguishability we want.
    job: null as { id: string; sow_json: unknown } | null,
  };

  const client = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: state.job, error: null }),
      };
      return b;
    },
  };

  return { state, client };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

type AnyProps = Record<string, unknown> & { children?: ReactNode };

// Flattens a rendered element tree into the props of every node, so we can ask
// what the page offers without mounting a DOM.
const flatten = (node: ReactNode): AnyProps[] => {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node !== "object") return [];

  const element = node as ReactElement<AnyProps>;
  const props = (element.props ?? {}) as AnyProps;
  return [props, ...flatten(props.children)];
};

const renderPage = async (id: string) => {
  const { default: SowViewerPage } = await import("@/app/jobs/[id]/sow/page");
  return SowViewerPage({ params: Promise.resolve({ id }) });
};

// Both channels count as "a link the contractor can follow": plain anchors use
// `href`, and PageHeader takes the back destination as `backHref`.
const hrefs = (props: AnyProps[]): string[] =>
  props
    .flatMap((p) => [p.href, p.backHref])
    .filter((h): h is string => typeof h === "string");

beforeEach(() => {
  h.state.user = { id: "u-1" };
  h.state.job = { id: "job-1", sow_json: { rooms: [{ name: "Kitchen" }] } };
});

describe("/jobs/[id]/sow — access control", () => {
  it("404s an unauthenticated visitor", async () => {
    h.state.user = null;
    await expect(renderPage("job-1")).rejects.toThrow(NOT_FOUND);
  });

  it("404s a signed-in contractor who does not own the job", async () => {
    h.state.job = null;
    await expect(renderPage("someone-elses-job")).rejects.toThrow(NOT_FOUND);
  });

  it("renders the viewer for the owning contractor", async () => {
    const props = flatten(await renderPage("job-1"));
    expect(hrefs(props)).toContain("/api/jobs/job-1/sow-pdf");
  });
});

describe("/jobs/[id]/sow — the contractor is never stranded", () => {
  it("offers a way back to the job", async () => {
    const props = flatten(await renderPage("job-1"));
    expect(hrefs(props)).toContain("/jobs/job-1");
  });

  it("embeds the PDF as a same-origin subresource, so it carries the session", async () => {
    const props = flatten(await renderPage("job-1"));
    const embed = props.find((p) => p.type === "application/pdf");
    expect(embed?.data).toBe("/api/jobs/job-1/sow-pdf");
  });

  it("opens the PDF in the same window — a new window is what broke this", async () => {
    const props = flatten(await renderPage("job-1"));
    expect(props.every((p) => p.target !== "_blank")).toBe(true);
  });

  it("explains itself, and still offers the way back, when the job has no SoW", async () => {
    h.state.job = { id: "job-1", sow_json: null };
    const props = flatten(await renderPage("job-1"));

    // No empty PDF frame pointing at a route that would 404.
    expect(props.some((p) => p.type === "application/pdf")).toBe(false);
    expect(hrefs(props)).toContain("/jobs/job-1");
  });
});

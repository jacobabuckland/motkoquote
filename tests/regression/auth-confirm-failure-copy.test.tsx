/**
 * @vitest-environment happy-dom
 */

// Regression: the auth callback must say WHICH failure happened.
//
// It used to render one fixed "Sign-in link expired" for every failing
// condition — including the one where the link was never redeemed at all (a
// PKCE code opened in a browser that does not hold the verifier) and the one
// where the URL carried no credential in the first place. Two costs, both
// paid: a user whose link failed in the wrong browser was told to request
// another, which fails identically every time; and a screenshot of this page
// carried no information, so the bug report that led here pointed the
// investigation at the wrong root cause for a day.
//
// These assertions are about what a user can read on the screen, not about how
// the component is written. The three failures must be distinguishable by
// their rendered text alone — that is the whole property.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

// The router object must be STABLE across renders. The component's effect is
// keyed on [router], so a mock that builds a fresh object per call re-runs the
// effect on every render, which setState turns into an infinite loop and the
// test hangs rather than fails. In production useRouter() is stable; the mock
// has to be too, or it is testing a component that does not exist.
const { replace, refresh, router } = vi.hoisted(() => {
  const replace = vi.fn();
  const refresh = vi.fn();
  return {
    replace,
    refresh,
    router: {
      replace,
      refresh,
      push: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/auth/confirm",
  useSearchParams: () => new URLSearchParams(),
}));

const getSession = vi.fn<() => Promise<{ data: { session: unknown | null } }>>(
  async () => ({ data: { session: null } }),
);
const exchangeCodeForSession = vi.fn<
  (code: string) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }));
const setSession = vi.fn<
  (tokens: { access_token: string; refresh_token: string }) => Promise<{
    error: { message: string } | null;
  }>
>(async () => ({ error: null }));
const verifyOtp = vi.fn<
  (params: { type: string; token_hash: string }) => Promise<{
    error: { message: string } | null;
  }>
>(async () => ({ error: null }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession, exchangeCodeForSession, setSession, verifyOtp },
  }),
}));

// The component reads window.location directly, so the URL is the input.
const visit = (search: string, hash = "") => {
  window.history.replaceState({}, "", `/auth/confirm${search}${hash}`);
};

const mountConfirm = async () => {
  const { default: ConfirmPage } = await import("@/app/auth/confirm/page");
  render(<ConfirmPage />);
  // Every branch starts on "Signing you in…" and resolves asynchronously.
  await waitFor(() => expect(screen.queryByText("Signing you in…")).toBeNull());
};

describe("the auth callback names the failure it actually hit", () => {
  beforeEach(() => {
    replace.mockClear();
    refresh.mockClear();
    getSession.mockClear();
    exchangeCodeForSession.mockClear();
    setSession.mockClear();
    verifyOtp.mockClear();
    getSession.mockImplementation(async () => ({ data: { session: null } }));
    exchangeCodeForSession.mockImplementation(async () => ({ error: null }));
    visit("");
  });

  it("reports a provider-rejected link as expired, and shows the code", async () => {
    visit("?error=access_denied&error_code=otp_expired");
    await mountConfirm();

    expect(document.body.textContent).toMatch(/expired/i);
    // The discriminator the old page threw away. It is already in the user's
    // address bar, so showing it exposes nothing new — and it is what makes
    // the next screenshot of this screen worth anything.
    expect(document.body.textContent).toContain("otp_expired");
  });

  it("does not call a failed redemption 'expired' when the code could not be exchanged here", async () => {
    visit("?code=abc123");
    getSession.mockImplementation(async () => ({ data: { session: null } }));
    exchangeCodeForSession.mockImplementation(async () => ({
      error: { message: "both auth code and code verifier should be non-empty" },
    }));

    await mountConfirm();

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(document.body.textContent).not.toMatch(/expired/i);
    // The one thing that actually gets this user signed in.
    expect(document.body.textContent).toMatch(/same browser it was requested from/i);
  });

  it("does not call an empty callback URL 'expired'", async () => {
    visit("");
    await mountConfirm();

    expect(document.body.textContent).not.toMatch(/expired/i);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("offers a way back to sign in from every failure", async () => {
    for (const search of ["?error_code=otp_expired", "?code=abc123", ""]) {
      exchangeCodeForSession.mockImplementation(async () => ({
        error: { message: "nope" },
      }));
      visit(search);
      await mountConfirm();

      const back = screen.getByRole("link", { name: "Back to sign in" });
      expect(back.getAttribute("href")).toBe("/login");
      cleanup();
    }
  });

  it("renders three visibly different screens for the three failures", async () => {
    const headings: string[] = [];

    for (const search of ["?error_code=otp_expired", "?code=abc123", ""]) {
      exchangeCodeForSession.mockImplementation(async () => ({
        error: { message: "nope" },
      }));
      visit(search);
      await mountConfirm();

      headings.push(screen.getByRole("heading").textContent ?? "");
      cleanup();
    }

    expect(headings).toHaveLength(3);
    expect(new Set(headings).size, `headings were not distinct: ${headings.join(" | ")}`).toBe(3);
  });

  it("still signs the user in when the exchange succeeds", async () => {
    visit("?code=abc123");
    exchangeCodeForSession.mockImplementation(async () => ({ error: null }));

    const { default: ConfirmPage } = await import("@/app/auth/confirm/page");
    render(<ConfirmPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup"));
    expect(refresh).toHaveBeenCalled();
  });

  it("honours ?next on success", async () => {
    visit("?code=abc123&next=%2Fdashboard");
    exchangeCodeForSession.mockImplementation(async () => ({ error: null }));

    const { default: ConfirmPage } = await import("@/app/auth/confirm/page");
    render(<ConfirmPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});

describe("the duplicate failure screen is gone", () => {
  it("has no /auth/error page left to drift out of sync", () => {
    // It was a byte-identical copy of the block above with nothing routing to
    // it. Two copies of a screen is how one of them stops being maintained.
    //
    // Checked on disk rather than by importing: Vite resolves imports at
    // transform time, so a dynamic import of a deliberately-absent module
    // fails the whole file instead of the one assertion.
    expect(existsSync(join(process.cwd(), "src/app/auth/error/page.tsx"))).toBe(false);
  });
});

/**
 * @vitest-environment happy-dom
 */

// Regression: the sign-in email's 6-digit code must have somewhere to be typed.
//
// supabase/templates/magic_link.html has always rendered {{ .Token }} under the
// words "Or enter this code instead:". Nothing in the app called
// verifyOtp({ email, token }), so the email promised a fallback that did not
// exist — and the link it was a fallback FOR cannot be redeemed at all when it
// opens somewhere other than where it was requested:
//
//   - @supabase/ssr forces flowType "pkce" and keeps the code_verifier in a
//     cookie on this origin. The iOS shell is a WKWebView with its own cookie
//     jar, so a link requested in the app and opened from Mail in Safari has no
//     verifier and exchangeCodeForSession fails on the FIRST click.
//   - {{ .ConfirmationURL }} is redeemed by a plain GET on Supabase's
//     /auth/v1/verify, so a mail security scanner that prefetches links spends
//     the token before the human ever taps it.
//
// verifyOtp is immune to both: a POST that returns a session directly, with no
// verifier read at any point, and nothing a link prefetch can consume. The
// cookie-clearing test below is the one that actually pins that property.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

const { push, refresh, router } = vi.hoisted(() => {
  const push = vi.fn();
  const refresh = vi.fn();
  return {
    push,
    refresh,
    router: { push, refresh, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

const clearGuestArtefact = vi.fn();
vi.mock("@/lib/guest/session", () => ({
  clearGuestArtefact: () => clearGuestArtefact(),
}));

type VerifyArgs = { email?: string; token?: string; type?: string };

const signInWithOtp = vi.fn<
  (args: { email: string }) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }));
const verifyOtp = vi.fn<
  (args: VerifyArgs) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }));
const exchangeCodeForSession = vi.fn();
const setSession = vi.fn();
const signInWithPassword = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp,
      verifyOtp,
      exchangeCodeForSession,
      setSession,
      signInWithPassword,
    },
  }),
}));

// Drive the real screen to the state the email lands the user in: link
// requested, "check your email" showing.
const requestLink = async () => {
  const { default: LoginPage } = await import("@/app/login/page");
  render(<LoginPage />);

  fireEvent.click(screen.getByRole("button", { name: "Use an email link instead" }));
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "trade@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));

  await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
  return screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
};

describe("signing in with the emailed code", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    clearGuestArtefact.mockClear();
    signInWithOtp.mockClear();
    verifyOtp.mockClear();
    exchangeCodeForSession.mockClear();
    setSession.mockClear();
    signInWithOtp.mockImplementation(async () => ({ error: null }));
    verifyOtp.mockImplementation(async () => ({ error: null }));
    document.cookie
      .split(";")
      .forEach((c) => {
        const name = c.split("=")[0]?.trim();
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      });
  });

  it("offers a code input once the link has been sent", async () => {
    const input = await requestLink();

    expect(input).toBeTruthy();
    expect(input.getAttribute("inputmode")).toBe("numeric");
    // Lets iOS surface the code straight from the notification.
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(screen.getByRole("button", { name: "Sign in with code" })).toBeTruthy();
  });

  it("verifies the code against the address the link was sent to", async () => {
    const input = await requestLink();

    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with code" }));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalled());
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "trade@example.test",
      token: "123456",
      type: "email",
    });
  });

  it("reads no PKCE verifier — the whole point of this route", async () => {
    const input = await requestLink();

    // Everything the browser was holding for this origin is gone. This is the
    // state a user is in when they open the email on a different browser, or
    // in the app's WKWebView after requesting the link on the web. The link
    // cannot be redeemed here; the code must be.
    expect(document.cookie).toBe("");

    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with code" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(exchangeCodeForSession, "the code path must never touch PKCE").not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("lands the user on the dashboard, on the same terms as the password path", async () => {
    const input = await requestLink();

    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with code" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(clearGuestArtefact).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps a rejected code on screen and editable, and does not navigate", async () => {
    const input = await requestLink();
    verifyOtp.mockImplementation(async () => ({
      error: { message: "Token has expired or is invalid" },
    }));

    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with code" }));

    // The upstream prose is no longer what reaches the screen: auth errors are
    // mapped to typed codes with our own copy (A6), so an expired code reads as
    // an expired code rather than as Supabase's "Token has expired or is
    // invalid". What this test is actually about — the code stays on screen and
    // editable, and nothing navigates — is unchanged below.
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeTruthy());

    // A mistyped digit must be one edit away, not a fresh email — the resend
    // budget is 2 per hour.
    const stillThere = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    expect(stillThere.value).toBe("000000");
    expect(stillThere.disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(clearGuestArtefact).not.toHaveBeenCalled();
  });

  it("trims what the user pasted", async () => {
    const input = await requestLink();

    // Copying the code out of the email brings whitespace with it.
    fireEvent.change(input, { target: { value: " 123456 " } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with code" }));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalled());
    expect(verifyOtp).toHaveBeenCalledWith(
      expect.objectContaining({ token: "123456" }),
    );
  });
});

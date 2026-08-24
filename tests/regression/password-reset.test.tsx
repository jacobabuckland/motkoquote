/**
 * @vitest-environment happy-dom
 */

// Regression: a contractor who forgets their password must have a way back.
//
// /signup has always REQUIRED a password. Nothing ever called
// resetPasswordForEmail, there was no route matching *reset*, and no
// change-password control in settings — while supabase/templates/recovery.html
// and its [auth.email.template.recovery] entry in config.toml shipped, ready to
// send an email nothing could ask for. The only fallback was the emailed
// sign-in link, which cannot be redeemed when it opens in a different browser.
// Both routes into the account were shut at once.
//
// The trap this file exists to keep shut: verifying a recovery credential signs
// you in and changes NOTHING about the password. Sending that user onward
// without asking for a new one leaves them believing they reset it. That is
// worse than no reset flow, and it is exactly what the old /auth/confirm would
// have done with a recovery link — verified it and dropped them on /setup.
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

vi.mock("@/lib/guest/session", () => ({ clearGuestArtefact: vi.fn() }));

type ResetOptions = { redirectTo?: string };
type VerifyArgs = { email?: string; token?: string; type?: string };

const resetPasswordForEmail = vi.fn<
  (email: string, options?: ResetOptions) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }));
const verifyOtp = vi.fn<
  (args: VerifyArgs) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }));
const updateUser = vi.fn<
  (args: { password: string }) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail,
      verifyOtp,
      updateUser,
      signInWithOtp: vi.fn(async () => ({ error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      exchangeCodeForSession: vi.fn(),
      setSession: vi.fn(),
    },
  }),
}));

const openResetFlow = async () => {
  const { default: LoginPage } = await import("@/app/login/page");
  render(<LoginPage />);

  // The affordance a locked-out user goes looking for and could not find.
  fireEvent.click(screen.getByRole("button", { name: "Forgot your password?" }));
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "trade@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset email" }));

  await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());
};

describe("requesting a password reset", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    resetPasswordForEmail.mockClear();
    verifyOtp.mockClear();
    updateUser.mockClear();
    resetPasswordForEmail.mockImplementation(async () => ({ error: null }));
    verifyOtp.mockImplementation(async () => ({ error: null }));
    updateUser.mockImplementation(async () => ({ error: null }));
  });

  it("offers a way to reach the reset flow from the password form", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Forgot your password?" })).toBeTruthy();
  });

  it("asks Supabase to send the recovery email, pointed at the set-password screen", async () => {
    await openResetFlow();

    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [address, options] = resetPasswordForEmail.mock.calls[0] ?? [];
    expect(address).toBe("trade@example.test");
    // The link has to land somewhere that actually asks for a new password.
    expect(options?.redirectTo).toContain("/auth/confirm");
    expect(options?.redirectTo).toContain("next=%2Freset-password");
  });

  it("verifies a recovery code as a recovery credential, not a sign-in one", async () => {
    await openResetFlow();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with code" }));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalled());
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "trade@example.test",
      token: "123456",
      type: "recovery",
    });
  });

  it("sends a verified recovery to the set-password screen, never to the dashboard", async () => {
    await openResetFlow();

    fireEvent.change(screen.getByLabelText(/6-digit code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with code" }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    // The whole trap. A recovery code buys a session, not a new password.
    expect(push).toHaveBeenCalledWith("/reset-password");
    expect(push).not.toHaveBeenCalledWith("/dashboard");
  });
});

describe("setting the new password", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    updateUser.mockClear();
    updateUser.mockImplementation(async () => ({ error: null }));
  });

  const fill = (pw: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: pw } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: confirm },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
  };

  const mountReset = async () => {
    const { default: ResetPasswordPage } = await import("@/app/reset-password/page");
    render(<ResetPasswordPage />);
  };

  it("writes the new password and lands on the dashboard", async () => {
    await mountReset();
    fill("correct horse battery", "correct horse battery");

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "correct horse battery" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a password shorter than signup would have accepted", async () => {
    await mountReset();
    fill("short", "short");

    await waitFor(() => expect(screen.getByText(/at least 8 characters/i)).toBeTruthy());
    // A reset must not be a way to get a weaker password than /signup allows.
    expect(updateUser).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("refuses a mismatched confirmation", async () => {
    await mountReset();
    fill("correct horse battery", "correct horse batteries");

    await waitFor(() => expect(screen.getByText(/don't match/i)).toBeTruthy());
    expect(updateUser).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not claim success when the write failed", async () => {
    updateUser.mockImplementation(async () => ({ error: { message: "Session expired" } }));
    await mountReset();
    fill("correct horse battery", "correct horse battery");

    await waitFor(() => expect(screen.getByText(/Session expired/i)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
    // Back to a usable form, not stranded on a spinner.
    expect(
      (screen.getByRole("button", { name: "Save new password" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("the set-password screen is not a public route", () => {
  it("is absent from the middleware's public list, so a stranger cannot reach it", async () => {
    vi.resetModules();
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      }),
    }));

    const { updateSession } = await import("@/lib/supabase/middleware");
    const url = new URL("/reset-password", "https://motko.app");
    const response = await updateSession({
      nextUrl: { pathname: url.pathname, clone: () => new URL(url) },
      url: url.href,
      cookies: { getAll: () => [], set: () => {} },
      headers: new Headers(),
    } as unknown as Parameters<typeof updateSession>[0]);

    // Reaching this page requires the session that verifying the recovery
    // credential creates. The middleware's default deny IS the guard — there
    // is no check inside the page to forget.
    expect(response.headers.get("location")).toBe("https://motko.app/login");
    vi.doUnmock("@supabase/ssr");
  });
});

/**
 * @vitest-environment happy-dom
 */

// src/lib/referral.ts calls the code the source of truth and the link "just a
// carrier". Only the carrier had anywhere to land: the signup form was Email,
// Password, Confirm password, and a code given verbally or in a message could
// not be entered anywhere in the product.
//
// The parser for it already existed — normalizeReferralCode upper-cases, strips
// spaces and hyphens, and validates against an alphabet that drops I/O/0/1
// precisely because these codes get read aloud. Nothing called it with typed
// input.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Declared rather than inferred. A zero-argument vi.fn() makes
// mock.calls[0][0] a type error, which is what a test asserting on the
// arguments needs to reach.
type SignUpArgs = {
  email: string;
  password: string;
  options?: {
    emailRedirectTo?: string;
    data?: { referral_code?: string };
  };
};

const signUp = vi.fn(async (_args: SignUpArgs) => ({
  data: { session: null },
  error: null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signUp } }),
}));
vi.mock("@/app/actions", () => ({ trackSignup: vi.fn(async () => {}) }));
vi.mock("@/lib/guest/session", () => ({ clearGuestArtefact: vi.fn() }));

const landOn = (url: string) => {
  window.history.replaceState({}, "", url);
};

const renderSignup = async () => {
  const { default: SignupPage } = await import("@/app/signup/page");
  return render(<SignupPage />);
};

const fillCredentials = () => {
  fireEvent.change(screen.getByLabelText(/^Email$/i), {
    target: { value: "dan@example.co.uk" },
  });
  fireEvent.change(screen.getByLabelText(/^Password$/i), {
    target: { value: "correct-horse" },
  });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), {
    target: { value: "correct-horse" },
  });
};

const metadataCode = () =>
  signUp.mock.calls[0]?.[0]?.options?.data?.referral_code;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  landOn("/signup");
});

afterEach(cleanup);

describe("the referral code field", () => {
  it("exists, and is optional", async () => {
    await renderSignup();

    const field = screen.getByLabelText(/Referral code/i) as HTMLInputElement;
    expect(field).toBeDefined();
    expect(
      field.required,
      "a referral is a bonus, never one more thing between a trade and an account",
    ).toBe(false);
  });

  it("is pre-filled from the link the referee arrived on", async () => {
    landOn("/signup?ref=DAN4K2");
    await renderSignup();

    await waitFor(() => {
      const field = screen.getByLabelText(/Referral code/i) as HTMLInputElement;
      expect(field.value).toBe("DAN4K2");
    });
  });

  it("sends a typed code through to signup", async () => {
    await renderSignup();

    fireEvent.change(screen.getByLabelText(/Referral code/i), {
      target: { value: "dan 4k2" },
    });
    fillCredentials();
    fireEvent.submit(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    // Normalized on the way out, so redemption compares like with like.
    expect(metadataCode()).toBe("DAN4K2");
  });

  it("lets a contractor correct a code that came in on the link", async () => {
    landOn("/signup?ref=DAN4K2");
    await renderSignup();

    await waitFor(() => {
      expect(
        (screen.getByLabelText(/Referral code/i) as HTMLInputElement).value,
      ).toBe("DAN4K2");
    });

    fireEvent.change(screen.getByLabelText(/Referral code/i), {
      target: { value: "QRS789" },
    });
    fillCredentials();
    fireEvent.submit(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(
      metadataCode(),
      "what the contractor typed wins over what the link carried",
    ).toBe("QRS789");
  });
});

describe("a code that cannot be read", () => {
  it("is dropped rather than blocking the account", async () => {
    // Losing a referral is recoverable. Losing the signup is not.
    await renderSignup();

    fireEvent.change(screen.getByLabelText(/Referral code/i), {
      target: { value: "!!!" },
    });
    fillCredentials();
    fireEvent.submit(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(metadataCode()).toBeUndefined();
  });
});

describe("signing up with no referral at all", () => {
  it("carries no referral metadata", async () => {
    await renderSignup();

    fillCredentials();
    fireEvent.submit(screen.getByRole("button", { name: /Create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    expect(metadataCode()).toBeUndefined();
  });
});

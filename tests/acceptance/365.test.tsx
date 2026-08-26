/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  mockNativePlatform,
  mockCapacitorPlugins,
} from "../helpers/capacitor";

// Mock next/navigation router
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

// Mock Supabase client
type SignUpArgs = {
  email: string;
  password: string;
  options?: {
    emailRedirectTo?: string;
    data?: { referral_code?: string };
  };
};

// The return type is DECLARED, not inferred. Written as a bare
// `async (_args: SignUpArgs) => ({ data: { session: null }, error: null })`,
// TypeScript infers `session: null` from the default value, and every
// `mockResolvedValueOnce` below that supplies a real session is then a type
// error: "Type '{ user: { id: string; } }' is not assignable to type 'null'".
// AGENTS.md names this exact trap, and it is a hard stop rather than a
// tidiness problem — tsc covers tests/, and an acceptance test that cannot
// compile cannot be repaired downstream.
type SignUpResult = {
  data: { session: { user: { id: string } } | null };
  error: null;
};

const signUp = vi.fn(async (_args: SignUpArgs): Promise<SignUpResult> => ({
  data: { session: null },
  error: null,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signUp } }),
}));

vi.mock("@/app/actions", () => ({ trackSignup: vi.fn(async () => {}) }));
vi.mock("@/lib/guest/session", () => ({ clearGuestArtefact: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mockNativePlatform(false); // Default to web
  mockCapacitorPlugins();
});

afterEach(cleanup);

const fillAndSubmitSignup = () => {
  fireEvent.change(screen.getByLabelText(/^Email$/i), {
    target: { value: "trade@example.co.uk" },
  });
  fireEvent.change(screen.getByLabelText(/^Password$/i), {
    target: { value: "correct-horse-battery" },
  });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), {
    target: { value: "correct-horse-battery" },
  });
  fireEvent.submit(screen.getByRole("button", { name: /Create account/i }));
};

describe("post-signup app handoff for web users", () => {
  it("navigates a web visitor to /get-the-app when signup succeeds", async () => {
    // Session returned immediately (email confirmation disabled)
    signUp.mockResolvedValueOnce({
      data: { session: { user: { id: "123" } } },
      error: null,
    });

    mockNativePlatform(false); // Web platform
    const { default: SignupPage } = await import("@/app/signup/page");
    render(<SignupPage />);

    fillAndSubmitSignup();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(
      mockPush,
      "web signup with immediate session navigates to /get-the-app",
    ).toHaveBeenCalledWith("/get-the-app");
  });

  it("navigates a native shell user directly to /setup, skipping the app handoff", async () => {
    signUp.mockResolvedValueOnce({
      data: { session: { user: { id: "123" } } },
      error: null,
    });

    mockNativePlatform(true); // Native shell
    const { default: SignupPage } = await import("@/app/signup/page");
    render(<SignupPage />);

    fillAndSubmitSignup();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(
      mockPush,
      "native shell signup with immediate session navigates directly to /setup",
    ).toHaveBeenCalledWith("/setup");
  });

  it("offers a link to /get-the-app in the confirmation-required state", async () => {
    // No session returned (email confirmation required)
    signUp.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    mockNativePlatform(false);
    const { default: SignupPage } = await import("@/app/signup/page");
    render(<SignupPage />);

    fillAndSubmitSignup();

    await waitFor(() =>
      expect(screen.getByText(/Check.*to confirm your account/i)).toBeDefined()
    );

    const link = screen.getByRole("link", { name: /get.*app|download/i });
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toContain("/get-the-app");
  });
});

describe("/get-the-app route", () => {
  it("renders for a web visitor and offers the app via motko.co.uk", async () => {
    mockNativePlatform(false);

    const { default: GetTheAppPage } = await import(
      "@/app/get-the-app/page"
    );
    render(<GetTheAppPage />);

    const link = screen.getByRole("link", {
      name: /download|app store|get.*app/i,
    });
    expect(link).toBeDefined();
    expect(
      (link as HTMLAnchorElement).href,
      "primary action links to motko.co.uk, which owns the App Store URL",
    ).toBe("https://motko.co.uk/");
  });

  it("offers 'Continue to setup' so a trade who does not want the app can proceed", async () => {
    mockNativePlatform(false);

    const { default: GetTheAppPage } = await import(
      "@/app/get-the-app/page"
    );
    render(<GetTheAppPage />);

    const link = screen.getByRole("link", { name: /continue.*setup/i });
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toContain("/setup");
  });

  it("contains no apps.apple.com link in the rendered DOM", async () => {
    mockNativePlatform(false);

    const { default: GetTheAppPage } = await import(
      "@/app/get-the-app/page"
    );
    const { container } = render(<GetTheAppPage />);

    const allLinks = Array.from(
      container.querySelectorAll("a[href]")
    ) as HTMLAnchorElement[];
    const appStoreLinks = allLinks.filter((a) =>
      a.href.includes("apps.apple.com")
    );

    expect(
      appStoreLinks,
      "no direct App Store link may exist — motko.co.uk is the only route",
    ).toHaveLength(0);
  });

  it("does not instruct anyone to search the App Store", async () => {
    mockNativePlatform(false);

    const { default: GetTheAppPage } = await import(
      "@/app/get-the-app/page"
    );
    const { container } = render(<GetTheAppPage />);

    const text = container.textContent || "";
    const searchInstruction = /search (?:for )?["']?motko["']? (?:on|in) the app store/i;

    expect(
      searchInstruction.test(text),
      "a visitor who taps 'Download on the App Store' and lands on search results concludes the product is not real",
    ).toBe(false);
  });

  it("does not mention Google Play", async () => {
    mockNativePlatform(false);

    const { default: GetTheAppPage } = await import(
      "@/app/get-the-app/page"
    );
    const { container } = render(<GetTheAppPage />);

    const text = container.textContent || "";

    expect(
      /google play/i.test(text),
      "there is no Android product; naming Google Play promises something that does not exist",
    ).toBe(false);
  });
});

describe("the existing signup behaviour is intact", () => {
  it("does not break the referral field capture", async () => {
    // This is a smoke test. The full contract is held by
    // tests/regression/signup-referral-field.test.tsx, which must pass
    // unmodified. If that test fails after this item lands, this item has
    // broken existing behaviour.
    signUp.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    mockNativePlatform(false);
    // TEST23, not TEST123, and the difference is the whole test. A referral
    // code is six characters drawn from REFERRAL_CODE_ALPHABET
    // ("ABCDEFGHJKLMNPQRSTUVWXYZ23456789" — no 0/1/I/O, because these get read
    // aloud), so "TEST123" fails normalizeReferralCode twice over: seven
    // characters, and a "1" that is not in the alphabet. It normalises to null,
    // the field can never hold it, and the assertions below could not have been
    // satisfied by any implementation.
    //
    // Worse, the last assertion would have required an unparseable code to
    // reach the signup metadata, which tests/regression/signup-referral-field
    // forbids outright — losing a referral is recoverable, losing the signup is
    // not. The two contracts contradicted each other.
    window.history.replaceState({}, "", "/signup?ref=TEST23");

    const { default: SignupPage } = await import("@/app/signup/page");
    render(<SignupPage />);

    await waitFor(() => {
      const field = screen.getByLabelText(/Referral code/i) as HTMLInputElement;
      expect(field.value).toBe("TEST23");
    });

    fillAndSubmitSignup();

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
    const metadataCode = signUp.mock.calls[0]?.[0]?.options?.data?.referral_code;
    expect(metadataCode).toBe("TEST23");
  });
});

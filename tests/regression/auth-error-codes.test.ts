// A6 — distinct auth failures map to distinct codes, and no user-facing auth
// error is Supabase's own prose or a hardcoded literal at a call site.
//
// The property that matters beyond the mapping itself is the last one in this
// file: the signup surface must NOT gain a code for "that address already
// exists". Supabase deliberately does not report it (it returns a
// success-shaped response and sends no email), and surfacing it would hand an
// unauthenticated stranger an account-enumeration oracle — D8.

import { describe, expect, it } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/auth-js";
import { authErrorMessage, mapAuthError, type AuthErrorCode } from "@/lib/auth-errors";

describe("mapAuthError", () => {
  it("maps Supabase's own error codes", () => {
    const cases: [string, AuthErrorCode][] = [
      ["invalid_credentials", "invalid_credentials"],
      ["email_not_confirmed", "email_not_confirmed"],
      ["weak_password", "weak_password"],
      ["over_request_rate_limit", "rate_limited"],
      ["otp_expired", "otp_expired"],
      ["signup_disabled", "signup_disabled"],
      ["user_banned", "user_banned"],
    ];

    for (const [supabaseCode, expected] of cases) {
      const error = new AuthApiError("upstream prose", 400, supabaseCode);
      expect(mapAuthError(error).code, supabaseCode).toBe(expected);
    }
  });

  it("never passes the upstream message through", () => {
    const error = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(mapAuthError(error).message).not.toBe("Invalid login credentials");
    expect(mapAuthError(error).message).toBe(authErrorMessage("invalid_credentials"));
  });

  it("distinguishes a dead connection from a rejected credential", () => {
    expect(mapAuthError(new AuthRetryableFetchError("failed to fetch", 0).valueOf()).code).toBe(
      "network_unavailable",
    );
    expect(mapAuthError(new TypeError("Failed to fetch")).code).toBe("network_unavailable");
    expect(mapAuthError(new AuthApiError("nope", 400, "invalid_credentials")).code).toBe(
      "invalid_credentials",
    );
  });

  it("still recognises a failure that arrives without a code", () => {
    // Supabase omits `code` before a response is parsed, and no test double
    // ever sets one. Degrading straight to "unknown" there would make a
    // recognisable failure read as "something went wrong".
    expect(mapAuthError({ message: "Token has expired or is invalid" }).code).toBe("otp_expired");
    expect(mapAuthError({ message: "Email not confirmed" }).code).toBe("email_not_confirmed");
    expect(mapAuthError({ status: 429, message: "" }).code).toBe("rate_limited");
  });

  it("falls back to a code rather than a bare string for anything unrecognised", () => {
    const mapped = mapAuthError({ message: "something nobody has seen before" });
    expect(mapped.code).toBe("unknown");
    expect(mapped.message).toBe(authErrorMessage("unknown"));
  });

  it("gives every distinct failure mode a distinct message", () => {
    const codes: AuthErrorCode[] = [
      "invalid_credentials",
      "email_not_confirmed",
      "weak_password",
      "email_invalid",
      "rate_limited",
      "otp_expired",
      "otp_invalid",
      "signup_disabled",
      "user_banned",
      "session_expired",
      "network_unavailable",
      "unknown",
    ];
    const messages = codes.map(authErrorMessage);
    expect(new Set(messages).size).toBe(codes.length);
  });

  // D8. An address that already has an account must be indistinguishable from
  // one that does not, on every path a stranger can reach.
  it("does not expose an account-enumeration signal", () => {
    for (const supabaseCode of ["email_exists", "user_already_exists", "phone_exists"]) {
      const mapped = mapAuthError(new AuthApiError("upstream prose", 422, supabaseCode));
      expect(mapped.code, supabaseCode).toBe("unknown");
      expect(mapped.message).not.toMatch(/exist|already|registered|taken/i);
    }
  });
});

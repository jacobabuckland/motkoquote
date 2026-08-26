"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  captureReferralCode,
  forgetReferralCode,
} from "@/lib/referral-capture";
import { normalizeReferralCode } from "@/lib/referral";
import { clearGuestArtefact } from "@/lib/guest/session";
import { trackSignup } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Capture the code the moment the referee LANDS, not when they submit.
  // Reading it at submit meant it survived one page load and was lost by a
  // detour to /login, a reload, or — most often — creating the account inside
  // the iOS app, which loads motko.app and never sees the ?ref= at all.
  useEffect(() => {
    const captured = captureReferralCode(window.location.href);
    if (captured) {
      // Deliberate suppression, matching the pattern used in Disclosure and
      // the two voice intakes. The code lives on the URL and in localStorage,
      // neither of which exists during server rendering, so a lazy useState
      // initialiser would render "" on the server and the code on the client —
      // a hydration mismatch. Setting it after mount costs one extra render on
      // the signup screen, which is the trade being made.
      //
      // Narrowed to the one rule on purpose: a bare disable switches off every
      // rule on the line, permanently and invisibly.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReferralCode(captured);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setStatus("submitting");

    // Carry the code into user_metadata so it can be redeemed server-side when
    // the contractor row is first created (see provisionNewContractor).
    //
    // The field is the source of truth by this point: it is pre-filled from the
    // link on arrival, and a contractor who typed or corrected it should have
    // what they typed used. An unreadable entry is dropped rather than blocking
    // the signup — losing a referral is recoverable, losing the account is not.
    const submittedCode = normalizeReferralCode(referralCode);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        ...(submittedCode ? { data: { referral_code: submittedCode } } : {}),
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setStatus("error");
      return;
    }

    // Account created — record the signup (fire-and-forget, server-side so it's
    // attributed to the new session).
    void trackSignup();

    // Any pending guest quote is discarded silently at this point: an
    // account starts a fresh job. Nothing is imported and nothing is offered.
    clearGuestArtefact();

    // The code has been handed over. Drop it so a second person signing up on
    // this device is not silently attributed to the first person's referrer.
    forgetReferralCode();

    // If email confirmation is off, Supabase returns a session immediately —
    // otherwise the account exists but is unconfirmed until they click the
    // emailed link, which routes through /auth/confirm.
    if (data.session) {
      router.push("/get-app");
      router.refresh();
      return;
    }

    setStatus("sent");
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Create your account</h1>
        <p className="text-sm text-text-secondary mb-6">
          Set up Motko for your business in a couple of minutes.
        </p>

        {status === "sent" ? (
          <p className="text-sm">
            Check <strong>{email}</strong> to confirm your account, then sign
            in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              required
              placeholder="you@company.co.uk"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              enterKeyHint="next"
              required
              minLength={8}
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              enterKeyHint="go"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            {/* The code is documented as the source of truth and the link as
                its carrier (src/lib/referral.ts), but only the carrier had
                anywhere to land — there was no way to enter a code you were
                given verbally or in a message. normalizeReferralCode already
                upper-cases and strips spaces/hyphens, and the alphabet drops
                I/O/0/1 precisely because codes get read aloud, so the parsing
                for this has existed all along.

                Optional, and last: a referral is a bonus, not a requirement,
                and it must never look like one more thing standing between a
                trade and an account. */}
            <Input
              label="Referral code (optional)"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={12}
              placeholder="If a trade gave you one"
              value={referralCode}
              onChange={(event) => setReferralCode(event.target.value)}
            />
            <Button type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Creating account..." : "Create account"}
            </Button>
            {error && <p className="text-sm text-error">{error}</p>}
          </form>
        )}

        <p className="mt-6 text-sm text-text-secondary">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:text-accent-hover">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

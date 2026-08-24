"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { clearGuestArtefact } from "@/lib/guest/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "magic-link">("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The 6-digit code the sign-in email has always printed under "Or enter this
  // code instead:" — and which, until now, had nowhere to be typed.
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "verifying" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setError(null);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setStatus("error");
        return;
      }

      // A guest who signs in starts fresh: the pending guest artefact is
      // discarded silently, with no import offer and nothing kept.
      clearGuestArtefact();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      // A thrown error here (vs. a returned signInError) means the request
      // never completed — e.g. the WKWebView couldn't reach Supabase. Without
      // this, the promise rejects unhandled and the button hangs on
      // "Signing in..." with nothing shown to the user.
      setError(err instanceof Error ? err.message : "Couldn't sign in — try again.");
      setStatus("error");
    }
  };

  const handleMagicLinkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setError(null);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });

      if (signInError) {
        setError(signInError.message);
        setStatus("error");
        return;
      }

      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the link — try again.");
      setStatus("error");
    }
  };

  // The reliable half of email sign-in.
  //
  // The link is PKCE: @supabase/ssr forces flowType "pkce" and keeps the
  // code_verifier in a cookie on this origin, so a link requested here and
  // opened anywhere else — the iOS app's WKWebView and Safari do not share a
  // cookie jar — cannot be redeemed at all. It is also redeemed by a plain GET
  // on Supabase's /auth/v1/verify, so a mail security scanner that prefetches
  // links spends it before the human clicks.
  //
  // verifyOtp is neither. It is a POST that returns a session directly, with no
  // verifier involved at any point, so it works in any browser and a scanner
  // cannot type a code. That is why this is the fallback rather than a nicer
  // wrapper around the same link.
  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("verifying");
    setError(null);

    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });

      if (verifyError) {
        setError(verifyError.message);
        // Back to "sent", not "error": the code form must stay on screen with
        // what they typed still in it, so a mistyped digit is one edit away
        // rather than a fresh email.
        setStatus("sent");
        return;
      }

      // Same terms as the password path: a guest who signs in starts fresh.
      clearGuestArtefact();
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't check that code — try again.",
      );
      setStatus("sent");
    }
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Motko</h1>
        <p className="text-sm text-text-secondary mb-6">
          {mode === "password"
            ? "Sign in with your email and password."
            : "Sign in with your email — no password needed."}
        </p>

        {status === "sent" || status === "verifying" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              Check <strong>{email}</strong> for a sign-in link.
            </p>
            <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
              <Input
                label="Or enter the 6-digit code from the email"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                required
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button type="submit" disabled={status === "verifying"}>
                {status === "verifying" ? "Checking..." : "Sign in with code"}
              </Button>
              {error && <p className="text-sm text-error">{error}</p>}
            </form>
          </div>
        ) : mode === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
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
              autoComplete="current-password"
              enterKeyHint="go"
              required
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Signing in..." : "Sign in"}
            </Button>
            {error && <p className="text-sm text-error">{error}</p>}
            <Button
              type="button"
              variant="tertiary"
              className="self-start"
              onClick={() => {
                setMode("magic-link");
                setError(null);
              }}
            >
              Use an email link instead
            </Button>
          </form>
        ) : (
          <form onSubmit={handleMagicLinkSubmit} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending..." : "Send sign-in link"}
            </Button>
            {error && <p className="text-sm text-error">{error}</p>}
            <Button
              type="button"
              variant="tertiary"
              className="self-start"
              onClick={() => {
                setMode("password");
                setError(null);
              }}
            >
              Use a password instead
            </Button>
          </form>
        )}

        <p className="mt-6 text-sm text-text-secondary">
          New to Motko?{" "}
          <Link href="/signup" className="text-accent hover:text-accent-hover">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}

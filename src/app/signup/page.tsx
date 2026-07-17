"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

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

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setStatus("error");
      return;
    }

    // If email confirmation is off, Supabase returns a session immediately —
    // otherwise the account exists but is unconfirmed until they click the
    // emailed link, which routes through /auth/confirm.
    if (data.session) {
      router.push("/setup");
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

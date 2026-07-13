"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "magic-link">("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setError(null);

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

    router.push("/dashboard");
    router.refresh();
  };

  const handleMagicLinkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setError(null);

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

        {status === "sent" ? (
          <p className="text-sm">
            Check <strong>{email}</strong> for a sign-in link.
          </p>
        ) : mode === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              required
              placeholder="you@company.co.uk"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              label="Password"
              type="password"
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

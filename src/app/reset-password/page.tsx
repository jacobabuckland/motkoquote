"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Where a verified recovery code or link actually changes the password.
//
// Deliberately NOT a public route. Reaching it requires the session that
// verifying the recovery credential establishes, so the middleware's default
// deny is the guard — there is no check in this file to forget. Someone who
// lands here without one is redirected to /login, which is correct: they have
// not proved they own the address.
//
// It exists because verifying a recovery credential signs you in, and nothing
// more. Before this page, a recovery link would have been redeemed by
// /auth/confirm and dropped on /setup with a session and an unchanged
// password — the user believing they had reset it. That is worse than having
// no reset at all, which is what the product shipped with.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    // Same floor /signup enforces. A reset must not be the way to get a weaker
    // password than the account could have been created with.
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setStatus("saving");

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message);
        setStatus("idle");
        return;
      }

      // Settle on the terminal label before navigating, so a slow router can
      // never strand the button mid-spin.
      setStatus("saved");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save the new password — try again.",
      );
      setStatus("idle");
    }
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Set a new password</h1>
        <p className="text-sm text-text-secondary mb-6">
          Choose a new password for your Motko account.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="next"
            required
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="go"
            required
            placeholder="Type it again"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <Button type="submit" disabled={status !== "idle"}>
            {status === "saving"
              ? "Saving..."
              : status === "saved"
                ? "Saved ✓"
                : "Save new password"}
          </Button>
          {error && <p className="text-sm text-error">{error}</p>}
        </form>
      </div>
    </main>
  );
}

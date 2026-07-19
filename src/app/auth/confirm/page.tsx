"use client";

import { type EmailOtpType } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buttonClass } from "@/components/ui/button";

// Auth callback landing. Supabase can hand the confirmation back in three
// shapes, and one of them (the implicit flow) puts the tokens in the URL
// *hash* — which a server route can never read, because the fragment is never
// sent to the server. So this runs in the browser and handles all three:
//   1. Implicit flow: #access_token + #refresh_token  -> setSession
//   2. Custom template: ?token_hash + ?type           -> verifyOtp
//   3. PKCE flow: ?code                                -> exchangeCodeForSession
// On success we bounce to the post-auth destination; on failure we show the
// same "link expired" message the old /auth/error page did.
export default function ConfirmPage() {
  const router = useRouter();
  const [state, setState] = useState<"working" | "error">("working");

  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);
      const next = query.get("next") ?? "/setup";

      const done = () => {
        // Refresh so the middleware/server components pick up the freshly-set
        // auth cookies on the next navigation.
        router.replace(next);
        router.refresh();
      };

      // Supabase reports a rejected link via an error param (hash or query).
      const errorParam =
        hash.get("error") ??
        hash.get("error_code") ??
        query.get("error") ??
        query.get("error_code");
      if (errorParam) {
        setState("error");
        return;
      }

      // 1. Implicit flow — tokens in the hash.
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) return done();
        setState("error");
        return;
      }

      // 2. Custom {{ .TokenHash }} template.
      const tokenHash = query.get("token_hash");
      const type = query.get("type") as EmailOtpType | null;
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          type,
          token_hash: tokenHash,
        });
        if (!error) return done();
        setState("error");
        return;
      }

      // 3. PKCE flow — a `code` in the query. The browser client's
      // detectSessionInUrl may already have exchanged it, so check first.
      const code = query.get("code");
      if (code) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) return done();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) return done();
      }

      setState("error");
    };
    void run();
  }, [router]);

  if (state === "working") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-text-secondary">Signing you in…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Sign-in link expired</h1>
        <p className="text-sm text-text-secondary mb-2">
          That link is no longer valid. Request a new one.
        </p>
        <Link href="/login" className={buttonClass("primary")}>
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

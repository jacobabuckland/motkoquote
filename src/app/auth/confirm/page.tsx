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
// On success we bounce to the post-auth destination.
//
// On failure we say WHICH failure. This page used to render one fixed
// "Sign-in link expired" for all six failing conditions, including the two
// where the link was never used at all. That is not a copy nit: it told a user
// whose link failed because it opened in the wrong browser to request another
// one, which fails the same way every time, forever. It also cost a bug
// investigation its only piece of evidence — a screenshot of this page says
// nothing about what actually went wrong, because the page said the same thing
// regardless.
type Failure =
  // The provider rejected the credential: genuinely spent, genuinely expired,
  // or a token_hash it would not verify. The only branch where "expired" may
  // be the truth.
  | "link-rejected"
  // The credential was well-formed but could not be redeemed HERE. Almost
  // always a PKCE code_verifier that lives in a different browser's cookie
  // jar, because the link was requested in one browser and opened in another.
  | "wrong-browser"
  // Nothing to redeem: no hash tokens, no token_hash, no code. Usually a
  // bookmarked or hand-typed /auth/confirm.
  | "no-credential";

type State =
  | { status: "working" }
  | { status: "failed"; reason: Failure; code: string | null };

const COPY: Record<Failure, { heading: string; body: string }> = {
  "link-rejected": {
    heading: "Sign-in link expired",
    body: "That link is no longer valid. Request a new one.",
  },
  "wrong-browser": {
    // Deliberately does not say "expired", and deliberately does not stop at
    // "request a new one" — a new link opened the same way fails identically.
    // Says nothing about entering a code from the email: there is nowhere to
    // type one yet, and naming a control that does not exist is the failure
    // this screen is being fixed for.
    heading: "Couldn't finish signing you in here",
    body: "A sign-in link has to be opened in the same browser it was requested from. Request a new link from the browser you want to sign in on, and open it there.",
  },
  "no-credential": {
    heading: "Nothing to sign in with",
    body: "This page finishes a sign-in that started somewhere else. Head back and request a sign-in link.",
  },
};

export default function ConfirmPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "working" });

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

      const fail = (reason: Failure, code: string | null = null) =>
        setState({ status: "failed", reason, code });

      // Supabase reports a rejected link via an error param (hash or query).
      // The specific code is kept and shown: it is already in the user's own
      // address bar, and it is the difference between a spent link and a
      // rejected one when someone reads this screen back over the phone.
      const errorCode = hash.get("error_code") ?? query.get("error_code");
      const errorName = hash.get("error") ?? query.get("error");
      if (errorCode || errorName) {
        fail("link-rejected", errorCode ?? errorName);
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
        fail("link-rejected");
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
        fail("link-rejected");
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
        // The code was present and the exchange still failed. @supabase/ssr
        // forces flowType "pkce" and keeps the verifier in a cookie on the
        // origin, so the overwhelmingly common cause is that the link was
        // opened somewhere other than where it was requested.
        fail("wrong-browser");
        return;
      }

      fail("no-credential");
    };
    void run();
  }, [router]);

  if (state.status === "working") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-text-secondary">Signing you in…</p>
      </main>
    );
  }

  const { heading, body } = COPY[state.reason];

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-sm text-text-secondary mb-2">{body}</p>
        <Link href="/login" className={buttonClass("primary")}>
          Back to sign in
        </Link>
        {state.code && (
          <p className="mt-4 text-xs text-text-secondary">Error code: {state.code}</p>
        )}
      </div>
    </main>
  );
}

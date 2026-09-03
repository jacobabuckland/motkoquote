"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { track, logError } from "@/lib/analytics";

export const signOut = async () => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
};

// Called by the client signup flow once account creation succeeds. Runs
// server-side so `track` can attribute the event to the freshly-created
// session (set on the request cookies by supabase.auth.signUp).
export const trackSignup = async () => {
  await track("signed_up");
};

// Reports a refused realtime connect, from any of the four voice surfaces.
//
// A server action rather than a direct logError call: analytics.ts reaches for
// the server Supabase client, and every voice surface is a client component, so
// importing it there pulls server-only code into the browser bundle. Typecheck
// and the test suite both pass on that; only `next build` catches it. Mirrors
// reportVoicePipelineFailure, which exists for the same reason.
//
// Takes the ALREADY-CLASSIFIED failure, never the raw response body: the body
// can carry a key or a request payload, and none of that belongs in an events
// table. Classification is pure and happens client-side
// (classifyRealtimeConnectFailure).
export const reportRealtimeConnectFailure = async (input: {
  surface: string;
  status: number;
  code: string;
  retryable: boolean;
}): Promise<void> => {
  await logError("client", "realtime connect failed", { ...input });
};

// Reports a render-phase crash from any of the three error boundaries (global,
// route, or voice-intake). Called fire-and-forget from error boundary useEffect
// hooks so a failed report never blocks rendering.
//
// A server action for the same reason as reportRealtimeConnectFailure: analytics.ts
// reaches for the server Supabase client, and all three error boundaries are
// client components.
export const reportRenderError = async (input: {
  route: string;
  message: string;
  digest?: string;
  run_id?: string;
}): Promise<void> => {
  await logError("client", "render error", { ...input });
};

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";

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

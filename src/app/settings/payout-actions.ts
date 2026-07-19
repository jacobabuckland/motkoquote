"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createConnectAccount,
  createOnboardingLink,
  createExpressDashboardLink,
} from "@/lib/stripe";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Starts (or resumes) Stripe Connect Express onboarding for the signed-in
// tradesperson. Creates the connected account on first run and stores only its
// id against their contractor row — never any bank details — then returns a
// hosted Account Link. The client redirects the browser to this URL. Also used
// by the "Finish payout setup" banner: when an account already exists we just
// mint a fresh link.
export const startPayoutOnboarding = async (): Promise<{ url: string } | { error: string }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, stripe_account_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!contractor) return { error: "Finish setting up your business first." };

  let accountId = contractor.stripe_account_id as string | null;
  if (!accountId) {
    accountId = await createConnectAccount(user.email ?? undefined);
    if (!accountId) return { error: "Payments aren't configured yet." };
    await supabase
      .from("contractors")
      .update({ stripe_account_id: accountId })
      .eq("owner_user_id", user.id);
  }

  const url = await createOnboardingLink({
    accountId,
    refreshUrl: `${appUrl()}/settings/payouts/refresh`,
    returnUrl: `${appUrl()}/settings/payouts/return`,
  });
  if (!url) return { error: "Couldn't start payout setup. Try again." };

  return { url };
};

// One-time link into the tradesperson's Stripe Express dashboard so they can
// view their payouts. Returns null if they haven't onboarded yet.
export const getExpressDashboardUrl = async (): Promise<{ url: string } | { error: string }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: contractor } = await supabase
    .from("contractors")
    .select("stripe_account_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const accountId = contractor?.stripe_account_id as string | null | undefined;
  if (!accountId) return { error: "Set up payouts first." };

  const url = await createExpressDashboardLink(accountId);
  if (!url) return { error: "Couldn't open your Stripe dashboard. Try again." };

  return { url };
};

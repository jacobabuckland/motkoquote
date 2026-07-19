import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOnboardingLink } from "@/lib/stripe";

// Stripe hits this when a hosted onboarding link has expired before the
// tradesperson finished. We mint a fresh Account Link for the same account and
// redirect straight back into onboarding.
export const GET = async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { data: contractor } = await supabase
    .from("contractors")
    .select("stripe_account_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const accountId = contractor?.stripe_account_id as string | null | undefined;
  if (!accountId) return NextResponse.redirect(new URL("/settings", request.url));

  const base = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const url = await createOnboardingLink({
    accountId,
    refreshUrl: `${base}/settings/payouts/refresh`,
    returnUrl: `${base}/settings/payouts/return`,
  });

  return NextResponse.redirect(url ? new URL(url) : new URL("/settings", request.url));
};

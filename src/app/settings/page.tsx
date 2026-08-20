import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import { SettingsClient } from "./settings-client";
import { PayoutDetailsSection } from "./payout-details-section";
import { StripeConnectSection } from "./stripe-connect-section";
import { FeesStatementSection } from "./fees-statement-section";
import { ReferralSection } from "./referral-section";
import { DeleteAccount } from "./delete-account";
import { refreshAccountStatus } from "@/lib/stripe-connect";
import type { NotificationEvent } from "@/lib/schemas/notification";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: contractor }, { data: prefs }] = await Promise.all([
    supabase
      .from("contractors")
      .select(
        "id, company_name, purge_after, referral_code, payout_account_holder_name, payout_sort_code, payout_account_number, payout_details_complete, stripe_account_id, stripe_payouts_enabled, stripe_charges_enabled, stripe_requirements_due",
      )
      .eq("owner_user_id", user.id)
      .maybeSingle(),
    supabase
      .from("notification_preferences")
      .select("disabled_events")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const disabledEvents = (prefs?.disabled_events as NotificationEvent[] | null) ?? [];

  // Stripe Connect onboarding completes on Stripe's hosted page, out of band.
  // If the contractor has started onboarding but payouts aren't enabled yet,
  // refresh the status from Stripe API (fallback for delayed/dropped webhooks).
  if (
    contractor?.stripe_account_id &&
    contractor.stripe_payouts_enabled === false
  ) {
    try {
      await refreshAccountStatus(contractor.stripe_account_id);
    } catch (err) {
      // Best-effort refresh; silently continue if it fails
      console.error("Failed to refresh Stripe account status:", err);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader companyName={contractor?.company_name ?? "Motko"} onSignOut={signOut} />
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
          <div className="space-y-8">
            <PayoutDetailsSection
              initialHolderName={contractor?.payout_account_holder_name ?? ""}
              initialSortCode={contractor?.payout_sort_code ?? ""}
              initialAccountNumber={contractor?.payout_account_number ?? ""}
              complete={contractor?.payout_details_complete ?? false}
            />
            <StripeConnectSection
              stripeAccountId={contractor?.stripe_account_id ?? null}
              stripePayoutsEnabled={contractor?.stripe_payouts_enabled ?? false}
              stripeRequirementsDue={contractor?.stripe_requirements_due ?? false}
            />
            {contractor?.id && <FeesStatementSection contractorId={contractor.id} />}
            <ReferralSection
              referralCode={contractor?.referral_code ?? null}
              appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
            />
            <SettingsClient initialDisabledEvents={disabledEvents} />
            <DeleteAccount purgeAfter={contractor?.purge_after ?? null} />
          </div>
        </div>
      </main>
    </div>
  );
}

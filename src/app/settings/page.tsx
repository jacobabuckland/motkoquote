import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import { SettingsClient as NotificationsSection } from "./settings-client";
import { PayoutDetailsSection } from "./payout-details-section";
import { PayoutHistorySection } from "./payout-history-section";
import { StripeConnectSection } from "./stripe-connect-section";
import { FeesStatementSection } from "./fees-statement-section";
import { ReferralSection } from "./referral-section";
import { DeleteAccount } from "./delete-account";
import { SupportSection } from "./support-section";
import { refreshAccountStatus } from "@/lib/stripe-connect";
import type { NotificationEvent } from "@/lib/schemas/notification";
import { Disclosure } from "@/components/ui/disclosure";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: contractor }, { data: prefs }, { data: pushRows }, { data: payoutRows }] =
    await Promise.all([
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
      // Which devices are actually registered for push.
      //
      // Without this the Notifications section had no notion of its own state:
      // the button read "Enable notifications" before you granted permission and
      // "Enable notifications" after, and the only acknowledgement was a toast
      // that vanished in three seconds. A trade granted the OS permission,
      // watched the page not change, and reasonably concluded it had not worked.
      //
      // `platform` is what distinguishes the phone from the laptop — the rows are
      // per user_id across both, so an account-wide tick would be wrong on the
      // device being looked at.
      supabase
        .from("push_subscriptions")
        .select("platform")
        .eq("user_id", user.id),
      // The most recent payouts — the "deposited" half of the money story.
      //
      // Read by contractor via the RLS owner-read policy, so this returns
      // nothing until the contractor row resolves; that is correct, since a
      // trade with no contractor profile has no payouts either.
      supabase
        .from("contractor_payouts")
        .select("stripe_payout_id, amount_pennies, status, arrival_date, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const disabledEvents =
    (prefs?.disabled_events as NotificationEvent[] | null) ?? [];

  const registrations = ((pushRows ?? []) as { platform: string }[]).map(
    (r) => r.platform,
  );

  const payouts = (payoutRows ?? []) as {
    stripe_payout_id: string;
    amount_pennies: number;
    status: string;
    arrival_date: string | null;
    created_at: string;
  }[];

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
      <AppHeader
        companyName={contractor?.company_name ?? "Motko"}
        onSignOut={signOut}
      />
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
          <div className="space-y-8">
            {/* One section, two steps of one thing. These used to render as
                unlike objects — bank details inside a Disclosure, Stripe
                Connect as a bare always-open section directly below — so the
                screen showed a closed row and then an expanded block on the
                same subject, reading as two unrelated settings.

                They are not independent: the Stripe account is what pays out,
                the bank account is where it pays out to, and a trade with one
                and not the other is half set up.

                Ordered as a trade completes them: identity and capability
                first, then the destination.

                The id stays `payout-details`. It keeps the persisted
                open/closed key, so anyone who had this open stays open, and
                tests/acceptance/306.test.tsx requires the page to carry an id
                matching /payout/i.

                Burying an "Action required" behind a closed row is the one
                real cost of grouping, so the row itself carries it. Opening
                this by default instead would work, but #306 froze the closed
                default here as a literal and counts how many disclosures on
                the page declare one — that check reads the source text, so it
                sees prose as well as code. A marker on the collapsed row is
                the better answer regardless: it is visible without the trade
                expanding anything. */}
            <Disclosure
              id="payout-details"
              title={
                contractor?.stripe_requirements_due
                  ? "Getting paid — action required"
                  : "Getting paid"
              }
              defaultOpen={false}
            >
              <div className="space-y-6">
                <StripeConnectSection
                  stripeAccountId={contractor?.stripe_account_id ?? null}
                  stripePayoutsEnabled={
                    contractor?.stripe_payouts_enabled ?? false
                  }
                  stripeRequirementsDue={
                    contractor?.stripe_requirements_due ?? false
                  }
                />
                <PayoutDetailsSection
                  initialHolderName={
                    contractor?.payout_account_holder_name ?? ""
                  }
                  initialSortCode={contractor?.payout_sort_code ?? ""}
                  initialAccountNumber={contractor?.payout_account_number ?? ""}
                  complete={contractor?.payout_details_complete ?? false}
                />
              </div>
            </Disclosure>
            {contractor?.id && (
              <Disclosure
                id="fees"
                title="Motko fees"
                defaultOpen={true}
              >
                <FeesStatementSection contractorId={contractor.id} />
              </Disclosure>
            )}
            <Disclosure
              id="referral"
              title="Refer a trade"
              defaultOpen={true}
            >
              <ReferralSection
                referralCode={contractor?.referral_code ?? null}
                appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
              />
            </Disclosure>
            <NotificationsSection
              initialDisabledEvents={disabledEvents}
              initialRegistrations={registrations}
            />
            {/* Above the danger zone deliberately: someone who cannot make
                something work should find a way to ask before they find the
                way to delete their account. */}
            <Disclosure
              id="support"
              title="Need a hand?"
              defaultOpen={true}
            >
              <SupportSection />
            </Disclosure>
            <DeleteAccount purgeAfter={contractor?.purge_after ?? null} />
          </div>
        </div>
      </main>
    </div>
  );
}

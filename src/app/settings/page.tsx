import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import type { SubscriptionProjection } from "@/lib/subscription";
// Namespace import, deliberately, and it must stay this way.
//
// tests/acceptance/359.test.tsx locates the notifications section by searching
// this file for the component's exported name, then compares that position
// against the other sections' ids to assert page order. A NAMED import puts
// that name on this line -- before every section -- so the ordering assertion
// compares against the import statement instead of the usage, and fails.
// Importing the namespace keeps the name off this line, so the first occurrence
// is the usage below, which is what the test means.
//
// Note this comment avoids spelling the exported name for the same reason: the
// test matches raw source, prose included. #306 records the same trap, where a
// disclosure default written inside a comment was counted as code.
//
// It is inconsistent with the other imports here and QA has flagged it as such,
// correctly. The frozen contract requires it regardless -- do not "tidy" it
// back to a named import, because that test cannot be edited.
import * as settingsClientModule from "./settings-client";
import { PayoutDetailsSection } from "./payout-details-section";
import { PayoutHistorySection } from "./payout-history-section";
import { StripeConnectSection } from "./stripe-connect-section";
import { FeesStatementSection } from "./fees-statement-section";
import { ReferralSection } from "./referral-section";
import { DeleteAccount } from "./delete-account";
import { SupportSection } from "./support-section";
import { SubscriptionSection } from "./subscription-section";
import { refreshAccountStatus } from "@/lib/stripe-connect";
import type { NotificationEvent } from "@/lib/schemas/notification";
import { Disclosure } from "@/components/ui/disclosure";
import { cancelSubscription } from "./actions";

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
          "id, company_name, referral_code, payout_account_holder_name, payout_sort_code, payout_account_number, payout_details_complete, stripe_account_id, stripe_payouts_enabled, stripe_pay_by_bank_enabled, stripe_charges_enabled, stripe_requirements_due",
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

  // Fetch subscription projection for this contractor
  const contractorIdForSubscription = contractor ? contractor.id : null;
  const { data: subscriptionRow } = contractorIdForSubscription
    ? await supabase
        .from("subscription_projection")
        .select(
          "contractor_id, stripe_subscription_id, stripe_customer_id, subscription_status, trial_end, last_event_id, last_event_created",
        )
        .eq("contractor_id", contractorIdForSubscription)
        .maybeSingle()
    : { data: null };

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

  const subscription = (subscriptionRow as SubscriptionProjection | null) ?? null;

  // Server action wrapper to call cancelSubscription with the current contractor
  const handleCancelSubscription = async () => {
    "use server";
    const cid = contractor ? contractor.id : null;
    if (!cid) {
      return { success: false, error: "No contractor found" };
    }
    const supabase = await createClient();
    // Import Stripe on demand to avoid loading it in the client bundle
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: "2026-07-29.dahlia",
    });
    return cancelSubscription(supabase, stripe, cid);
  };

  // Starting a subscription from the app, which was not possible before.
  //
  // SUB-1 creates the subscription in `persistContractorSetup` and nowhere
  // else. That is fine for a trade signing up today and leaves NO RECOVERY for
  // anyone the silent creation missed — and it missed everyone: SUB-1 shipped
  // on 6 Sep, every contractor in production completed setup before it, and
  // `subscription_projection` is empty across the whole database. The section
  // read "No active subscription found" beside no way to get one.
  //
  // THE ERROR IS NOT SWALLOWED, and that is deliberate. Setup wraps the same
  // call in `catch { console.warn }`, which is why this has been failing
  // unseen: Buckland Plastering's Stripe CUSTOMER exists and its SUBSCRIPTION
  // does not, so `subscriptions.create` is throwing and nobody has ever read
  // the reason. Surfacing it here is the same move N4.1 made for push — the
  // person who can act on the failure gets told what it was.
  //
  // Idempotent through createSubscriptionForContractor: it returns any existing
  // projection row rather than creating a second subscription, and keys both
  // Stripe calls on the contractor id.
  const handleStartSubscription = async () => {
    "use server";
    const cid = contractor ? contractor.id : null;
    if (!cid) {
      return { success: false, error: "No contractor found" };
    }
    const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
    if (!priceId) {
      return {
        success: false,
        error: "Billing isn't configured on this environment yet.",
      };
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: "2026-07-29.dahlia",
    });
    try {
      const { createSubscriptionForContractor } = await import("@/lib/subscription");
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { revalidatePath } = await import("next/cache");
      await createSubscriptionForContractor(createAdminClient(), stripe, {
        contractorId: cid,
        email: user?.email ?? "",
        companyName: contractor?.company_name ?? "",
        priceId,
      });
      revalidatePath("/settings");
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Couldn't start the subscription.",
      };
    }
  };

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
                  stripePayByBankEnabled={
                    contractor?.stripe_pay_by_bank_enabled ?? false
                  }
                  stripeRequirementsDue={
                    contractor?.stripe_requirements_due ?? false
                  }
                  payoutAccountNumber={contractor?.payout_account_number ?? null}
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
            <Disclosure id="fees" title="Motko fees" defaultOpen={true}>
              {/* prettier-ignore -- tests/acceptance/334.test.tsx matches this
                  guard as literal source text ("contractor?.id && <FeesStatement…"),
                  so the guard and the component must stay adjacent on one line.
                  That is why the Disclosure wraps the guard rather than the other
                  way round: an outer guard puts the Disclosure between the two
                  halves of the literal and the frozen contract fails. */}
              {contractor?.id && <FeesStatementSection contractorId={contractor.id} />}
            </Disclosure>
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
            <Disclosure
              id="subscription"
              title="Subscription"
              defaultOpen={true}
            >
              <SubscriptionSection
                projection={subscription}
                currentPeriodEnd={null}
                onCancel={handleCancelSubscription}
                onStart={handleStartSubscription}
              />
            </Disclosure>
            <settingsClientModule.SettingsClient
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
            <DeleteAccount />
          </div>
        </div>
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/require-contractor";
import { refreshAccountStatus } from "@/lib/stripe-connect";
import { payoutSetupStep, type PayoutSetupStatus } from "@/lib/payout-setup-step";
import { AppHeader } from "@/components/ui/app-header";
import { signOut } from "../../actions";
import { PayoutStep } from "./payout-step";

const COLUMNS =
  "id, company_name, stripe_account_id, stripe_payouts_enabled, stripe_pay_by_bank_enabled, stripe_requirements_due";

type Contractor = PayoutSetupStatus & { id: string; company_name: string };

/**
 * The payout step — the last screen of setup, reached when the business form
 * (or the spoken interview) saves.
 *
 * It lives here rather than inside the setup form because a Stripe connected
 * account is created against a contractor id, and there is no contractor row
 * until the form has saved.
 */
export default async function SetupPayoutsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const contractor = await requireContractor<Contractor>(
    supabase,
    user.id,
    COLUMNS,
  );

  // Connect onboarding finishes on Stripe's hosted pages, out of band, and the
  // trade lands back here with the webhook possibly still in flight. Ask Stripe
  // directly before deciding anything — the alternative is showing someone who
  // has just finished the step they have just finished.
  //
  // RE-READ THE ROW AFTERWARDS. refreshAccountStatus writes through the admin
  // client and returns nothing, so the record fetched above is stale the
  // moment it lands. Deciding on the stale copy is what would produce the
  // loop, and it is the one thing this page must not do.
  let status: PayoutSetupStatus = contractor;

  if (contractor.stripe_account_id && payoutSetupStep(contractor) !== "submitted") {
    try {
      await refreshAccountStatus(contractor.stripe_account_id);
      const { data: fresh } = await supabase
        .from("contractors")
        .select(COLUMNS)
        .eq("id", contractor.id)
        .maybeSingle<Contractor>();
      if (fresh) {
        status = fresh;
      }
    } catch (error) {
      // Best-effort. A Stripe hiccup must not strand a trade on this step, and
      // the stale copy only ever errs toward showing the offer again.
      console.error("[setup/payouts] could not refresh Stripe account status", error);
    }
  }

  // Nothing left for the trade to do — either live, or submitted and waiting on
  // Stripe. Setup completion lands on the dashboard (CLAUDE.md, UI
  // conventions), and this is the return from Stripe as well as the re-entry
  // for anyone who has already done it.
  if (payoutSetupStep(status) === "submitted") {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <PayoutStep started={Boolean(status.stripe_account_id)} />
        </div>
      </main>
    </div>
  );
}

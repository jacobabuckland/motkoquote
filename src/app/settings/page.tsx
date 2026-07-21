import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import { SettingsClient } from "./settings-client";
import { PayoutDetailsSection } from "./payout-details-section";
import { ReferralSection } from "./referral-section";
import { DeleteAccount } from "./delete-account";
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
        "company_name, purge_after, referral_code, payout_account_holder_name, payout_sort_code, payout_account_number, payout_details_complete",
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

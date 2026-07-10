import { createClient } from "@/lib/supabase/server";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: merchants }, { data: contractor }] = await Promise.all([
    supabase.from("merchants").select("id, name").order("name"),
    user
      ? supabase
          .from("contractors")
          .select(
            "id, company_name, company_number, trade, vat_registered, vat_number, day_rate, overtime_rate, callout_min, travel_rate, markup_pct, branding",
          )
          .eq("owner_user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let teamMembers: { name: string; role: string | null; day_rate: number | null }[] = [];
  let merchantAccounts: { merchant_id: string; trade_discount_pct: number }[] = [];

  if (contractor) {
    const [{ data: team }, { data: accounts }] = await Promise.all([
      supabase
        .from("team_members")
        .select("name, role, day_rate")
        .eq("contractor_id", contractor.id),
      supabase
        .from("merchant_accounts")
        .select("merchant_id, trade_discount_pct")
        .eq("contractor_id", contractor.id),
    ]);
    teamMembers = team ?? [];
    merchantAccounts = accounts ?? [];
  }

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold mb-1">Set up your business</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Takes a few minutes. Update anytime in Settings.
        </p>
        <SetupForm
          merchants={merchants ?? []}
          initialContractor={contractor}
          initialTeamMembers={teamMembers}
          initialMerchantAccounts={merchantAccounts}
        />
      </div>
    </main>
  );
}

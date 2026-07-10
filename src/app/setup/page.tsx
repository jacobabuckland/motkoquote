import { createClient } from "@/lib/supabase/server";
import { SetupForm } from "./setup-form";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";

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
            "id, company_name, company_number, trade, vat_registered, vat_number, day_rate, overtime_rate, callout_min, travel_rate, markup_pct, branding, business_profile",
          )
          .eq("owner_user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let teamMembers: { name: string; role: string | null; day_rate: number | null }[] = [];
  let merchantAccounts: { merchant_id: string; trade_discount_pct: number }[] = [];
  let rateCards: {
    work_type: string;
    unit: string;
    rate_per_unit: number;
    complexity_notes: string | null;
  }[] = [];

  if (contractor) {
    const [{ data: team }, { data: accounts }, { data: cards }] = await Promise.all([
      supabase
        .from("team_members")
        .select("name, role, day_rate")
        .eq("contractor_id", contractor.id),
      supabase
        .from("merchant_accounts")
        .select("merchant_id, trade_discount_pct")
        .eq("contractor_id", contractor.id),
      supabase
        .from("rate_cards")
        .select("work_type, unit, rate_per_unit, complexity_notes")
        .eq("contractor_id", contractor.id),
    ]);
    teamMembers = team ?? [];
    merchantAccounts = accounts ?? [];
    rateCards = cards ?? [];
  }

  return (
    <div className="flex flex-1 flex-col">
      {contractor ? (
        <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      ) : (
        <header className="border-b border-border px-6 py-4">
          <span className="text-sm font-semibold">Motko</span>
        </header>
      )}
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <h1 className="mb-1 text-2xl font-semibold">Set up your business</h1>
          <p className="mb-6 text-sm text-text-secondary">
            Takes a few minutes. Update anytime in Settings.
          </p>
          <SetupForm
            merchants={merchants ?? []}
            initialContractor={contractor}
            initialTeamMembers={teamMembers}
            initialMerchantAccounts={merchantAccounts}
            initialRateCards={rateCards}
          />
        </div>
      </main>
    </div>
  );
}

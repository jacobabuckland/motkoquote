import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SetupForm } from "./setup-form";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import { buttonClass } from "@/components/ui/button";

type ValidationWarning = {
  field: "company_name" | "registered_address";
  stated: string;
  registered: string;
};

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
            "id, company_name, company_number, trade, vat_registered, vat_number, day_rate, half_day_rate, overtime_rate, callout_min, travel_rate, markup_pct, branding, business_profile",
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

  // Validate company number if present (best-effort, never blocks form rendering)
  let validationWarnings: ValidationWarning[] | undefined;
  const companyNumber = contractor?.company_number;
  const businessProfile = contractor?.business_profile as
    | { registered_address?: string }
    | null
    | undefined;

  if (companyNumber) {
    try {
      const { validateCompanyNumber } = await import("@/lib/companies-house");
      const data = await validateCompanyNumber({
        company_number: companyNumber,
        stated_name: contractor.company_name,
        stated_address: businessProfile?.registered_address,
      });

      const warnings: ValidationWarning[] = [];

      // Check for name mismatch
      if (data.name_mismatch) {
        warnings.push({
          field: "company_name",
          stated: data.stated_name ?? "",
          registered: data.registered_name,
        });
      }

      // Check for address mismatch
      const statedAddress = data.stated_address;
      const registeredAddress = data.registered_address;
      if (statedAddress && registeredAddress) {
        // Normalize both addresses for comparison (whitespace and casing)
        const normalizeAddress = (addr: string) =>
          addr.trim().replace(/\s+/g, " ").toLowerCase();

        if (normalizeAddress(statedAddress) !== normalizeAddress(registeredAddress)) {
          warnings.push({
            field: "registered_address",
            stated: statedAddress,
            registered: registeredAddress,
          });
        }
      }

      if (warnings.length > 0) {
        validationWarnings = warnings;
      }
    } catch (_error) {
      // Validation failed - log but don't block form rendering
      console.warn("[setup] company validation failed on page load", { companyNumber });
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {contractor ? (
        <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      ) : (
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <span className="text-sm font-semibold">Motko</span>
          {user && (
            <form action={signOut}>
              <button
                type="submit"
                className="text-sm text-text-secondary hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          )}
        </header>
      )}
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <h1 className="mb-1 text-2xl font-semibold">Set up your business</h1>
          <p className="mb-4 text-sm text-text-secondary">
            Takes a few minutes. These details fill in the quotes and contracts
            you send, and you can update any of them later in Settings.
          </p>
          <Link
            href="/setup/voice"
            className={buttonClass("secondary", "mb-6 w-full sm:w-auto")}
          >
            Set up by talking instead
          </Link>
          <SetupForm
            merchants={merchants ?? []}
            initialContractor={contractor}
            initialTeamMembers={teamMembers}
            initialMerchantAccounts={merchantAccounts}
            initialRateCards={rateCards}
            validationWarnings={validationWarnings}
          />
        </div>
      </main>
    </div>
  );
}

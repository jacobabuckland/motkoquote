"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveContractorSetup } from "./actions";
import type { CompaniesHouseResult } from "@/lib/companies-house";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import type { StructuredAddress } from "@/lib/schemas/address";

type Merchant = { id: string; name: string };
type TeamMember = { name: string; role: string | null; day_rate: number | null };
type MerchantAccount = { merchant_id: string; trade_discount_pct: number };
type RateCard = {
  work_type: string;
  unit: string;
  rate_per_unit: number | null;
  complexity_notes: string | null;
};

type BusinessProfile = {
  trading_name?: string;
  business_structure?: string;
  registered_address?: string;
  registered_address_components?: StructuredAddress;
  business_phone?: string;
  business_email?: string;
  certifications?: string;
  insurer_name?: string;
  public_liability_cover?: string;
  default_payment_terms?: string;
  payment_methods?: string;
  bank_details?: string;
  default_warranty_period?: string;
  governing_law?: string;
};

const EMPTY_BUSINESS_PROFILE: BusinessProfile = {};

type Contractor = {
  company_name: string;
  company_number: string | null;
  trade: string | null;
  vat_registered: boolean;
  vat_number: string | null;
  day_rate: number | null;
  overtime_rate: number | null;
  callout_min: number | null;
  travel_rate: number | null;
  markup_pct: number | null;
  branding: { logo_url?: string; brand_color?: string; footer_terms?: string };
  business_profile: BusinessProfile;
} | null;

type Props = {
  merchants: Merchant[];
  initialContractor: Contractor;
  initialTeamMembers: TeamMember[];
  initialMerchantAccounts: MerchantAccount[];
  initialRateCards: RateCard[];
};

export const SetupForm = ({
  merchants,
  initialContractor,
  initialTeamMembers,
  initialMerchantAccounts,
  initialRateCards,
}: Props) => {
  const [companyName, setCompanyName] = useState(
    initialContractor?.company_name ?? "",
  );
  const [companyNumber, setCompanyNumber] = useState(
    initialContractor?.company_number ?? "",
  );
  const [trade, setTrade] = useState(initialContractor?.trade ?? "");
  const [vatRegistered, setVatRegistered] = useState(
    initialContractor?.vat_registered ?? false,
  );
  const [vatNumber, setVatNumber] = useState(
    initialContractor?.vat_number ?? "",
  );
  const [dayRate, setDayRate] = useState(
    initialContractor?.day_rate?.toString() ?? "",
  );
  const [overtimeRate, setOvertimeRate] = useState(
    initialContractor?.overtime_rate?.toString() ?? "",
  );
  const [calloutMin, setCalloutMin] = useState(
    initialContractor?.callout_min?.toString() ?? "",
  );
  const [travelRate, setTravelRate] = useState(
    initialContractor?.travel_rate?.toString() ?? "",
  );
  const [markupPct, setMarkupPct] = useState(
    initialContractor?.markup_pct?.toString() ?? "",
  );
  const [brandColor, setBrandColor] = useState(
    initialContractor?.branding?.brand_color ?? "#111111",
  );
  const [footerTerms, setFooterTerms] = useState(
    initialContractor?.branding?.footer_terms ?? "",
  );

  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(
    initialContractor?.business_profile ?? EMPTY_BUSINESS_PROFILE,
  );
  const updateBusinessProfile = (patch: Partial<BusinessProfile>) =>
    setBusinessProfile((prev) => ({ ...prev, ...patch }));

  const [team, setTeam] = useState<TeamMember[]>(
    initialTeamMembers.length > 0
      ? initialTeamMembers
      : [{ name: "", role: "", day_rate: null }],
  );

  const [discounts, setDiscounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialMerchantAccounts.map((a) => [
        a.merchant_id,
        a.trade_discount_pct.toString(),
      ]),
    ),
  );
  const [selectedMerchants, setSelectedMerchants] = useState<Set<string>>(
    new Set(initialMerchantAccounts.map((a) => a.merchant_id)),
  );

  const [rateCards, setRateCards] = useState<RateCard[]>(
    initialRateCards.length > 0
      ? initialRateCards
      : [{ work_type: "", unit: "", rate_per_unit: null, complexity_notes: "" }],
  );

  const [chQuery, setChQuery] = useState("");
  const [chResults, setChResults] = useState<CompaniesHouseResult[]>([]);
  const [chSearching, setChSearching] = useState(false);
  const [chError, setChError] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const searchCompaniesHouse = async () => {
    if (chQuery.trim().length < 2) return;
    setChSearching(true);
    setChError(null);
    try {
      const res = await fetch(
        `/api/companies-house/search?q=${encodeURIComponent(chQuery)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setChResults(data.items);
    } catch (err) {
      setChError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setChSearching(false);
    }
  };

  const selectCompany = (result: CompaniesHouseResult) => {
    setCompanyName(result.title);
    setCompanyNumber(result.company_number);
    setChResults([]);
    setChQuery("");
  };

  const updateTeamMember = (index: number, patch: Partial<TeamMember>) => {
    setTeam((prev) =>
      prev.map((member, i) => (i === index ? { ...member, ...patch } : member)),
    );
  };

  const updateRateCard = (index: number, patch: Partial<RateCard>) => {
    setRateCards((prev) =>
      prev.map((card, i) => (i === index ? { ...card, ...patch } : card)),
    );
  };

  const toggleMerchant = (id: string) => {
    setSelectedMerchants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const payload = {
      company_name: companyName,
      company_number: companyNumber || undefined,
      trade: trade || undefined,
      vat_registered: vatRegistered,
      vat_number: vatRegistered ? vatNumber || undefined : undefined,
      day_rate: dayRate || undefined,
      overtime_rate: overtimeRate || undefined,
      callout_min: calloutMin || undefined,
      travel_rate: travelRate || undefined,
      markup_pct: markupPct || undefined,
      branding: {
        brand_color: brandColor || undefined,
        footer_terms: footerTerms || undefined,
      },
      business_profile: {
        trading_name: businessProfile.trading_name || undefined,
        business_structure: businessProfile.business_structure || undefined,
        registered_address: businessProfile.registered_address || undefined,
        registered_address_components: businessProfile.registered_address
          ? businessProfile.registered_address_components
          : undefined,
        business_phone: businessProfile.business_phone || undefined,
        business_email: businessProfile.business_email || undefined,
        certifications: businessProfile.certifications || undefined,
        insurer_name: businessProfile.insurer_name || undefined,
        public_liability_cover: businessProfile.public_liability_cover || undefined,
        default_payment_terms: businessProfile.default_payment_terms || undefined,
        payment_methods: businessProfile.payment_methods || undefined,
        bank_details: businessProfile.bank_details || undefined,
        default_warranty_period: businessProfile.default_warranty_period || undefined,
        governing_law: businessProfile.governing_law || undefined,
      },
      team_members: team
        .filter((member) => member.name.trim().length > 0)
        .map((member) => ({
          name: member.name,
          role: member.role || undefined,
          day_rate: member.day_rate ?? undefined,
        })),
      merchant_accounts: Array.from(selectedMerchants).map((merchant_id) => ({
        merchant_id,
        trade_discount_pct: discounts[merchant_id] || "0",
      })),
      rate_cards: rateCards
        .filter((card) => card.work_type.trim().length > 0 && card.unit.trim().length > 0)
        .map((card) => ({
          work_type: card.work_type,
          unit: card.unit,
          rate_per_unit: card.rate_per_unit ?? 0,
          complexity_notes: card.complexity_notes || undefined,
        })),
    };

    startTransition(async () => {
      try {
        await saveContractorSetup(payload);
      } catch (err) {
        // NEXT_REDIRECT is thrown by redirect() on success — rethrow it.
        if (
          err instanceof Error &&
          err.message === "NEXT_REDIRECT"
        ) {
          throw err;
        }
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't save your details — try again.",
        );
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Company
        </h2>
        <div className="flex gap-2">
          <input
            aria-label="Search Companies House"
            placeholder="Search Companies House"
            value={chQuery}
            onChange={(e) => setChQuery(e.target.value)}
            className="h-11 flex-1 rounded-control border border-border bg-surface px-3 text-sm"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={searchCompaniesHouse}
            disabled={chSearching}
          >
            {chSearching ? "Searching…" : "Search"}
          </Button>
        </div>
        {chError && <p className="text-sm text-error">{chError}</p>}
        {chResults.length > 0 && (
          <div className="divide-y divide-border rounded-card border border-border bg-surface text-sm">
            {chResults.map((result) => (
              <button
                key={result.company_number}
                type="button"
                onClick={() => selectCompany(result)}
                className="flex min-h-11 w-full items-center px-3 py-2 text-left hover:bg-surface-hover"
              >
                {result.title}{" "}
                <span className="ml-1 text-text-muted">#{result.company_number}</span>
              </button>
            ))}
          </div>
        )}

        <Input
          label="Company name"
          required
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
        <Input
          label="Company number"
          value={companyNumber}
          onChange={(e) => setCompanyNumber(e.target.value)}
        />
        <Input
          label="Trade"
          placeholder="e.g. Electrician"
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          VAT
        </h2>
        <Checkbox
          label="VAT registered"
          checked={vatRegistered}
          onChange={(e) => setVatRegistered(e.target.checked)}
        />
        {vatRegistered && (
          <Input
            label="VAT number"
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value)}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Rates
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Day rate (£)" value={dayRate} onChange={(e) => setDayRate(e.target.value)} />
          <Input
            label="Overtime/weekend rate (£)"
            value={overtimeRate}
            onChange={(e) => setOvertimeRate(e.target.value)}
          />
          <Input
            label="Minimum call-out (£)"
            value={calloutMin}
            onChange={(e) => setCalloutMin(e.target.value)}
          />
          <Input
            label="Travel charge (£)"
            value={travelRate}
            onChange={(e) => setTravelRate(e.target.value)}
          />
          <Input
            label="Materials markup (%)"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Team
        </h2>
        {team.map((member, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input
              label="Name"
              value={member.name}
              onChange={(e) => updateTeamMember(index, { name: e.target.value })}
            />
            <Input
              label="Role"
              value={member.role ?? ""}
              onChange={(e) => updateTeamMember(index, { role: e.target.value })}
            />
            <Input
              label="Day rate (£)"
              value={member.day_rate ?? ""}
              onChange={(e) =>
                updateTeamMember(index, {
                  day_rate: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </div>
        ))}
        <Button
          type="button"
          variant="quiet"
          className="self-start"
          onClick={() =>
            setTeam((prev) => [...prev, { name: "", role: "", day_rate: null }])
          }
        >
          + Add team member
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Rate cards
        </h2>
        <p className="text-sm text-text-secondary">
          Confirmed per-unit prices for common work, e.g. &ldquo;Rewire&rdquo; per &ldquo;circuit&rdquo;.
          Quotes use these instead of guessing whenever the work matches.
        </p>
        {rateCards.map((card, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <Input
              label="Work type"
              value={card.work_type}
              onChange={(e) => updateRateCard(index, { work_type: e.target.value })}
            />
            <Input
              label="Unit"
              placeholder="e.g. m2, circuit"
              value={card.unit}
              onChange={(e) => updateRateCard(index, { unit: e.target.value })}
            />
            <Input
              label="Rate per unit (£)"
              value={card.rate_per_unit ?? ""}
              onChange={(e) =>
                updateRateCard(index, {
                  rate_per_unit: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <Input
              label="Notes"
              placeholder="Optional"
              value={card.complexity_notes ?? ""}
              onChange={(e) => updateRateCard(index, { complexity_notes: e.target.value })}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="quiet"
          className="self-start"
          onClick={() =>
            setRateCards((prev) => [
              ...prev,
              { work_type: "", unit: "", rate_per_unit: null, complexity_notes: "" },
            ])
          }
        >
          + Add rate card
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Merchants &amp; trade discounts
        </h2>
        {merchants.map((merchant) => (
          <div key={merchant.id} className="flex items-center gap-3">
            <Checkbox
              label={merchant.name}
              checked={selectedMerchants.has(merchant.id)}
              onChange={() => toggleMerchant(merchant.id)}
            />
            {selectedMerchants.has(merchant.id) && (
              <input
                aria-label={`${merchant.name} trade discount %`}
                placeholder="Discount %"
                value={discounts[merchant.id] ?? ""}
                onChange={(e) =>
                  setDiscounts((prev) => ({
                    ...prev,
                    [merchant.id]: e.target.value,
                  }))
                }
                className="ml-auto h-11 w-28 rounded-control border border-border bg-surface px-3 text-sm"
              />
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Legal &amp; contract details
        </h2>
        <p className="text-sm text-text-secondary">
          Used to fill in the contracts you send customers — set once, reused on every job.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Trading name (if different)"
            value={businessProfile.trading_name ?? ""}
            onChange={(e) => updateBusinessProfile({ trading_name: e.target.value })}
          />
          <Input
            label="Business structure"
            placeholder="e.g. Sole trader, Limited company"
            value={businessProfile.business_structure ?? ""}
            onChange={(e) => updateBusinessProfile({ business_structure: e.target.value })}
          />
          <AddressAutocomplete
            label="Registered / business address"
            value={businessProfile.registered_address ?? ""}
            onChange={(address) =>
              updateBusinessProfile({
                registered_address: address.formatted,
                registered_address_components: address.formatted ? address : undefined,
              })
            }
          />
          <Input
            label="Business phone"
            value={businessProfile.business_phone ?? ""}
            onChange={(e) => updateBusinessProfile({ business_phone: e.target.value })}
          />
          <Input
            label="Business email"
            value={businessProfile.business_email ?? ""}
            onChange={(e) => updateBusinessProfile({ business_email: e.target.value })}
          />
          <Input
            label="Registrations / certifications"
            placeholder="e.g. Gas Safe 123456"
            value={businessProfile.certifications ?? ""}
            onChange={(e) => updateBusinessProfile({ certifications: e.target.value })}
          />
          <Input
            label="Public liability insurer"
            value={businessProfile.insurer_name ?? ""}
            onChange={(e) => updateBusinessProfile({ insurer_name: e.target.value })}
          />
          <Input
            label="Public liability cover"
            placeholder="e.g. £2,000,000"
            value={businessProfile.public_liability_cover ?? ""}
            onChange={(e) => updateBusinessProfile({ public_liability_cover: e.target.value })}
          />
          <Input
            label="Standard payment terms"
            placeholder="e.g. Payment due within 14 days"
            value={businessProfile.default_payment_terms ?? ""}
            onChange={(e) => updateBusinessProfile({ default_payment_terms: e.target.value })}
          />
          <Input
            label="Accepted payment methods"
            placeholder="e.g. Bank transfer, card"
            value={businessProfile.payment_methods ?? ""}
            onChange={(e) => updateBusinessProfile({ payment_methods: e.target.value })}
          />
          <Input
            label="Bank / payment details"
            value={businessProfile.bank_details ?? ""}
            onChange={(e) => updateBusinessProfile({ bank_details: e.target.value })}
          />
          <Input
            label="Standard workmanship guarantee"
            placeholder="e.g. 12 months"
            value={businessProfile.default_warranty_period ?? ""}
            onChange={(e) => updateBusinessProfile({ default_warranty_period: e.target.value })}
          />
          <Input
            label="Governing law"
            placeholder="England & Wales"
            value={businessProfile.governing_law ?? ""}
            onChange={(e) => updateBusinessProfile({ governing_law: e.target.value })}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Branding
        </h2>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-text-secondary">
          Brand colour
          <input
            type="color"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="h-11 w-16 rounded-control border border-border"
          />
        </label>
        <Textarea
          label="Quote footer terms"
          value={footerTerms}
          onChange={(e) => setFooterTerms(e.target.value)}
          rows={3}
        />
      </section>

      {error && <p className="text-sm text-error">{error}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
};

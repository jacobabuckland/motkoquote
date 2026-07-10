"use client";

import { useState, useTransition, type FormEvent } from "react";
import { saveContractorSetup } from "./actions";
import type { CompaniesHouseResult } from "@/lib/companies-house";

type Merchant = { id: string; name: string };
type TeamMember = { name: string; role: string | null; day_rate: number | null };
type MerchantAccount = { merchant_id: string; trade_discount_pct: number };

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
} | null;

type Props = {
  merchants: Merchant[];
  initialContractor: Contractor;
  initialTeamMembers: TeamMember[];
  initialMerchantAccounts: MerchantAccount[];
};

export const SetupForm = ({
  merchants,
  initialContractor,
  initialTeamMembers,
  initialMerchantAccounts,
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
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Company</h2>
        <div className="flex gap-2">
          <input
            placeholder="Search Companies House..."
            value={chQuery}
            onChange={(e) => setChQuery(e.target.value)}
            className="flex-1 border rounded-md px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={searchCompaniesHouse}
            disabled={chSearching}
            className="border rounded-md px-3 py-2 text-sm disabled:opacity-50"
          >
            {chSearching ? "Searching..." : "Search"}
          </button>
        </div>
        {chError && <p className="text-sm text-red-600">{chError}</p>}
        {chResults.length > 0 && (
          <ul className="border rounded-md divide-y text-sm">
            {chResults.map((result) => (
              <li key={result.company_number}>
                <button
                  type="button"
                  onClick={() => selectCompany(result)}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-50"
                >
                  {result.title}{" "}
                  <span className="text-neutral-400">
                    #{result.company_number}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="text-xs text-neutral-500">Company name</label>
        <input
          required
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm"
        />
        <label className="text-xs text-neutral-500">Company number</label>
        <input
          value={companyNumber}
          onChange={(e) => setCompanyNumber(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm"
        />
        <label className="text-xs text-neutral-500">Trade</label>
        <input
          placeholder="e.g. Electrician"
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm"
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">VAT</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={vatRegistered}
            onChange={(e) => setVatRegistered(e.target.checked)}
          />
          VAT registered
        </label>
        {vatRegistered && (
          <input
            placeholder="VAT number"
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Rates</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day rate (£)" value={dayRate} onChange={setDayRate} />
          <Field
            label="Overtime/weekend rate (£)"
            value={overtimeRate}
            onChange={setOvertimeRate}
          />
          <Field
            label="Minimum call-out (£)"
            value={calloutMin}
            onChange={setCalloutMin}
          />
          <Field
            label="Travel charge (£)"
            value={travelRate}
            onChange={setTravelRate}
          />
          <Field
            label="Materials markup (%)"
            value={markupPct}
            onChange={setMarkupPct}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Team</h2>
        {team.map((member, index) => (
          <div key={index} className="grid grid-cols-3 gap-2">
            <input
              placeholder="Name"
              value={member.name}
              onChange={(e) =>
                updateTeamMember(index, { name: e.target.value })
              }
              className="border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="Role"
              value={member.role ?? ""}
              onChange={(e) =>
                updateTeamMember(index, { role: e.target.value })
              }
              className="border rounded-md px-3 py-2 text-sm"
            />
            <input
              placeholder="Day rate (£)"
              value={member.day_rate ?? ""}
              onChange={(e) =>
                updateTeamMember(index, {
                  day_rate: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="border rounded-md px-3 py-2 text-sm"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setTeam((prev) => [...prev, { name: "", role: "", day_rate: null }])
          }
          className="text-sm underline self-start"
        >
          + Add team member
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Merchants & trade discounts</h2>
        {merchants.map((merchant) => (
          <div key={merchant.id} className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm flex-1">
              <input
                type="checkbox"
                checked={selectedMerchants.has(merchant.id)}
                onChange={() => toggleMerchant(merchant.id)}
              />
              {merchant.name}
            </label>
            {selectedMerchants.has(merchant.id) && (
              <input
                placeholder="Discount %"
                value={discounts[merchant.id] ?? ""}
                onChange={(e) =>
                  setDiscounts((prev) => ({
                    ...prev,
                    [merchant.id]: e.target.value,
                  }))
                }
                className="w-28 border rounded-md px-3 py-2 text-sm"
              />
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Branding</h2>
        <label className="text-xs text-neutral-500">Brand colour</label>
        <input
          type="color"
          value={brandColor}
          onChange={(e) => setBrandColor(e.target.value)}
          className="h-10 w-16 border rounded-md"
        />
        <label className="text-xs text-neutral-500">Quote footer terms</label>
        <textarea
          value={footerTerms}
          onChange={(e) => setFooterTerms(e.target.value)}
          rows={3}
          className="border rounded-md px-3 py-2 text-sm"
        />
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="bg-black text-white rounded-md px-4 py-2 text-sm disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
};

const Field = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <label className="flex flex-col gap-1 text-xs text-neutral-500">
    {label}
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border rounded-md px-3 py-2 text-sm text-black"
    />
  </label>
);

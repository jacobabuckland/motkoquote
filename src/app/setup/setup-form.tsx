"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { autosaveContractorSetup, saveContractorSetup } from "./actions";
import type { CompaniesHouseResult } from "@/lib/companies-house";
import { addressesMatch } from "@/lib/uk-address";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { LogoUpload } from "@/components/ui/logo-upload";
import { Disclosure } from "@/components/ui/disclosure";
import type { StructuredAddress } from "@/lib/schemas/address";
import { isValidVatNumber } from "@/lib/vat-number";

type Merchant = { id: string; name: string };
type TeamMember = {
  name: string;
  role: string | null;
  day_rate: number | null;
  cost_day_rate: number | null;
};
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
  default_warranty_period?: string;
  governing_law?: string;
};

const EMPTY_BUSINESS_PROFILE: BusinessProfile = {};

// Constrained option sets — free-text stored values that don't match fall
// back to the "Other" text input (see ConstrainedField), so no existing data
// is lost.
const BUSINESS_STRUCTURE_OPTIONS = [
  "Sole trader",
  "Limited company",
  "Partnership",
] as const;
const PAYMENT_TERMS_OPTIONS = [
  "On receipt",
  "7 days",
  "14 days",
  "30 days",
] as const;
const WARRANTY_OPTIONS = [
  "None",
  "3 months",
  "6 months",
  "12 months",
  "24 months",
] as const;
const GOVERNING_LAW_OPTIONS = [
  "England & Wales",
  "Scotland",
  "Northern Ireland",
] as const;

const controlClass =
  "h-11 rounded-control border border-border bg-surface px-3 text-sm text-foreground";

// £-prefixed currency field: numeric keypad on mobile, right-aligned value,
// defaults shown as placeholders (never written to the DB unless typed).
const MoneyInput = ({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  // Shown under the field. Earns its place where the LABEL cannot settle what
  // the number means — two rates per crew member being the case it was added
  // for, since "day rate" reads as either of them.
  hint?: string;
}) => {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <div className="flex h-11 items-center rounded-control border border-border bg-surface pl-3 pr-2 focus-within:border-primary">
        <span className="text-sm text-text-muted">£</span>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="ml-1 h-full w-full bg-transparent text-right text-sm tabular-nums text-foreground outline-none focus:shadow-none"
        />
      </div>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
};

// Select constrained to a known option set, with an "Other…" escape hatch that
// reveals a free-text input. A stored value not in the option set opens in
// "Other" mode pre-filled, so legacy free-text is preserved and editable.
const ConstrainedField = ({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => {
  const id = useId();
  const inOptions = options.includes(value);
  const [other, setOther] = useState(Boolean(value) && !inOptions);
  const selectValue = other ? "Other" : inOptions ? value : "";
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        <select
          id={id}
          value={selectValue}
          onChange={(e) => {
            if (e.target.value === "Other") {
              setOther(true);
              onChange("");
            } else {
              setOther(false);
              onChange(e.target.value);
            }
          }}
          className={controlClass}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="Other">Other…</option>
        </select>
      </label>
      {other && (
        <input
          aria-label={`${label} (other)`}
          placeholder="Type your own"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={controlClass}
        />
      )}
    </div>
  );
};

type Contractor = {
  company_name: string;
  company_number: string | null;
  trade: string | null;
  vat_registered: boolean;
  vat_number: string | null;
  day_rate: number | null;
  half_day_rate: number | null;
  overtime_rate: number | null;
  callout_min: number | null;
  travel_rate: number | null;
  markup_pct: number | null;
  branding: { logo_url?: string; brand_color?: string; footer_terms?: string };
  business_profile: BusinessProfile;
} | null;

type ValidationWarning = {
  field: "company_name" | "registered_address";
  stated: string;
  registered: string;
};

type Props = {
  merchants: Merchant[];
  initialContractor: Contractor;
  initialTeamMembers: TeamMember[];
  initialMerchantAccounts: MerchantAccount[];
  initialRateCards: RateCard[];
  validationWarnings?: ValidationWarning[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

export const SetupForm = ({
  merchants,
  initialContractor,
  initialTeamMembers,
  initialMerchantAccounts,
  initialRateCards,
  validationWarnings,
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
  const [halfDayRate, setHalfDayRate] = useState(
    initialContractor?.half_day_rate?.toString() ?? "",
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
  const [logoUrl, setLogoUrl] = useState<string | undefined>(
    initialContractor?.branding?.logo_url,
  );
  const [brandColor, setBrandColor] = useState(
    initialContractor?.branding?.brand_color ?? "#004225",
  );
  const [footerTerms, setFooterTerms] = useState(
    initialContractor?.branding?.footer_terms ?? "",
  );

  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(
    initialContractor?.business_profile ?? EMPTY_BUSINESS_PROFILE,
  );
  const updateBusinessProfile = (patch: Partial<BusinessProfile>) =>
    setBusinessProfile((prev) => ({ ...prev, ...patch }));

  // Derived, never a second piece of state. The Company section's sole-trader
  // checkbox and the Legal section's business-structure select write the same
  // field, so they cannot disagree — which is the whole reason this reads the
  // profile rather than holding a boolean of its own.
  const isSoleTrader = businessProfile.business_structure === "Sole trader";

  // No placeholder empty row — the "+ Add" ghost buttons are the only entry
  // point, and each added row carries its own remove control.
  const [team, setTeam] = useState<TeamMember[]>(initialTeamMembers);

  // KEPT, with no UI, and deliberately so. #700 removed the "Merchants & trade
  // discounts" section: nothing in the tree reads trade_discount_pct outside
  // this form, so it collected supplier data that reached no quote, contract,
  // invoice or fee.
  //
  // The STATE stays because persistContractorSetup deletes merchant_accounts
  // and re-inserts what the form sends. Dropping these would send an empty
  // array and WIPE the four rows four contractors had already entered. Loaded
  // from the database and handed straight back, the save is a no-op for them.
  //
  // Setters removed rather than left unused: nothing writes these now.
  const [discounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialMerchantAccounts.map((a) => [
        a.merchant_id,
        a.trade_discount_pct.toString(),
      ]),
    ),
  );
  const [selectedMerchants] = useState<Set<string>>(
    new Set(initialMerchantAccounts.map((a) => a.merchant_id)),
  );

  const [rateCards, setRateCards] = useState<RateCard[]>(initialRateCards);

  const [chQuery, setChQuery] = useState("");
  const [chResults, setChResults] = useState<CompaniesHouseResult[]>([]);
  const [chSearching, setChSearching] = useState(false);
  const [chError, setChError] = useState<string | null>(null);
  // Derived criterion 1: a contractor who types a company number can check it
  // exists, on demand. Separate state from the name search above — that finds a
  // company, this confirms one the contractor already has.
  const [numberChecking, setNumberChecking] = useState(false);
  const [numberCheckError, setNumberCheckError] = useState<string | null>(null);
  const [numberCheckResult, setNumberCheckResult] = useState<{
    registered_name?: string;
    registered_address?: string;
    warnings: ValidationWarning[];
  } | null>(null);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Doc-facing fields that end up on the contracts and quotes a customer
  // sees — a blank here means a broken legal document, so an explicit Save is
  // blocked until they're filled. The error surfaces only once the contractor
  // has tried to save, and clears itself as soon as they type, so it never
  // nags mid-entry. (Optional legal fields aren't here: a blank one just omits
  // its clause — see the passive note in the Legal section.)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const requiredError = (value: string) =>
    attemptedSubmit && !value.trim()
      ? "Required — this appears on the contracts and quotes you send."
      : undefined;
  const requiredFieldsMissing =
    !companyName.trim() ||
    !trade.trim() ||
    !(businessProfile.registered_address ?? "").trim() ||
    !(businessProfile.business_phone ?? "").trim();

  // A VAT number that isn't one is worse than none at all: it prints on every
  // quote, SoW and contract the customer sees. Only checked when the trade has
  // ticked "VAT registered" AND typed something — leaving it blank is a
  // different (and legitimate) state, handled by the documents omitting the
  // line. Surfaces on save like the required-field errors, not mid-keystroke.
  const vatNumberInvalid = vatRegistered && vatNumber.trim().length > 0 && !isValidVatNumber(vatNumber);
  const vatNumberError =
    attemptedSubmit && vatNumberInvalid
      ? "That doesn't look like a valid UK VAT number — check you've typed it correctly."
      : undefined;

  const buildPayload = () => ({
    company_name: companyName,
    company_number: companyNumber || undefined,
    trade: trade || undefined,
    vat_registered: vatRegistered,
    vat_number: vatRegistered ? vatNumber || undefined : undefined,
    day_rate: dayRate || undefined,
    half_day_rate: halfDayRate || undefined,
    overtime_rate: overtimeRate || undefined,
    callout_min: calloutMin || undefined,
    travel_rate: travelRate || undefined,
    markup_pct: markupPct || undefined,
    branding: {
      logo_url: logoUrl || undefined,
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
      public_liability_cover:
        businessProfile.public_liability_cover || undefined,
      default_payment_terms: businessProfile.default_payment_terms || undefined,
      default_warranty_period:
        businessProfile.default_warranty_period || undefined,
      governing_law: businessProfile.governing_law || undefined,
    },
    team_members: team
      .filter((member) => member.name.trim().length > 0)
      .map((member) => ({
        name: member.name,
        role: member.role || undefined,
        day_rate: member.day_rate ?? undefined,
        cost_day_rate: member.cost_day_rate ?? undefined,
      })),
    merchant_accounts: Array.from(selectedMerchants).map((merchant_id) => ({
      merchant_id,
      trade_discount_pct: discounts[merchant_id] || "0",
    })),
    rate_cards: rateCards
      .filter(
        (card) =>
          card.work_type.trim().length > 0 && card.unit.trim().length > 0,
      )
      .map((card) => ({
        work_type: card.work_type,
        unit: card.unit,
        rate_per_unit: card.rate_per_unit ?? 0,
        complexity_notes: card.complexity_notes || undefined,
      })),
  });

  // Debounced background autosave. Reuses the same validated payload the
  // explicit Save submits, so no section can be lost by navigating away. Only
  // fires once a company name exists (required at the DB level). Saves are
  // serialised (inFlight guard) so overlapping requests can't interleave the
  // delete-then-reinsert of team / merchant / rate-card rows.
  const payload = buildPayload();
  const serialized = JSON.stringify(payload);
  const payloadRef = useRef(payload);
  useEffect(() => {
    payloadRef.current = payload;
  });
  const firstRender = useRef(true);
  const inFlight = useRef(false);
  const rerun = useRef(false);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!payloadRef.current.company_name.trim()) return;

    const runAutosave = async () => {
      if (inFlight.current) {
        rerun.current = true;
        return;
      }
      inFlight.current = true;
      setSaveState("saving");
      try {
        await autosaveContractorSetup(payloadRef.current);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      } finally {
        inFlight.current = false;
        if (rerun.current) {
          rerun.current = false;
          void runAutosave();
        }
      }
    };

    const handle = setTimeout(() => void runAutosave(), 900);
    return () => clearTimeout(handle);
  }, [serialized]);

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

  // Goes over HTTP to the route rather than importing the lookup directly:
  // this is a client component, and companies-house.ts reads
  // COMPANIES_HOUSE_API_KEY. Importing it here would either fail the build or
  // ship the key to the browser, which is what the route exists to prevent.
  const checkCompanyNumber = async () => {
    const number = companyNumber.trim();
    if (!number) return;
    setNumberChecking(true);
    setNumberCheckError(null);
    setNumberCheckResult(null);
    try {
      const res = await fetch("/api/companies-house/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_number: number,
          stated_name: companyName || undefined,
          stated_address: businessProfile.registered_address || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't check that number");

      // Same mismatch shape the automatic cross-check produces, so both paths
      // render through the one warning block below.
      const warnings: ValidationWarning[] = [];
      if (data.name_mismatch && companyName && data.registered_name) {
        warnings.push({
          field: "company_name",
          stated: companyName,
          registered: data.registered_name,
        });
      }
      if (
        businessProfile.registered_address &&
        data.registered_address &&
        !addressesMatch(businessProfile.registered_address, data.registered_address)
      ) {
        warnings.push({
          field: "registered_address",
          stated: businessProfile.registered_address,
          registered: data.registered_address,
        });
      }

      setNumberCheckResult({
        registered_name: data.registered_name,
        registered_address: data.registered_address,
        warnings,
      });
    } catch (err) {
      // Criterion 5: a failed lookup never blocks the form.
      setNumberCheckError(
        err instanceof Error ? err.message : "Couldn't check that number",
      );
    } finally {
      setNumberChecking(false);
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

  const removeTeamMember = (index: number) => {
    setTeam((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRateCard = (index: number, patch: Partial<RateCard>) => {
    setRateCards((prev) =>
      prev.map((card, i) => (i === index ? { ...card, ...patch } : card)),
    );
  };

  const removeRateCard = (index: number) => {
    setRateCards((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setAttemptedSubmit(true);

    if (requiredFieldsMissing) {
      setError("Add the required details above before saving.");
      return;
    }

    if (vatNumberInvalid) {
      setError("Check the VAT number before saving — it appears on every document you send.");
      return;
    }

    startTransition(async () => {
      try {
        await saveContractorSetup(buildPayload());
      } catch (err) {
        // NEXT_REDIRECT is thrown by redirect() on success — rethrow it.
        if (err instanceof Error && err.message === "NEXT_REDIRECT") {
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
      <p className="text-xs text-text-muted">
        Your details save automatically as you go.
      </p>

      <Disclosure id="setup-company" title="Company" defaultOpen={false}>
        <section className="flex flex-col gap-3">
          <h2 className="sr-only">Company</h2>

          {/* MOST UK TRADESPEOPLE ARE SOLE TRADERS, and this section was built
              for the minority who are not.

              "Sole trader" was already an option — in BUSINESS_STRUCTURE_OPTIONS,
              rendered by the Legal & contract details section, which comes AFTER
              this one. So a sole trader met a Companies House search and a
              company number field first, was asked for two things that do not
              exist for them, and only later reached the control that says they
              haven't got them. Nothing keyed off it either, so declaring it
              changed nothing here.

              Bound to the SAME businessProfile.business_structure the Legal
              select writes — one value, asked where it actually matters. The
              two controls stay in step because they are the same state, not two
              copies of it. */}
          <Checkbox
            label="I'm a sole trader"
            checked={isSoleTrader}
            onChange={(e) => {
              if (e.target.checked) {
                updateBusinessProfile({ business_structure: "Sole trader" });
                // A sole trader has no company number, and a stale one would be
                // printed on their contracts — the templates emit it whenever
                // it is present. Clearing is the honest end of that.
                setCompanyNumber("");
                setNumberCheckResult(null);
                setNumberCheckError(null);
              } else {
                updateBusinessProfile({ business_structure: "" });
              }
            }}
          />
          {isSoleTrader && (
            <p className="text-sm text-text-secondary">
              No company number needed. Your business name goes on your quotes
              and contracts — usually your own name, or the name you trade under.
            </p>
          )}

          {!isSoleTrader && (
          <>
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
                  <span className="ml-1 text-text-muted">
                    #{result.company_number}
                  </span>
                </button>
              ))}
            </div>
          )}
          </>
          )}

          {!isSoleTrader && validationWarnings && validationWarnings.length > 0 && (
            <div className="rounded-card border border-warning bg-warning-bg p-3">
              <h3 className="mb-2 text-sm font-medium text-warning">
                Company details mismatch
              </h3>
              <div className="flex flex-col gap-2 text-sm">
                {validationWarnings.map((warning, idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <p className="font-medium text-warning">
                      {warning.field === "company_name"
                        ? "Company name differs:"
                        : "Registered address differs:"}
                    </p>
                    <p className="text-foreground">
                      <span className="text-text-muted">Stated:</span> {warning.stated}
                    </p>
                    <p className="text-foreground">
                      <span className="text-text-muted">Registered:</span> {warning.registered}
                    </p>
                  </div>
                ))}
                <p className="mt-1 text-xs text-text-secondary">
                  Please review and update your details to match what&rsquo;s registered at
                  Companies House, or keep your stated values if they&rsquo;re a trading name or
                  alternative address.
                </p>
              </div>
            </div>
          )}

          <Input
            label="Company name"
            required
            error={requiredError(companyName)}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          {!isSoleTrader && (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Company number"
                  value={companyNumber}
                  onChange={(e) => {
                    setCompanyNumber(e.target.value);
                    setNumberCheckResult(null);
                    setNumberCheckError(null);
                  }}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={checkCompanyNumber}
                disabled={numberChecking || !companyNumber.trim()}
              >
                {numberChecking ? "Checking…" : "Check"}
              </Button>
            </div>

            {numberCheckError && (
              <p className="text-sm text-error">{numberCheckError}</p>
            )}

            {numberCheckResult && numberCheckResult.warnings.length === 0 && (
              <p className="text-sm text-text-secondary">
                Found at Companies House:{" "}
                <span className="text-foreground">
                  {numberCheckResult.registered_name}
                </span>
                {numberCheckResult.registered_address
                  ? ` — ${numberCheckResult.registered_address}`
                  : ""}
              </p>
            )}

            {numberCheckResult && numberCheckResult.warnings.length > 0 && (
              <div className="rounded-card border border-warning bg-warning-bg p-3 text-sm">
                <p className="mb-2 font-medium text-warning">
                  Company details mismatch
                </p>
                <div className="flex flex-col gap-2">
                  {numberCheckResult.warnings.map((warning, idx) => (
                    <div key={idx} className="flex flex-col gap-1">
                      <p className="font-medium text-warning">
                        {warning.field === "company_name"
                          ? "Company name differs:"
                          : "Registered address differs:"}
                      </p>
                      <p className="text-foreground">
                        <span className="text-text-muted">Yours:</span> {warning.stated}
                      </p>
                      <p className="text-foreground">
                        <span className="text-text-muted">Registered:</span>{" "}
                        {warning.registered}
                      </p>
                    </div>
                  ))}
                  <p className="text-xs text-text-secondary">
                    Update your details to match what&rsquo;s registered, or keep yours
                    if they&rsquo;re a trading name or alternative address.
                  </p>
                </div>
              </div>
            )}
          </div>
          )}
          <Input
            label="Trade"
            placeholder="e.g. Electrician"
            error={requiredError(trade)}
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
              error={vatNumberError}
              hint="GB followed by 9 digits, e.g. GB123456789"
            />
          )}
        </section>
      </Disclosure>

      <Disclosure id="setup-rates" title="Rates" defaultOpen={false}>
        <section className="flex flex-col gap-3">
          <h2 className="sr-only">Rates</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyInput
              label="Day rate"
              value={dayRate}
              onChange={setDayRate}
              placeholder="e.g. 300"
            />
            {/* Half-day was previously editable ONLY on the Settings copy of
                this form, so the two screens showed different fields for the
                same six columns — which is what made having two of them
                confusing rather than merely redundant. Rates live here now and
                Settings points at this section, so this is the only form that
                can set it and it has to be complete. */}
            <MoneyInput
              label="Half-day rate"
              value={halfDayRate}
              onChange={setHalfDayRate}
              placeholder="Leave blank if you don't do half days"
            />
            <MoneyInput
              label="Overtime / weekend rate"
              value={overtimeRate}
              onChange={setOvertimeRate}
              placeholder="e.g. 45"
            />
            <MoneyInput
              label="Minimum call-out"
              value={calloutMin}
              onChange={setCalloutMin}
              placeholder="e.g. 80"
            />
            <MoneyInput
              label="Travel charge"
              value={travelRate}
              onChange={setTravelRate}
              placeholder="e.g. 0.45"
            />
            <Input
              label="Materials markup (%)"
              inputMode="decimal"
              className="text-right tabular-nums"
              placeholder="e.g. 15"
              value={markupPct}
              onChange={(e) => setMarkupPct(e.target.value)}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Rate cards
          </h2>
          <p className="text-sm text-text-secondary">
            Confirmed per-unit prices for common work, e.g. &ldquo;Rewire&rdquo;
            per &ldquo;circuit&rdquo;. Quotes use these instead of guessing
            whenever the work matches.
          </p>
          {rateCards.map((card, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">
                  Rate card {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeRateCard(index)}
                  className="text-xs text-text-secondary hover:text-error"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <Input
                  label="Work type"
                  value={card.work_type}
                  onChange={(e) =>
                    updateRateCard(index, { work_type: e.target.value })
                  }
                />
                <Input
                  label="Unit"
                  placeholder="e.g. m2, circuit"
                  value={card.unit}
                  onChange={(e) =>
                    updateRateCard(index, { unit: e.target.value })
                  }
                />
                <MoneyInput
                  label="Rate per unit"
                  value={card.rate_per_unit?.toString() ?? ""}
                  onChange={(v) =>
                    updateRateCard(index, {
                      rate_per_unit: v ? Number(v) : null,
                    })
                  }
                />
                <Input
                  label="Notes"
                  placeholder="Optional"
                  value={card.complexity_notes ?? ""}
                  onChange={(e) =>
                    updateRateCard(index, { complexity_notes: e.target.value })
                  }
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="tertiary"
            className="self-start"
            onClick={() =>
              setRateCards((prev) => [
                ...prev,
                {
                  work_type: "",
                  unit: "",
                  rate_per_unit: null,
                  complexity_notes: "",
                },
              ])
            }
          >
            + Add rate card
          </Button>
        </section>
      </Disclosure>

      <Disclosure id="setup-team" title="Team" defaultOpen={false}>
        <section className="flex flex-col gap-3">
          <h2 className="sr-only">Team</h2>
          {team.map((member, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">
                  Team member {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeTeamMember(index)}
                  className="text-xs text-text-secondary hover:text-error"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  label="Name"
                  value={member.name}
                  onChange={(e) =>
                    updateTeamMember(index, { name: e.target.value })
                  }
                />
                <Input
                  label="Role"
                  value={member.role ?? ""}
                  onChange={(e) =>
                    updateTeamMember(index, { role: e.target.value })
                  }
                />
                {/* TWO rates, because they are two different numbers and only
                    one of them was ever on file. "Day rate" prices this person
                    on the customer's quote; "Costs you" is what leaving the yard
                    with them actually costs, and it is what the money card
                    counts as a cost. Left blank, their days are not costed at
                    all — the card names them rather than guessing a wage. */}
                <MoneyInput
                  label="Day rate (charged)"
                  value={member.day_rate?.toString() ?? ""}
                  onChange={(v) =>
                    updateTeamMember(index, {
                      day_rate: v ? Number(v) : null,
                    })
                  }
                  hint="What the customer pays for them per day"
                />
                <MoneyInput
                  label="Costs you"
                  value={member.cost_day_rate?.toString() ?? ""}
                  onChange={(v) =>
                    updateTeamMember(index, {
                      cost_day_rate: v ? Number(v) : null,
                    })
                  }
                  hint="Their wage per day. Leave blank and their days aren't costed."
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="tertiary"
            className="self-start"
            onClick={() =>
              setTeam((prev) => [
                ...prev,
                { name: "", role: "", day_rate: null, cost_day_rate: null },
              ])
            }
          >
            + Add team member
          </Button>
        </section>
      </Disclosure>

      <Disclosure
        id="setup-legal"
        // The dashboard's business-profile warning links here BY NAME, so this
        // title and SETUP_LEGAL_SECTION_TITLE must agree. It is a literal
        // rather than that constant because tests/acceptance/309.test.tsx
        // matches `title="Legal` in this file's source and is frozen — which
        // is also what stops the two drifting: the title cannot change here
        // without failing that test.
        title="Legal & contract details"
        defaultOpen={false}
      >
        <section className="flex flex-col gap-3">
          <h2 className="sr-only">Legal & contract details</h2>
          <p className="text-sm text-text-secondary">
            Used to fill in the contracts you send customers — set once, reused
            on every job.
          </p>
          <p className="text-xs text-text-muted">
            Leave any optional field blank and that clause simply won&rsquo;t
            appear on your contracts.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Trading name (if different)"
              value={businessProfile.trading_name ?? ""}
              onChange={(e) =>
                updateBusinessProfile({ trading_name: e.target.value })
              }
            />
            <ConstrainedField
              label="Business structure"
              options={BUSINESS_STRUCTURE_OPTIONS}
              value={businessProfile.business_structure ?? ""}
              onChange={(v) => updateBusinessProfile({ business_structure: v })}
            />
            <AddressAutocomplete
              label="Registered / business address"
              error={requiredError(businessProfile.registered_address ?? "")}
              value={businessProfile.registered_address ?? ""}
              onChange={(address) =>
                updateBusinessProfile({
                  registered_address: address.formatted,
                  registered_address_components: address.formatted
                    ? address
                    : undefined,
                })
              }
            />
            <Input
              label="Business phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              error={requiredError(businessProfile.business_phone ?? "")}
              value={businessProfile.business_phone ?? ""}
              onChange={(e) =>
                updateBusinessProfile({ business_phone: e.target.value })
              }
            />
            <Input
              label="Business email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={businessProfile.business_email ?? ""}
              onChange={(e) =>
                updateBusinessProfile({ business_email: e.target.value })
              }
            />
            <Input
              label="Registrations / certifications"
              placeholder="e.g. Gas Safe 123456"
              value={businessProfile.certifications ?? ""}
              onChange={(e) =>
                updateBusinessProfile({ certifications: e.target.value })
              }
            />
            <Input
              label="Public liability insurer"
              value={businessProfile.insurer_name ?? ""}
              onChange={(e) =>
                updateBusinessProfile({ insurer_name: e.target.value })
              }
            />
            <Input
              label="Public liability cover"
              placeholder="e.g. £2,000,000"
              value={businessProfile.public_liability_cover ?? ""}
              onChange={(e) =>
                updateBusinessProfile({
                  public_liability_cover: e.target.value,
                })
              }
            />
            <ConstrainedField
              label="Standard payment terms"
              options={PAYMENT_TERMS_OPTIONS}
              value={businessProfile.default_payment_terms ?? ""}
              onChange={(v) =>
                updateBusinessProfile({ default_payment_terms: v })
              }
            />
            <ConstrainedField
              label="Standard workmanship guarantee"
              options={WARRANTY_OPTIONS}
              value={businessProfile.default_warranty_period ?? ""}
              onChange={(v) =>
                updateBusinessProfile({ default_warranty_period: v })
              }
            />
            <ConstrainedField
              label="Governing law"
              options={GOVERNING_LAW_OPTIONS}
              value={businessProfile.governing_law ?? ""}
              onChange={(v) => updateBusinessProfile({ governing_law: v })}
            />
          </div>
        </section>
      </Disclosure>

      <Disclosure id="setup-branding" title="Branding" defaultOpen={false}>
        <section className="flex flex-col gap-3">
          <h2 className="sr-only">Branding</h2>
          <LogoUpload value={logoUrl} onChange={setLogoUrl} />
          <label className="flex flex-col gap-1.5 text-xs font-medium text-text-secondary">
            Brand colour
            <span className="font-normal text-text-muted">
              Used on your quotes and invoices
            </span>
            <span className="mt-1 inline-flex items-center gap-3">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-11 w-16 cursor-pointer rounded-control border border-border"
              />
              <span className="text-sm tabular-nums text-foreground">
                {brandColor.toUpperCase()}
              </span>
            </span>
          </label>
          <Textarea
            label="Quote footer terms"
            value={footerTerms}
            onChange={(e) => setFooterTerms(e.target.value)}
            rows={3}
            className="resize-y"
          />
        </section>
      </Disclosure>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save details"}
        </Button>
        {saveState === "saving" && (
          <span className="text-xs text-text-muted">Saving…</span>
        )}
        {saveState === "saved" && (
          <span className="text-xs text-success">Saved</span>
        )}
        {saveState === "error" && (
          <span className="text-xs text-error">
            Couldn&rsquo;t autosave — your changes are still here; use Save
            details.
          </span>
        )}
      </div>
    </form>
  );
};

export default SetupForm;

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineLink } from "@/components/ui/inline-link";
import { ShareLinkButton } from "@/components/ui/share-link-button";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import type { ContractTemplateKey } from "@/lib/schemas/contract";
import type { StructuredAddress } from "@/lib/schemas/address";
import { deriveCompletionDate, formatDurationText, todayIso, type DurationUnit } from "@/lib/contracts/dates";
import * as haptics from "@/lib/haptics";

type JobInputState = {
  client_address: string;
  client_address_components?: StructuredAddress;
  client_phone: string;
  site_address: string;
  site_address_components?: StructuredAddress;
  scope_of_work: string;
  exclusions: string;
  materials_by: string;
  materials_notes: string;
  payment_schedule: string;
  start_date: string;
  estimated_duration: string;
  completion_date: string;
  access_arrangements: string;
  warranty_period: string;
  building_regs_responsibility: string;
  cancellation_start: string;
  special_terms: string;
};

const EMPTY_JOB_INPUT: JobInputState = {
  client_address: "",
  client_phone: "",
  site_address: "",
  scope_of_work: "",
  exclusions: "",
  materials_by: "",
  materials_notes: "",
  payment_schedule: "",
  start_date: "",
  estimated_duration: "",
  completion_date: "",
  access_arrangements: "",
  warranty_period: "",
  building_regs_responsibility: "",
  cancellation_start: "No",
  special_terms: "",
};

type Props = {
  quoteId: string;
  jobId?: string;
  initialJobInput?: Partial<JobInputState>;
  // Structured duration seeded from a captured working-day count
  // (labour_plan.duration_days). Prose timelines are NEVER passed as an input
  // value — they'd otherwise leak "To be confirmed before work begins" straight
  // into the field. When only an unparseable timeline was captured, pass
  // durationHint instead so the contractor knows to fill it from the call.
  initialDuration?: { value: string; unit: DurationUnit };
  durationHint?: string;
  customerName?: string;
  customerEmail?: string;
};

export const CreateContractForm = ({
  quoteId,
  jobId,
  initialJobInput,
  initialDuration,
  durationHint,
  customerName,
  customerEmail,
}: Props) => {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState<ContractTemplateKey>("standard_project");
  const [depositPct, setDepositPct] = useState("");
  const [jobInput, setJobInput] = useState<JobInputState>({
    ...EMPTY_JOB_INPUT,
    ...initialJobInput,
    // Timing fields are managed as structured inputs below; never accept a prose
    // start/completion/duration from prefill.
    start_date: "",
    completion_date: "",
    estimated_duration: formatDurationText(
      initialDuration?.value ?? "",
      initialDuration?.unit ?? "days",
    ),
  });
  // Structured duration + whether the completion date was auto-derived (so a
  // later start/duration change can safely recompute it, but a manual edit
  // sticks). today bounds the start picker's min so a start can't be in the past.
  const [durationValue, setDurationValue] = useState(initialDuration?.value ?? "");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(initialDuration?.unit ?? "days");
  const [completionDerived, setCompletionDerived] = useState(false);
  const today = useMemo(() => todayIso(), []);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    contractUrl: string;
    delivered: boolean;
    hadContactChannel: boolean;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [siteSameAsClient, setSiteSameAsClient] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const submit = () => {
    setSendError(null);
    startTransition(async () => {
      try {
        const res = await createContract({
          quoteId,
          depositPct: depositPct ? Number(depositPct) : undefined,
          templateKey,
          jobInput,
        });
        // The contract row exists the moment createContract returns (status
        // "sent"), so hand off to the job hub's waiting state whenever we have a
        // contract id — regardless of email delivery. Leaving the form mounted
        // on non-delivery contradicted the canonical single-source (the job is
        // already past this stage). The hub surfaces the copy-link fallback and,
        // via ?delivered=0, tells the contractor the email didn't land. The
        // server action already revalidated the job/dashboard data, so a single
        // push lands on fresh RSC. (Adding router.refresh() here races the push
        // and wedges the transition, leaving the button on "Sending…".)
        if (res.contractId && jobId) {
          const query = res.delivered ? "sent=contract" : "sent=contract&delivered=0";
          haptics.success();
          router.push(`/jobs/${jobId}?${query}`);
          return;
        }
        // Only reached when there's no job hub to hand off to (jobId absent) —
        // keep the copy-link fallback inline.
        setResult({
          contractUrl: res.contractUrl,
          delivered: res.delivered,
          hadContactChannel: res.hadContactChannel,
        });
      } catch (err) {
        // Keep the confirm panel open with its button re-enabled so the
        // contractor can retry, rather than failing silently.
        haptics.error();
        setSendError(
          err instanceof Error
            ? err.message
            : "Couldn't send the contract — check your connection and try again.",
        );
      }
    });
  };

  const updateJobInput = (patch: Partial<JobInputState>) =>
    setJobInput((prev) => ({ ...prev, ...patch }));

  // Auto-fill completion from start + duration, but only when it's safe: an
  // empty completion, or one we derived ourselves. A hand-typed completion is
  // an override and is left alone. Toggles completionDerived so a later start/
  // duration change can recompute a derived value (and clear it if the inputs
  // no longer yield one) without clobbering a manual override.
  const deriveCompletionPatch = (
    startIso: string,
    value: string,
    unit: DurationUnit,
  ): Partial<JobInputState> | null => {
    if (!completionDerived && jobInput.completion_date) return null;
    const next = deriveCompletionDate(startIso, Number(value), unit);
    if (!next) {
      if (completionDerived) {
        setCompletionDerived(false);
        return { completion_date: "" };
      }
      return null;
    }
    setCompletionDerived(true);
    return { completion_date: next };
  };

  const handleStartChange = (startIso: string) => {
    const patch = deriveCompletionPatch(startIso, durationValue, durationUnit) ?? {};
    updateJobInput({ start_date: startIso, ...patch });
  };

  const handleDurationChange = (rawValue: string, unit: DurationUnit) => {
    const value = rawValue.replace(/[^0-9]/g, "");
    setDurationValue(value);
    setDurationUnit(unit);
    const patch = deriveCompletionPatch(jobInput.start_date, value, unit) ?? {};
    updateJobInput({ estimated_duration: formatDurationText(value, unit), ...patch });
  };

  const handleCompletionChange = (iso: string) => {
    setCompletionDerived(false);
    updateJobInput({ completion_date: iso });
  };

  const setClientAddress = (address: StructuredAddress) =>
    updateJobInput({
      client_address: address.formatted,
      client_address_components: address.formatted ? address : undefined,
      // Keep the site address mirrored while "same as client" is ticked.
      ...(siteSameAsClient
        ? {
            site_address: address.formatted,
            site_address_components: address.formatted ? address : undefined,
          }
        : {}),
    });

  const setSiteAddress = (address: StructuredAddress) =>
    updateJobInput({
      site_address: address.formatted,
      site_address_components: address.formatted ? address : undefined,
    });

  const toggleSiteSameAsClient = (checked: boolean) => {
    setSiteSameAsClient(checked);
    if (checked) {
      updateJobInput({
        site_address: jobInput.client_address,
        site_address_components: jobInput.client_address_components,
      });
    }
  };

  if (result) {
    const name = customerName ?? "your customer";
    if (result.delivered) {
      return (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-success">Contract sent to {name} (email).</p>
          <p className="text-text-secondary">
            They&apos;ll review and sign it online. You&apos;ll get an email the second it&apos;s
            signed. Nothing else needs you until then.
          </p>
          <ShareLinkButton url={result.contractUrl} title={`Contract for ${name}`} label="Copy contract link" />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 rounded-card border border-error bg-error-bg p-3 text-sm">
        <p className="text-error">
          {result.hadContactChannel
            ? `Contract created, but we couldn't get it to ${name}. Copy the link below and send it to them yourself.`
            : `Contract created, but there's no email address or mobile number on file for ${name}. Copy the link below and send it to them yourself.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ShareLinkButton url={result.contractUrl} title={`Contract for ${name}`} label="Copy contract link" />
          <InlineLink href={result.contractUrl} external>
            View contract
          </InlineLink>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!jobInput.scope_of_work.trim()) {
          setScopeError(true);
          return;
        }
        setScopeError(false);
        setConfirming(true);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Select
          label="Contract type"
          value={templateKey}
          onChange={(e) => setTemplateKey(e.target.value as ContractTemplateKey)}
        >
          {CONTRACT_TEMPLATES.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </Select>
        <span className="text-xs text-text-muted">
          {CONTRACT_TEMPLATES.find((t) => t.key === templateKey)?.description}
        </span>
      </div>

      {templateKey !== "small_works" && templateKey !== "maintenance_recurring" && (
        <Input
          label="Deposit (%, optional)"
          type="number"
          step="1"
          min="0"
          max="100"
          value={depositPct}
          onChange={(e) => setDepositPct(e.target.value)}
        />
      )}

      <details className="rounded-card border border-border p-3" open>
        <summary className="cursor-pointer text-sm font-medium">Job details for the contract</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AddressAutocomplete
              label="Client address"
              value={jobInput.client_address}
              onChange={setClientAddress}
            />
            <Input
              label="Client phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={jobInput.client_phone}
              onChange={(e) => updateJobInput({ client_phone: e.target.value })}
            />
          </div>
          <Checkbox
            label="Site same as client address"
            checked={siteSameAsClient}
            onChange={(e) => toggleSiteSameAsClient(e.target.checked)}
          />
          {!siteSameAsClient && (
            <AddressAutocomplete
              label="Site address (if different from client address)"
              value={jobInput.site_address}
              onChange={setSiteAddress}
            />
          )}
          <Textarea
            label="What work are you doing? (required)"
            value={jobInput.scope_of_work}
            onChange={(e) => {
              updateJobInput({ scope_of_work: e.target.value });
              if (e.target.value.trim()) setScopeError(false);
            }}
            error={
              scopeError
                ? "Describe the work before sending — this is what the customer is agreeing to."
                : undefined
            }
          />
          <Input
            label="Excluded from this contract"
            value={jobInput.exclusions}
            onChange={(e) => updateJobInput({ exclusions: e.target.value })}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Materials supplied by"
              placeholder="e.g. Contractor"
              value={jobInput.materials_by}
              onChange={(e) => updateJobInput({ materials_by: e.target.value })}
            />
            <Input
              label="Materials notes"
              value={jobInput.materials_notes}
              onChange={(e) => updateJobInput({ materials_notes: e.target.value })}
            />
          </div>
          {(templateKey === "large_staged_project" || templateKey === "maintenance_recurring") && (
            <Textarea
              label={
                templateKey === "maintenance_recurring"
                  ? "Schedule / frequency"
                  : "Payment schedule (stages)"
              }
              className="min-h-16"
              value={jobInput.payment_schedule}
              onChange={(e) => updateJobInput({ payment_schedule: e.target.value })}
            />
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Start date"
              type="date"
              min={today}
              value={jobInput.start_date}
              onChange={(e) => handleStartChange(e.target.value)}
              hint={jobInput.start_date ? undefined : "Leave blank if not agreed yet."}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">Estimated duration</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 3"
                  aria-label="Estimated duration amount"
                  className="h-11 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-foreground"
                  value={durationValue}
                  onChange={(e) => handleDurationChange(e.target.value, durationUnit)}
                />
                <select
                  aria-label="Estimated duration unit"
                  className="h-11 rounded-control border border-border bg-surface px-2 text-sm text-foreground"
                  value={durationUnit}
                  onChange={(e) => handleDurationChange(durationValue, e.target.value as DurationUnit)}
                >
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                </select>
              </div>
              {durationHint && !durationValue && (
                <span className="text-xs text-text-muted">{durationHint}</span>
              )}
            </label>
            <Input
              label="Estimated completion"
              type="date"
              min={jobInput.start_date || today}
              value={jobInput.completion_date}
              onChange={(e) => handleCompletionChange(e.target.value)}
              hint={
                completionDerived
                  ? "Auto-filled from start + duration — edit to override."
                  : undefined
              }
            />
          </div>
          <Input
            label="Access arrangements"
            value={jobInput.access_arrangements}
            onChange={(e) => updateJobInput({ access_arrangements: e.target.value })}
          />
          <Input
            label="Warranty / guarantee period (defaults to your standard)"
            value={jobInput.warranty_period}
            onChange={(e) => updateJobInput({ warranty_period: e.target.value })}
          />
          {(templateKey === "regulated_certified_works" ||
            templateKey === "large_staged_project" ||
            templateKey === "maintenance_recurring") && (
            <Input
              label="Building Regs notification/certification responsibility"
              value={jobInput.building_regs_responsibility}
              onChange={(e) => updateJobInput({ building_regs_responsibility: e.target.value })}
            />
          )}
          <div className="flex flex-col gap-1.5">
            <Select
              label="Requested early start within the 14-day cancellation period?"
              value={jobInput.cancellation_start}
              onChange={(e) => updateJobInput({ cancellation_start: e.target.value })}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </Select>
            {jobInput.cancellation_start === "Yes" ? (
              <span className="text-xs text-text-muted">
                By UK law, customers have 14 days to cancel with no reason needed. Picking &quot;Yes&quot;
                here lets you start work sooner — but if they do cancel during those 14 days, you can
                only charge for the work you&apos;ve actually done, not the full contract price.
              </span>
            ) : (
              <span className="text-xs text-text-muted">
                By UK law, customers have 14 days to cancel with no reason needed. Leave this as
                &quot;No&quot; unless the customer has asked you to start sooner.
              </span>
            )}
          </div>
          <Textarea
            label="Additional terms (optional)"
            className="min-h-16"
            value={jobInput.special_terms}
            onChange={(e) => updateJobInput({ special_terms: e.target.value })}
          />
        </div>
      </details>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3 text-sm">
          <p>
            Send this contract to{" "}
            <strong>{customerName ?? "the customer"}</strong>
            {customerEmail ? ` at ${customerEmail}` : " — no email on file, you'll need to share the link yourself"}?
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={isPending} onClick={submit}>
              {isPending ? "Sending…" : sendError ? "Try again" : "Yes, send it"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
          {sendError && <p className="text-error">{sendError}</p>}
        </div>
      ) : (
        <Button type="submit" className="self-start">
          Send contract
        </Button>
      )}
    </form>
  );
};

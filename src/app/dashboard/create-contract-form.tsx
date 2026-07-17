"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineLink } from "@/components/ui/inline-link";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import type { ContractTemplateKey } from "@/lib/schemas/contract";
import type { StructuredAddress } from "@/lib/schemas/address";

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
  customerName?: string;
  customerEmail?: string;
};

export const CreateContractForm = ({
  quoteId,
  jobId,
  initialJobInput,
  customerName,
  customerEmail,
}: Props) => {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState<ContractTemplateKey>("standard_project");
  const [depositPct, setDepositPct] = useState("");
  const [jobInput, setJobInput] = useState<JobInputState>({
    ...EMPTY_JOB_INPUT,
    ...initialJobInput,
  });
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    contractUrl: string;
    delivered: boolean;
    hasCustomerEmail: boolean;
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
        // Delivered cleanly → hand off to the job hub's celebratory state.
        // If the email didn't reach the customer, stay put so the copy-link
        // fallback below is available.
        if (res.delivered && jobId) {
          router.push(`/jobs/${jobId}?sent=contract`);
          router.refresh();
          return;
        }
        setResult({
          contractUrl: res.contractUrl,
          delivered: res.delivered,
          hasCustomerEmail: res.hasCustomerEmail,
        });
      } catch (err) {
        // Keep the confirm panel open with its button re-enabled so the
        // contractor can retry, rather than failing silently.
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
          <CopyLinkButton url={result.contractUrl} label="Copy contract link" />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 rounded-card border border-error bg-error-bg p-3 text-sm">
        <p className="text-error">
          {result.hasCustomerEmail
            ? `Contract created, but the email to ${name} failed to send. Copy the link below and send it to them yourself.`
            : `Contract created, but there's no email address on file for ${name}. Copy the link below and send it to them yourself.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyLinkButton url={result.contractUrl} label="Copy contract link" />
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
              value={jobInput.start_date}
              onChange={(e) => updateJobInput({ start_date: e.target.value })}
            />
            <Input
              label="Estimated duration"
              value={jobInput.estimated_duration}
              onChange={(e) => updateJobInput({ estimated_duration: e.target.value })}
            />
            <Input
              label="Estimated completion"
              value={jobInput.completion_date}
              onChange={(e) => updateJobInput({ completion_date: e.target.value })}
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

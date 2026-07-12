"use client";

import { useState, useTransition } from "react";
import { createContract } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import type { ContractTemplateKey } from "@/lib/schemas/contract";

type JobInputState = {
  client_address: string;
  client_phone: string;
  site_address: string;
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
  initialJobInput?: Partial<JobInputState>;
  customerName?: string;
  customerEmail?: string;
};

export const CreateContractForm = ({
  quoteId,
  initialJobInput,
  customerName,
  customerEmail,
}: Props) => {
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
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [scopeError, setScopeError] = useState(false);

  const submit = () => {
    startTransition(async () => {
      const res = await createContract({
        quoteId,
        depositPct: depositPct ? Number(depositPct) : undefined,
        templateKey,
        jobInput,
      });
      setResult({
        contractUrl: res.contractUrl,
        delivered: res.delivered,
        hasCustomerEmail: res.hasCustomerEmail,
      });
    });
  };

  const updateJobInput = (patch: Partial<JobInputState>) =>
    setJobInput((prev) => ({ ...prev, ...patch }));

  if (result) {
    if (result.delivered) {
      return (
        <div className="text-sm text-success">
          Contract sent and emailed to the customer.{" "}
          <a href={result.contractUrl} className="underline underline-offset-4">
            View contract
          </a>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 rounded-card border border-error bg-error-bg p-3 text-sm">
        <p className="text-error">
          {result.hasCustomerEmail
            ? "Contract created, but the email to the customer failed to send. Copy the link below and send it to them yourself."
            : "Contract created, but there's no email address on file for this customer. Copy the link below and send it to them yourself."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(result.contractUrl);
              setCopied(true);
            }}
          >
            {copied ? "Copied!" : "Copy contract link"}
          </Button>
          <a href={result.contractUrl} className="underline underline-offset-4">
            View contract
          </a>
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
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-text-secondary">Contract type</span>
        <select
          value={templateKey}
          onChange={(e) => setTemplateKey(e.target.value as ContractTemplateKey)}
          className="h-11 rounded-control border border-border bg-surface px-3 text-sm"
        >
          {CONTRACT_TEMPLATES.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">
          {CONTRACT_TEMPLATES.find((t) => t.key === templateKey)?.description}
        </span>
      </label>

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
            <Input
              label="Client address"
              value={jobInput.client_address}
              onChange={(e) => updateJobInput({ client_address: e.target.value })}
            />
            <Input
              label="Client phone"
              value={jobInput.client_phone}
              onChange={(e) => updateJobInput({ client_phone: e.target.value })}
            />
          </div>
          <Input
            label="Site address (if different from client address)"
            value={jobInput.site_address}
            onChange={(e) => updateJobInput({ site_address: e.target.value })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-secondary">Scope of work (required)</span>
            <textarea
              className={`min-h-20 rounded-md border bg-transparent p-2 text-sm ${
                scopeError ? "border-error" : "border-border"
              }`}
              value={jobInput.scope_of_work}
              onChange={(e) => {
                updateJobInput({ scope_of_work: e.target.value });
                if (e.target.value.trim()) setScopeError(false);
              }}
            />
            {scopeError && (
              <span className="text-xs text-error">
                Describe the work before sending — this is what the customer is agreeing to.
              </span>
            )}
          </label>
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
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-secondary">
                {templateKey === "maintenance_recurring" ? "Schedule / frequency" : "Payment schedule (stages)"}
              </span>
              <textarea
                className="min-h-16 rounded-md border border-border bg-transparent p-2 text-sm"
                value={jobInput.payment_schedule}
                onChange={(e) => updateJobInput({ payment_schedule: e.target.value })}
              />
            </label>
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
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-secondary">
              Requested early start within the 14-day cancellation period?
            </span>
            <select
              value={jobInput.cancellation_start}
              onChange={(e) => updateJobInput({ cancellation_start: e.target.value })}
              className="h-11 rounded-control border border-border bg-surface px-3 text-sm"
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
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
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-secondary">Additional terms (optional)</span>
            <textarea
              className="min-h-16 rounded-md border border-border bg-transparent p-2 text-sm"
              value={jobInput.special_terms}
              onChange={(e) => updateJobInput({ special_terms: e.target.value })}
            />
          </label>
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
              {isPending ? "Sending…" : "Yes, send it"}
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
        </div>
      ) : (
        <Button type="submit" className="self-start">
          Send contract
        </Button>
      )}
    </form>
  );
};

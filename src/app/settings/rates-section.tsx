"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { saveBusinessRates, type BusinessRates } from "./rates-actions";

type Props = {
  initialRates: BusinessRates;
};

// Blank means "no answer", not zero. A trade who leaves the half-day box empty
// does not do half days, and storing 0 would put a £0.00 half day on a customer
// document — so an empty field round-trips to null rather than to a number.
const toValue = (rate: number | null): string => (rate == null ? "" : String(rate));
const toRate = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const FIELDS: { key: keyof BusinessRates; label: string; hint: string; suffix: string }[] = [
  { key: "day_rate", label: "Day rate", hint: "What you charge for a full day", suffix: "£" },
  { key: "half_day_rate", label: "Half-day rate", hint: "Leave blank if you don't do half days", suffix: "£" },
  { key: "overtime_rate", label: "Overtime / weekend rate", hint: "Per day", suffix: "£" },
  { key: "callout_min", label: "Minimum call-out", hint: "The least you'll turn out for", suffix: "£" },
  { key: "travel_rate", label: "Travel charge", hint: "Per job", suffix: "£" },
  { key: "markup_pct", label: "Materials markup", hint: "Percentage on top of what you pay", suffix: "%" },
];

export const RatesSection = ({ initialRates }: Props) => {
  const toast = useToast();
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, toValue(initialRates[f.key])])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const payload = Object.fromEntries(
      FIELDS.map((f) => [f.key, toRate(rates[f.key] ?? "")]),
    ) as BusinessRates;

    startSaving(async () => {
      const result = await saveBusinessRates(payload);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // A settings save is a non-job save: stay in place, confirm with a toast,
      // no navigation (UI conventions).
      toast("Rates saved.");
    });
  };

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-text-secondary">
          What Motko prices your quotes from. Leave anything blank that
          doesn&apos;t apply — a blank rate is left off a quote rather than
          guessed at.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <Input
              key={field.key}
              label={`${field.label} (${field.suffix})`}
              hint={field.hint}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="—"
              value={rates[field.key] ?? ""}
              onChange={(event) =>
                setRates((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save rates"}
        </Button>
      </form>
    </Card>
  );
};

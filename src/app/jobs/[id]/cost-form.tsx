"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createJobCost, updateJobCost } from "./cost-actions";

type Cost = {
  id: string;
  description: string;
  amountNet: number;
  vatAmount: number | null;
  vatTreatment: string;
  category: string;
  incurredOn: string;
  paid: boolean;
  paidOn: string | null;
  counterpartyName: string | null;
};

type CostFormProps = {
  jobId: string;
  existingCost?: Cost;
  existingCounterparties: string[];
  defaultVatTreatment: "standard" | "zero";
  onClose: () => void;
};

const VAT_TREATMENTS = [
  { value: "standard", label: "Standard (20%)" },
  { value: "zero", label: "Zero-rated (0%)" },
  { value: "exempt", label: "Exempt" },
  { value: "reverse_charge", label: "Reverse charge" },
  { value: "unknown", label: "Unknown" },
];

const CATEGORIES = [
  { value: "materials", label: "Materials" },
  { value: "labour", label: "Labour" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "plant_hire", label: "Plant hire" },
  { value: "other", label: "Other" },
];

export function CostForm({
  jobId,
  existingCost,
  existingCounterparties,
  defaultVatTreatment,
  onClose,
}: CostFormProps) {
  const [description, setDescription] = useState(existingCost?.description ?? "");
  const [amountPounds, setAmountPounds] = useState(
    existingCost ? (existingCost.amountNet / 100).toFixed(2) : ""
  );
  const [category, setCategory] = useState(existingCost?.category ?? "materials");
  const [counterpartyName, setCounterpartyName] = useState(
    existingCost?.counterpartyName ?? ""
  );
  const [incurredOn, setIncurredOn] = useState(
    existingCost?.incurredOn ?? new Date().toISOString().split("T")[0]
  );
  const [vatTreatment, setVatTreatment] = useState(
    existingCost?.vatTreatment ?? defaultVatTreatment
  );
  const [paid, setPaid] = useState(existingCost?.paid ?? false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCounterpartySuggestions, setShowCounterpartySuggestions] = useState(false);
  const filteredCounterparties = existingCounterparties.filter((name) =>
    name.toLowerCase().includes(counterpartyName.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const amountNet = Math.round(parseFloat(amountPounds) * 100);
    if (isNaN(amountNet)) {
      setError("Invalid amount");
      setSubmitting(false);
      return;
    }

    let vatAmount: number | null = null;
    if (vatTreatment === "standard") {
      vatAmount = Math.round(amountNet * 0.2);
    }

    const costData = {
      jobId,
      description,
      amountNet,
      vatAmount,
      vatTreatment,
      category,
      counterpartyName: counterpartyName.trim() || null,
      counterpartyKind: category === "subcontractor" ? "subcontractor" : "supplier",
      incurredOn,
      paid,
      paidOn: paid ? new Date().toISOString().split("T")[0] : null,
      source: "manual",
    };

    const result = existingCost
      ? await updateJobCost({ costId: existingCost.id, ...costData })
      : await createJobCost(costData);

    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
    } else {
      onClose();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="text-lg font-semibold">
        {existingCost ? "Edit cost" : "Add cost"}
      </h3>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          Description
        </label>
        <input
          id="description"
          type="text"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border rounded-md px-3 py-2"
          placeholder="e.g. Timber for roof frame"
        />
      </div>

      <div>
        <label htmlFor="amount" className="block text-sm font-medium mb-1">
          Amount (£)
        </label>
        <input
          id="amount"
          type="number"
          step="0.01"
          required
          value={amountPounds}
          onChange={(e) => setAmountPounds(e.target.value)}
          className="w-full border rounded-md px-3 py-2"
          placeholder="0.00"
        />
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium mb-1">
          Category
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full border rounded-md px-3 py-2"
        >
          {CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <label htmlFor="counterparty" className="block text-sm font-medium mb-1">
          Counterparty (optional)
        </label>
        <input
          id="counterparty"
          type="text"
          value={counterpartyName}
          onChange={(e) => {
            setCounterpartyName(e.target.value);
            setShowCounterpartySuggestions(true);
          }}
          onFocus={() => setShowCounterpartySuggestions(true)}
          onBlur={() => setTimeout(() => setShowCounterpartySuggestions(false), 200)}
          className="w-full border rounded-md px-3 py-2"
          placeholder="e.g. Screwfix"
        />
        {showCounterpartySuggestions && counterpartyName && filteredCounterparties.length > 0 && (
          <div className="absolute z-10 w-full bg-white border rounded-md mt-1 max-h-40 overflow-y-auto shadow-lg">
            {filteredCounterparties.slice(0, 10).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setCounterpartyName(name);
                  setShowCounterpartySuggestions(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-100"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="incurredOn" className="block text-sm font-medium mb-1">
          Date incurred
        </label>
        <input
          id="incurredOn"
          type="date"
          required
          value={incurredOn}
          onChange={(e) => setIncurredOn(e.target.value)}
          className="w-full border rounded-md px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="vatTreatment" className="block text-sm font-medium mb-1">
          VAT treatment
        </label>
        <select
          id="vatTreatment"
          value={vatTreatment}
          onChange={(e) => setVatTreatment(e.target.value)}
          className="w-full border rounded-md px-3 py-2"
        >
          {VAT_TREATMENTS.map((vat) => (
            <option key={vat.value} value={vat.value}>
              {vat.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm font-medium">Mark as paid</span>
        </label>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving..." : existingCost ? "Update cost" : "Add cost"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

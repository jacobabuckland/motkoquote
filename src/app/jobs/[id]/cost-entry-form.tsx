"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { addJobCost } from "@/app/jobs/cost-actions";

type CostEntryFormProps = {
  jobId: string;
  defaultVatTreatment: "standard" | "zero" | "exempt";
};

export function CostEntryForm({ jobId, defaultVatTreatment }: CostEntryFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [amountPounds, setAmountPounds] = useState("");
  const [category, setCategory] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [incurredOn, setIncurredOn] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [vatTreatment, setVatTreatment] = useState(defaultVatTreatment);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const amountPence = Math.round(parseFloat(amountPounds) * 100);

    const result = await addJobCost(jobId, {
      description,
      amountPence,
      category: category || undefined,
      counterparty: counterparty || undefined,
      incurredOn,
      vatTreatment,
    });

    setSaving(false);

    if (result.success) {
      // Reset form
      setDescription("");
      setAmountPounds("");
      setCategory("");
      setCounterparty("");
      setIncurredOn(new Date().toISOString().split("T")[0]);
      setVatTreatment(defaultVatTreatment);
      setIsOpen(false);
    } else {
      setError(result.error || "Failed to add cost");
    }
  };

  const handleCancel = () => {
    setDescription("");
    setAmountPounds("");
    setCategory("");
    setCounterparty("");
    setIncurredOn(new Date().toISOString().split("T")[0]);
    setVatTreatment(defaultVatTreatment);
    setError(null);
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <Button variant="secondary" onClick={() => setIsOpen(true)}>
        Add cost
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border border-line rounded-sm">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>
      )}

      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          Description
        </label>
        <input
          id="description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          className="w-full px-3 py-2 border border-line rounded-sm"
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
          value={amountPounds}
          onChange={(e) => setAmountPounds(e.target.value)}
          required
          className="w-full px-3 py-2 border border-line rounded-sm"
        />
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium mb-1">
          Category (optional)
        </label>
        <input
          id="category"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 py-2 border border-line rounded-sm"
        />
      </div>

      <div>
        <label htmlFor="counterparty" className="block text-sm font-medium mb-1">
          Counterparty (optional)
        </label>
        <input
          id="counterparty"
          type="text"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          className="w-full px-3 py-2 border border-line rounded-sm"
        />
      </div>

      <div>
        <label htmlFor="incurred-on" className="block text-sm font-medium mb-1">
          Date
        </label>
        <input
          id="incurred-on"
          type="date"
          value={incurredOn}
          onChange={(e) => setIncurredOn(e.target.value)}
          required
          className="w-full px-3 py-2 border border-line rounded-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">VAT treatment</label>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="standard"
              checked={vatTreatment === "standard"}
              onChange={(e) => setVatTreatment(e.target.value as "standard")}
            />
            <span className="text-sm">Standard rate</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="zero"
              checked={vatTreatment === "zero"}
              onChange={(e) => setVatTreatment(e.target.value as "zero")}
            />
            <span className="text-sm">Zero rate</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="exempt"
              checked={vatTreatment === "exempt"}
              onChange={(e) => setVatTreatment(e.target.value as "exempt")}
            />
            <span className="text-sm">Exempt</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" variant="primary" loading={saving}>
          Save cost
        </Button>
        <Button type="button" variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

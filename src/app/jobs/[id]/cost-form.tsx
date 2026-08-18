"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createJobCost, updateJobCost } from "./cost-actions";
import { ReceiptCapture } from "./receipt-capture";
import { extractReceiptData } from "./receipt-extract-actions";

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
  userId: string;
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
  userId,
  onClose,
}: CostFormProps) {
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

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

  // Handle photo upload and extraction
  const handlePhotoUploaded = async (uploadedPhotoUrl: string) => {
    setPhotoUrl(uploadedPhotoUrl);
    setShowPhotoCapture(false);
    setExtracting(true);
    setError(null);

    // Extract data from the photo
    const result = await extractReceiptData(uploadedPhotoUrl);

    setExtracting(false);

    if (result.ok) {
      const extracted = result.data;

      // Pre-fill form fields from extracted data
      if (extracted.supplier) {
        setDescription(extracted.supplier);
        setCounterpartyName(extracted.supplier);
      } else {
        setDescription("Receipt");
      }

      if (extracted.total !== null) {
        setAmountPounds((extracted.total / 100).toFixed(2));
      }

      if (extracted.date) {
        setIncurredOn(extracted.date);
      }

      // Auto-select VAT treatment if VAT is approximately 20% of total (within 1p)
      if (extracted.vat !== null && extracted.total !== null) {
        const expectedVat = Math.round(extracted.total * 0.2);
        if (Math.abs(extracted.vat - expectedVat) <= 1) {
          setVatTreatment("standard");
        }
      }
    }
    // If extraction fails, just show the form with the photo attached
    // No error message - this is expected behavior for illegible receipts
  };

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
      evidenceUrl: photoUrl,
      source: photoUrl ? "photo" : "manual",
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

  // Show photo capture UI if requested
  if (showPhotoCapture) {
    return (
      <ReceiptCapture
        userId={userId}
        onPhotoUploaded={handlePhotoUploaded}
        onCancel={() => setShowPhotoCapture(false)}
      />
    );
  }

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

      {extracting && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-900">
          Reading receipt...
        </div>
      )}

      {/* Photo thumbnail if photo is attached */}
      {photoUrl && (
        <div className="border rounded-md p-3 bg-gray-50">
          <p className="text-sm font-medium text-gray-700 mb-2">Receipt photo attached</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📷</span>
            <span className="text-sm text-gray-600">Photo uploaded</span>
          </div>
        </div>
      )}

      {/* Add receipt photo button (only show if no existing cost and no photo yet) */}
      {!existingCost && !photoUrl && (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowPhotoCapture(true)}
            className="w-full"
          >
            📷 Add receipt photo
          </Button>
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
        <Button type="submit" variant="primary" disabled={submitting || extracting}>
          {submitting
            ? "Saving..."
            : photoUrl
              ? "Confirm and save"
              : existingCost
                ? "Update cost"
                : "Add cost"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

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
  /**
   * Values to prefill the form with. Carries `id` ONLY when a STORED cost is
   * being edited.
   *
   * The old prop required an `id`, so a voice draft — which has no row yet —
   * reached it through a cast at the call site. Four decisions then keyed off
   * the OBJECT rather than off the id, and every one was wrong for a draft:
   * the form called itself "Edit cost", offered "Update cost", hid receipt
   * capture, and submitted to `updateJobCost` with `costId: undefined`. The
   * server rejected that as
   *
   *     Invalid input: expected string, received undefined
   *
   * so a cost captured by voice and then EDITED could never be saved at all —
   * reproduced twice on 16 Sep, nothing written either time. Prefill and
   * persistence are different questions and the type now says so.
   */
  initialValues?: Partial<Cost>;
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
  initialValues,
  existingCounterparties,
  defaultVatTreatment,
  userId,
  onClose,
}: CostFormProps) {
  // The id of a cost that EXISTS. Absent for a new cost and for a voice draft
  // prefilled into this form but never written.
  const storedCostId = initialValues?.id;

  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [amountPounds, setAmountPounds] = useState(
    initialValues?.amountNet != null ? (initialValues.amountNet / 100).toFixed(2) : ""
  );
  const [category, setCategory] = useState(initialValues?.category ?? "materials");
  const [counterpartyName, setCounterpartyName] = useState(
    initialValues?.counterpartyName ?? ""
  );
  const [incurredOn, setIncurredOn] = useState(
    initialValues?.incurredOn ?? new Date().toISOString().split("T")[0]
  );
  const [vatTreatment, setVatTreatment] = useState(
    initialValues?.vatTreatment ?? defaultVatTreatment
  );
  const [paid, setPaid] = useState(initialValues?.paid ?? false);

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

    // A ROW, NOT A SET OF VALUES. Prefilled-but-unsaved goes to create.
    const result = storedCostId
      ? await updateJobCost({ costId: storedCostId, ...costData })
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
        {storedCostId ? "Edit cost" : "Add cost"}
      </h3>

      {error && (
        <div className="rounded-md border border-red bg-error-bg p-3 text-sm text-error">
          {error}
        </div>
      )}

      {extracting && (
        <div className="rounded-md border border-line-strong bg-info-bg p-3 text-sm text-info">
          Reading receipt...
        </div>
      )}

      {/* Photo thumbnail if photo is attached */}
      {photoUrl && (
        <div className="rounded-md border border-line-strong bg-card-hover p-3">
          <p className="mb-2 text-sm font-medium text-ink">Receipt photo attached</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📷</span>
            <span className="text-sm text-ink-secondary">Photo uploaded</span>
          </div>
        </div>
      )}

      {/* Add receipt photo button (only show if no STORED cost and no photo yet) */}
      {!storedCostId && !photoUrl && (
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
                className="w-full px-3 py-2 text-left hover:bg-card-hover"
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
              : storedCostId
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

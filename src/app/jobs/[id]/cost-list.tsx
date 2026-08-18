"use client";

import { useState } from "react";
import { Money } from "@/components/ui/money";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { updateJobCost, deleteJobCost, markCostPaid } from "@/app/jobs/cost-actions";
import { formatDate } from "@/lib/format";

type JobCost = {
  id: string;
  description: string;
  amount_pence: number;
  category: string | null;
  counterparty: string | null;
  incurred_on: string;
  vat_treatment: "standard" | "zero" | "exempt";
  paid: boolean;
};

type CostListProps = {
  costs: JobCost[];
};

export function CostList({ costs }: CostListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state for editing
  const [description, setDescription] = useState("");
  const [amountPounds, setAmountPounds] = useState("");
  const [category, setCategory] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [incurredOn, setIncurredOn] = useState("");
  const [vatTreatment, setVatTreatment] = useState<"standard" | "zero" | "exempt">("standard");

  const handleEdit = (cost: JobCost) => {
    setEditingId(cost.id);
    setDescription(cost.description);
    setAmountPounds((cost.amount_pence / 100).toFixed(2));
    setCategory(cost.category || "");
    setCounterparty(cost.counterparty || "");
    setIncurredOn(cost.incurred_on);
    setVatTreatment(cost.vat_treatment);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setDescription("");
    setAmountPounds("");
    setCategory("");
    setCounterparty("");
    setIncurredOn("");
    setVatTreatment("standard");
  };

  const handleSaveEdit = async (costId: string) => {
    setSaving(true);
    const amountPence = Math.round(parseFloat(amountPounds) * 100);

    const result = await updateJobCost(costId, {
      description,
      amountPence,
      category: category || undefined,
      counterparty: counterparty || undefined,
      incurredOn,
      vatTreatment,
    });

    setSaving(false);

    if (result.success) {
      handleCancelEdit();
    }
  };

  const handleDelete = async (costId: string) => {
    await deleteJobCost(costId);
    setDeleteConfirmId(null);
  };

  const handleTogglePaid = async (costId: string, currentPaid: boolean) => {
    await markCostPaid(costId, !currentPaid);
  };

  if (costs.length === 0) {
    return <p className="text-sm text-ink-secondary">No costs recorded yet.</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {costs.map((cost) => {
          const isEditing = editingId === cost.id;

          if (isEditing) {
            return (
              <form
                key={cost.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveEdit(cost.id);
                }}
                className="space-y-4 p-4 border border-line rounded-sm bg-card-hover"
              >
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-line rounded-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Amount (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={amountPounds}
                    onChange={(e) => setAmountPounds(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-line rounded-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Counterparty</label>
                  <input
                    type="text"
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Date</label>
                  <input
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
                    Save
                  </Button>
                  <Button type="button" variant="secondary" onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                </div>
              </form>
            );
          }

          return (
            <div
              key={cost.id}
              className="flex items-start justify-between gap-4 p-3 border border-line rounded-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink">{cost.description}</div>
                <div className="flex items-center gap-3 mt-1 text-sm text-ink-secondary">
                  {cost.counterparty && <span>{cost.counterparty}</span>}
                  <span>{formatDate(cost.incurred_on)}</span>
                  {cost.paid && <span className="text-green">Paid</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Money amount={cost.amount_pence / 100} />
                <div className="flex gap-1">
                  <Button
                    variant="tertiary"
                    onClick={() => handleEdit(cost)}
                    className="text-xs"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() => setDeleteConfirmId(cost.id)}
                    className="text-xs"
                  >
                    Delete
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() => handleTogglePaid(cost.id, cost.paid)}
                    className="text-xs"
                  >
                    {cost.paid ? "Mark unpaid" : "Mark paid"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
        title="Delete cost?"
        description="This action cannot be undone."
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        confirmLabel="Delete"
        destructive
      />
    </>
  );
}

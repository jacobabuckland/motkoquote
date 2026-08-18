"use client";

import { useState } from "react";
import { Dialog } from "@capacitor/dialog";
import { Money } from "@/components/ui/money";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { deleteJobCost, markCostPaid } from "./cost-actions";
import { ReceiptViewer } from "./receipt-viewer";

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
  evidenceUrl: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
};

type CostListProps = {
  costs: Cost[];
  onEdit: (cost: Cost) => void;
};

const CATEGORY_LABELS: Record<string, string> = {
  materials: "Materials",
  labour: "Labour",
  subcontractor: "Subcontractor",
  plant_hire: "Plant hire",
  other: "Other",
};

export function CostList({ costs, onEdit }: CostListProps) {
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);

  const handleDelete = async (costId: string) => {
    const { value } = await Dialog.confirm({
      title: "Delete cost?",
      message: "Delete this cost? This cannot be undone.",
      okButtonTitle: "Delete",
      cancelButtonTitle: "Cancel",
    });

    if (!value) return;

    const result = await deleteJobCost(costId);
    if (!result.ok) {
      alert(result.error);
    }
  };

  const handleMarkPaid = async (costId: string) => {
    setMarkingPaid(costId);
    const today = new Date().toISOString().split("T")[0];
    const result = await markCostPaid({ costId, paidOn: today });
    setMarkingPaid(null);
    if (!result.ok) {
      alert(result.error);
    }
  };

  if (costs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No costs added yet.
      </div>
    );
  }

  return (
    <>
      {viewingReceipt && (
        <ReceiptViewer
          evidenceUrl={viewingReceipt}
          onClose={() => setViewingReceipt(null)}
        />
      )}

      <div className="space-y-3">
        {costs.map((cost) => (
          <div
            key={cost.id}
            className="border rounded-lg p-4 space-y-2"
          >
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{cost.description}</h3>
                  {cost.evidenceUrl && (
                    <button
                      type="button"
                      onClick={() => setViewingReceipt(cost.evidenceUrl)}
                      className="text-xl hover:opacity-70"
                      aria-label="View receipt photo"
                    >
                      📷
                    </button>
                  )}
                </div>
                {cost.counterpartyName && (
                  <p className="text-sm text-muted-foreground">
                    {cost.counterpartyName}
                  </p>
                )}
              </div>
              <Money amount={cost.amountNet / 100} size="row" />
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>{CATEGORY_LABELS[cost.category] ?? cost.category}</span>
              <span>{formatDate(cost.incurredOn)}</span>
              <span
                className={cost.paid ? "text-green-600" : "text-amber-600"}
              >
                {cost.paid ? "Paid" : "Unpaid"}
              </span>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="tertiary"
                onClick={() => onEdit(cost)}
              >
                Edit
              </Button>
              {!cost.paid && (
                <Button
                  variant="tertiary"
                  onClick={() => handleMarkPaid(cost.id)}
                  disabled={markingPaid === cost.id}
                >
                  Mark as paid
                </Button>
              )}
              <Button
                variant="tertiary"
                onClick={() => handleDelete(cost.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

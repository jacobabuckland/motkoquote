"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CostForm } from "./cost-form";
import { CostList } from "./cost-list";
import { JobPnL } from "./job-pnl";

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

type PnLData = {
  invoicedNet: number;
  costsNet: number;
  grossProfit: number;
  marginPct: number | null;
  vatCollected: number;
  vatOnCosts: number;
  vatPosition: number;
  unpaidCosts: number;
  hasInvoice: boolean;
} | null;

type CostsSectionProps = {
  jobId: string;
  userId: string;
  costs: Cost[];
  existingCounterparties: string[];
  contractorVatRegistered: boolean;
  pnlData: PnLData;
};

export function CostsSection({
  jobId,
  userId,
  costs,
  existingCounterparties,
  contractorVatRegistered,
  pnlData,
}: CostsSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingCost, setEditingCost] = useState<Cost | null>(null);

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingCost(null);
  };

  const handleEdit = (cost: Cost) => {
    setEditingCost(cost);
    setShowForm(true);
  };

  return (
    <>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Costs
          </h2>
          {!showForm && (
            <Button variant="tertiary" onClick={() => setShowForm(true)}>
              + Add cost
            </Button>
          )}
        </div>

        {showForm ? (
          <CostForm
            jobId={jobId}
            userId={userId}
            existingCost={editingCost ?? undefined}
            existingCounterparties={existingCounterparties}
            defaultVatTreatment={contractorVatRegistered ? "standard" : "zero"}
            onClose={handleCloseForm}
          />
        ) : (
          <CostList costs={costs} onEdit={handleEdit} />
        )}
      </Card>

      <JobPnL data={pnlData} contractorVatRegistered={contractorVatRegistered} />
    </>
  );
}

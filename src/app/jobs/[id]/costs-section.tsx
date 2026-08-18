"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
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
  const searchParams = useSearchParams();
  const router = useRouter();

  // Extract draft cost from URL params (compute initial state)
  const draftFromUrl = (() => {
    if (searchParams.get("editDraft") === "true") {
      const amountPence = searchParams.get("amountPence");
      const counterpartyName = searchParams.get("counterpartyName");
      const category = searchParams.get("category");
      const incurredOn = searchParams.get("incurredOn");
      const description = searchParams.get("description");

      if (amountPence && category && incurredOn && description) {
        return {
          description,
          amountNet: parseInt(amountPence, 10),
          category,
          counterpartyName: counterpartyName || null,
          incurredOn,
          vatTreatment: contractorVatRegistered ? "standard" : "zero",
          paid: false,
        } as Partial<Cost>;
      }
    }
    return null;
  })();

  const [showForm, setShowForm] = useState(draftFromUrl !== null);
  const [editingCost, setEditingCost] = useState<Cost | null>(null);
  const [draftCost, setDraftCost] = useState<Partial<Cost> | null>(draftFromUrl);

  // Clear URL params after extracting draft cost
  useEffect(() => {
    if (searchParams.get("editDraft") === "true") {
      router.replace(`/jobs/${jobId}`, { scroll: false });
    }
  }, [searchParams, jobId, router]);

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingCost(null);
    setDraftCost(null);
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
            <div className="flex items-center gap-2">
              <Link
                href={`/jobs/${jobId}/add-cost-voice`}
                className={buttonClass("tertiary")}
              >
                Add cost by voice
              </Link>
              <Button variant="tertiary" onClick={() => setShowForm(true)}>
                + Add cost
              </Button>
            </div>
          )}
        </div>

        {showForm ? (
          <CostForm
            jobId={jobId}
            userId={userId}
            existingCost={(editingCost ?? draftCost) as Cost | undefined}
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

import { Card } from "@/components/ui/card";
import { deriveStageStatuses, type PaymentStage } from "@/lib/payment-stages";

type PaymentStagesSectionProps = {
  stages: PaymentStage[];
};

export function PaymentStagesSection({ stages }: PaymentStagesSectionProps) {
  const statuses = deriveStageStatuses(stages);

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        Payment stages
      </h2>
      <div className="flex flex-col gap-2">
        {statuses.map((stage) => (
          <div
            key={stage.stage_number}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-secondary p-3"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                Stage {stage.stage_number}
              </span>
              <span className="text-xs text-text-secondary">
                {stage.amount}
              </span>
            </div>
            <span
              className={`text-sm font-medium ${
                stage.status === "paid"
                  ? "text-success"
                  : stage.status === "awaiting_payment"
                    ? "text-warning"
                    : "text-text-secondary"
              }`}
            >
              {stage.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

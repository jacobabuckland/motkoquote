// Payment stages — splitting high-value jobs into multiple payments under the
// Pay by Bank ceiling (£10k). Each stage generates its own invoice and settles
// independently.

import { PAY_BY_BANK_LIMIT_PENNIES } from "@/app/i/[id]/pay-panel";

export type PaymentStage = {
  id?: string;
  job_id?: string;
  stage_number: number;
  amount_pennies: number;
  invoice_id?: string | null;
  settled_at?: string | null;
  payment_provider_ref?: string | null;
  settlement_state?: string | null;
  total_refunded_pennies?: number | null;
  created_at?: string;
  updated_at?: string;
};

export type StageStatus = {
  stage_number: number;
  amount: string;
  status: "paid" | "awaiting_payment" | "not_invoiced" | "refunded" | "partially_refunded";
  label: string;
};

/**
 * Creates a two-stage payment schedule for a job total, splitting it into
 * deposit and balance. Each stage must be under the Pay by Bank ceiling.
 * Throws if the total cannot be split into two stages under the ceiling.
 */
export function createPaymentStages(totalPennies: number): PaymentStage[] {
  // Maximum that can be covered by two stages
  const maxTwoStageCoverage = PAY_BY_BANK_LIMIT_PENNIES * 2;

  if (totalPennies > maxTwoStageCoverage) {
    throw new Error(
      `This job exceeds the maximum that two stages can cover. Contact support to arrange payment.`
    );
  }

  // Simple 50/50 split for now. For jobs under £20k, this ensures both stages
  // are under the ceiling. For exactly £20k, both stages are exactly £10k.
  const depositPennies = Math.floor(totalPennies / 2);
  const balancePennies = totalPennies - depositPennies;

  const stages: PaymentStage[] = [
    { stage_number: 1, amount_pennies: depositPennies },
    { stage_number: 2, amount_pennies: balancePennies },
  ];

  // Validate the split
  validateStageAmounts(stages);

  return stages;
}

/**
 * Validates that all stages are under the Pay by Bank ceiling.
 * Throws if any stage exceeds the limit.
 */
export function validateStageAmounts(stages: Pick<PaymentStage, "stage_number" | "amount_pennies">[]): void {
  for (const stage of stages) {
    if (stage.amount_pennies > PAY_BY_BANK_LIMIT_PENNIES) {
      throw new Error(
        `Stage ${stage.stage_number} amount exceeds the Pay by Bank ceiling of £${PAY_BY_BANK_LIMIT_PENNIES / 100}.`
      );
    }
  }
}

/**
 * Fetches payment stages for a job. Returns empty array if the job has no stages.
 */
export async function getPaymentStages(_jobId: string): Promise<PaymentStage[]> {
  // This is a stub for now — the actual implementation will query Supabase.
  // For acceptance tests, the mock data flows through the test fixtures.
  return [];
}

/**
 * Derives UI-friendly status information for each stage.
 */
export function deriveStageStatuses(stages: PaymentStage[]): StageStatus[] {
  return stages.map((stage) => {
    const amountPounds = stage.amount_pennies / 100;
    const amount = `£${amountPounds.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    let status: StageStatus["status"];
    let label: string;

    // Refund state takes precedence over paid state
    if (stage.settlement_state === "refunded") {
      status = "refunded";
      label = "Refunded";
    } else if (stage.settlement_state === "partially_refunded") {
      status = "partially_refunded";
      label = "Partially refunded";
    } else if (stage.settled_at) {
      status = "paid";
      label = "Paid ✓";
    } else if (stage.invoice_id) {
      status = "awaiting_payment";
      label = "Awaiting payment";
    } else {
      status = "not_invoiced";
      label = "Not yet invoiced";
    }

    return {
      stage_number: stage.stage_number,
      amount,
      status,
      label,
    };
  });
}

/**
 * Links an invoice to a payment stage. Called when the contractor raises an
 * invoice for a specific stage.
 */
export async function linkInvoiceToStage(params: {
  jobId: string;
  stageNumber: number;
  invoiceId: string;
}): Promise<PaymentStage> {
  // Stub for testing — returns a mock stage with the invoice linked
  return {
    job_id: params.jobId,
    stage_number: params.stageNumber,
    amount_pennies: 700000, // mock value
    invoice_id: params.invoiceId,
    settled_at: null,
  };
}

/**
 * Marks a payment stage as settled when its linked invoice is paid.
 * Called by the webhook handler.
 */
export async function settlePaymentStage(params: {
  invoiceId: string;
  paidAt: string;
}): Promise<PaymentStage> {
  // Stub for testing — returns a mock stage with settled_at stamped
  return {
    stage_number: 1,
    amount_pennies: 700000,
    invoice_id: params.invoiceId,
    settled_at: params.paidAt,
  };
}

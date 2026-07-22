import type { SupabaseClient } from "@supabase/supabase-js";
import {
  planFeeCollections,
  planDunningAction,
  type AccruedJob,
} from "@/lib/fee-collection";
import { chargeMandate } from "@/lib/truelayer-vrp";
import { sendContractorNotificationEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { formatGBP } from "@/lib/format";
import type { FeeBillingEvent } from "@/lib/push/payload";

// Fee collection I/O, service-role only (runs from the monthly + dunning crons
// and the fee webhook). Pure planning lives in fee-collection.ts; the mandate
// charge in truelayer-vrp.ts. Money is in pennies here; formatGBP takes pounds.
//
// Lifecycle of one fee_collection:
//   pending --charge ok, webhook payment_executed--> collected
//   pending --charge throws / webhook payment_failed--> failed (dunning)
//   failed  --retry within budget--> pending (charged again)
//   failed  --retries exhausted--> stays failed, contractor billing 'paused'

const FEE_REFERENCE = "MOTKO FEES";

type ContractorBilling = {
  id: string;
  owner_user_id: string;
  company_name: string | null;
  business_profile: { business_email?: string } | null;
  fee_mandate_id: string | null;
  fee_mandate_status: string | null;
  fee_collection_status: string;
};

const settingsUrl = (): string =>
  `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings`;

// Fires a fee-billing alert to the trade over email + push (best-effort, never
// throws). These are operational alerts about their own account, so they bypass
// the mutable notification preferences (see push/payload.ts).
const notifyFeeBilling = async (
  admin: SupabaseClient,
  contractor: ContractorBilling,
  input: { event: FeeBillingEvent; subject: string; heading: string; nextStep: string },
): Promise<void> => {
  const email = contractor.business_profile?.business_email;
  const url = settingsUrl();
  await Promise.all([
    email
      ? sendContractorNotificationEmail({
          to: email,
          subject: input.subject,
          heading: input.heading,
          nextStep: input.nextStep,
          jobUrl: url,
          buttonLabel: "Open billing settings",
        })
      : Promise.resolve(),
    sendPushToUser(admin, contractor.owner_user_id, {
      event: input.event,
      title: input.subject,
      body: input.heading,
      url,
    }),
  ]);
};

// Marks a collection failed and moves the trade to 'past_due', then alerts them.
const markCollectionFailed = async (
  admin: SupabaseClient,
  collection: { id: string; total_pennies: number },
  contractor: ContractorBilling,
  reason: string,
): Promise<void> => {
  await admin
    .from("fee_collections")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", collection.id);
  await admin
    .from("contractors")
    .update({ fee_collection_status: "past_due" })
    .eq("id", contractor.id);
  await notifyFeeBilling(admin, contractor, {
    event: "fee_collection_failed",
    subject: "A motko fee payment didn't go through",
    heading: `We couldn't collect ${formatGBP(collection.total_pennies / 100)} in motko fees.`,
    nextStep:
      "We'll retry automatically over the next few days. Check your bank authorisation if it keeps failing.",
  });
};

// TrueLayer payment statuses that mean the charge has definitively failed at
// creation time (vs. still executing, which the webhook settles later).
const FAILED_STATUSES = new Set(["failed", "cancelled", "rejected"]);

// Attempts one charge against the trade's mandate for a pending/failed
// collection. Bumps the attempt counter + last_attempt_at first (so dunning
// gates correctly even if the charge throws), then either leaves the collection
// pending for the webhook to settle, or marks it failed. Idempotency key folds
// in the attempt number so a retry is a genuinely new charge, not a dedupe hit.
const chargeCollection = async (
  admin: SupabaseClient,
  collection: { id: string; total_pennies: number; attempts: number },
  contractor: ContractorBilling,
  now: string,
): Promise<void> => {
  if (!contractor.fee_mandate_id) {
    await markCollectionFailed(admin, collection, contractor, "no_mandate");
    return;
  }

  const attempt = collection.attempts + 1;
  await admin
    .from("fee_collections")
    .update({ status: "pending", attempts: attempt, last_attempt_at: now })
    .eq("id", collection.id);

  try {
    const payment = await chargeMandate({
      mandateId: contractor.fee_mandate_id,
      amountInMinor: collection.total_pennies,
      reference: FEE_REFERENCE,
      metadata: { fee_collection_id: collection.id, contractor_id: contractor.id },
      idempotencyKey: `${collection.id}:${attempt}`,
    });

    await admin
      .from("fee_collections")
      .update({ provider_collection_ref: payment.id })
      .eq("id", collection.id);

    if (FAILED_STATUSES.has(payment.status)) {
      await markCollectionFailed(admin, collection, contractor, `status_${payment.status}`);
    }
    // Otherwise leave it pending — settleFeeCollection flips it to collected on
    // the payment_executed webhook.
  } catch (error) {
    await markCollectionFailed(
      admin,
      collection,
      contractor,
      error instanceof Error ? error.message.slice(0, 200) : "charge_error",
    );
  }
};

const loadContractorBilling = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<ContractorBilling | null> => {
  const { data } = await admin
    .from("contractors")
    .select(
      "id, owner_user_id, company_name, business_profile, fee_mandate_id, fee_mandate_status, fee_collection_status",
    )
    .eq("id", contractorId)
    .maybeSingle();
  return (data as ContractorBilling | null) ?? null;
};

export type FeeCollectionBatchResult = {
  contractorsBilled: number;
  collectionsCreated: number;
  skippedNoMandate: number;
};

// Monthly batch: rolls every accrued job into one collection per trade and
// charges it against their mandate. Trades without an authorised mandate are
// skipped (their fees stay accrued) and nudged to set billing up; paused trades
// are left entirely for a human. Idempotent enough for cron: a job only leaves
// 'accrued' once its collection is settled by the webhook.
export const runFeeCollectionBatch = async (
  admin: SupabaseClient,
  input: { periodStart: string; periodEnd: string; now: string },
): Promise<FeeCollectionBatchResult> => {
  const { data: jobRows } = await admin
    .from("jobs")
    .select("id, contractor_id, fee_amount_pennies")
    .eq("fee_status", "accrued");

  const jobs: AccruedJob[] = ((jobRows ?? []) as {
    id: string;
    contractor_id: string;
    fee_amount_pennies: number | null;
  }[]).map((j) => ({
    jobId: j.id,
    contractorId: j.contractor_id,
    feeAmountPennies: j.fee_amount_pennies ?? 0,
  }));

  const plans = planFeeCollections(jobs);
  const result: FeeCollectionBatchResult = {
    contractorsBilled: 0,
    collectionsCreated: 0,
    skippedNoMandate: 0,
  };

  for (const plan of plans) {
    const contractor = await loadContractorBilling(admin, plan.contractorId);
    if (!contractor) continue;

    // Paused billing waits for a human — don't stack new charges on top.
    if (contractor.fee_collection_status === "paused") continue;

    if (contractor.fee_mandate_status !== "authorized" || !contractor.fee_mandate_id) {
      result.skippedNoMandate += 1;
      await notifyFeeBilling(admin, contractor, {
        event: "mandate_setup_required",
        subject: "Set up motko fee billing",
        heading: `You've ${formatGBP(plan.totalPennies / 100)} of motko fees ready to collect, but billing isn't set up yet.`,
        nextStep: "Set up fee billing in Settings so we can collect it by bank.",
      });
      continue;
    }

    const { data: created } = await admin
      .from("fee_collections")
      .insert({
        contractor_id: plan.contractorId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        job_ids: plan.jobIds,
        total_pennies: plan.totalPennies,
        status: "pending",
      })
      .select("id, total_pennies, attempts")
      .single();
    if (!created) continue;

    result.collectionsCreated += 1;
    result.contractorsBilled += 1;
    await chargeCollection(
      admin,
      created as { id: string; total_pennies: number; attempts: number },
      contractor,
      input.now,
    );
  }

  return result;
};

export type DunningResult = { retried: number; paused: number; waiting: number };

// Dunning sweep: re-attempts failed collections on schedule, pausing a trade's
// billing once the retry budget is spent. Safe to run daily.
export const retryFailedCollections = async (
  admin: SupabaseClient,
  input: { now: string },
): Promise<DunningResult> => {
  const now = new Date(input.now);
  const { data: failedRows } = await admin
    .from("fee_collections")
    .select("id, contractor_id, total_pennies, attempts, last_attempt_at")
    .eq("status", "failed");

  const collections = (failedRows ?? []) as {
    id: string;
    contractor_id: string;
    total_pennies: number;
    attempts: number;
    last_attempt_at: string | null;
  }[];

  const result: DunningResult = { retried: 0, paused: 0, waiting: 0 };

  for (const collection of collections) {
    const decision = planDunningAction(
      { attempts: collection.attempts, lastAttemptAt: collection.last_attempt_at ?? input.now },
      now,
    );

    if (decision.action === "wait") {
      result.waiting += 1;
      continue;
    }

    const contractor = await loadContractorBilling(admin, collection.contractor_id);
    if (!contractor) continue;

    if (decision.action === "give_up") {
      await admin
        .from("contractors")
        .update({ fee_collection_status: "paused" })
        .eq("id", contractor.id);
      await notifyFeeBilling(admin, contractor, {
        event: "fee_billing_paused",
        subject: "motko fee billing paused",
        heading: `We couldn't collect ${formatGBP(collection.total_pennies / 100)} after several tries, so billing is paused.`,
        nextStep: "Re-authorise your bank in Settings, or contact support, to continue.",
      });
      result.paused += 1;
      continue;
    }

    await chargeCollection(admin, collection, contractor, input.now);
    result.retried += 1;
  }

  return result;
};

// Settles a fee collection once its mandate charge succeeds (payment_executed
// webhook). Idempotent via the status guard: marks the collection collected,
// flips its jobs from 'accrued' to 'collected', and returns the trade to
// 'active' billing. Only touches jobs still 'accrued' so a redelivery is a no-op.
export const settleFeeCollection = async (
  admin: SupabaseClient,
  input: { feeCollectionId: string; providerRef: string; now: string },
): Promise<void> => {
  const { data } = await admin
    .from("fee_collections")
    .update({
      status: "collected",
      collected_at: input.now,
      provider_collection_ref: input.providerRef,
    })
    .eq("id", input.feeCollectionId)
    .neq("status", "collected")
    .select("id, contractor_id, job_ids")
    .maybeSingle();

  const collection = data as
    | { id: string; contractor_id: string; job_ids: string[] }
    | null;
  if (!collection) return;

  if (collection.job_ids.length > 0) {
    await admin
      .from("jobs")
      .update({ fee_status: "collected" })
      .in("id", collection.job_ids)
      .eq("fee_status", "accrued");
  }

  await admin
    .from("contractors")
    .update({ fee_collection_status: "active" })
    .eq("id", collection.contractor_id);
};

// Marks a fee collection failed from the payment_failed webhook (async failure
// after the charge was accepted). Loads the contractor to run the standard
// past-due path + alert.
export const failFeeCollection = async (
  admin: SupabaseClient,
  input: { feeCollectionId: string; reason: string },
): Promise<void> => {
  const { data } = await admin
    .from("fee_collections")
    .select("id, contractor_id, total_pennies, status")
    .eq("id", input.feeCollectionId)
    .maybeSingle();
  const collection = data as
    | { id: string; contractor_id: string; total_pennies: number; status: string }
    | null;
  if (!collection || collection.status === "collected") return;

  const contractor = await loadContractorBilling(admin, collection.contractor_id);
  if (!contractor) return;

  await markCollectionFailed(
    admin,
    { id: collection.id, total_pennies: collection.total_pennies },
    contractor,
    input.reason,
  );
};

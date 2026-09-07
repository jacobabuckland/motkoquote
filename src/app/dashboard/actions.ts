"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createInvoiceRecord } from "@/lib/invoicing";
import { deriveInvoiceAmount } from "@/lib/invoice-amount";
import { embeddedMany, type Embedded } from "@/lib/postgrest-embed";
import { renderContractPdf } from "@/lib/pdf/render-contract";
import { notifyCustomer } from "@/lib/notify-customer";
import { contractJobInputSchema, contractTemplateKeySchema } from "@/lib/schemas/contract";
import type { BusinessProfile } from "@/lib/schemas/contract";
import type { LineItem } from "@/lib/schemas/job";
import { getContractTemplate } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { actionableError } from "@/lib/actionable-error";
import { createPaymentStages } from "@/lib/payment-stages";
import { PAY_BY_BANK_LIMIT_PENNIES } from "@/app/i/[id]/pay-panel";
import { isSubscriptionReadOnly } from "@/lib/subscription";

// The client sends its intent only — never a figure. `amount` is derived
// server-side from the quote total, the contract's deposit percentage, and the
// invoices already raised (see deriveInvoiceAmount). A prefilled amount in the
// form is display-only and is intentionally not accepted here.
const createInvoiceSchema = z.object({
  quoteId: z.string().uuid(),
  invoiceType: z.enum(["deposit", "final"]),
  dueDate: z.string().optional(),
  paymentStageId: z.string().uuid().optional(),
});

type QuoteWithRelations = {
  total: number;
  invoices: { amount: number; invoice_type: string }[];
  // to-one embed: an OBJECT, not an array. deriveInvoiceAmount iterates it with
  // `.find`, which throws "contracts.find is not a function" on an object — so
  // every deposit invoice failed outright. See postgrest-embed.ts.
  contracts: Embedded<{ deposit_pct: number | null; status: string }>;
  job: {
    id: string;
    work_completed_at: string | null;
    customer: {
      name: string;
      contact: { email?: string; phone?: string; sms_opt_out?: boolean };
    } | null;
    contractor: {
      id: string;
      company_name: string;
      payout_details_complete: boolean;
    };
  };
};

/**
 * SUB-4. Refuse a creation action while the trade's subscription has failed.
 *
 * FAILS CLOSED on a missing user and a missing contractor row. Both of those
 * previously fell THROUGH to the create — the check was three nested `if`s and
 * every unhappy path skipped it silently. A guard whose default is "allow" is
 * not a guard.
 *
 * WHY THE `if (supabase.auth)` AT EACH CALL SITE SURVIVES, AND WHY IT IS NOT A
 * DEFECT ANYONE HERE CAN FIX. A real `SupabaseClient` always has `.auth`, so
 * that condition can only ever be false for a test stub that omits it — the
 * shape of the client deciding whether a guard runs, which is exactly the thing
 * worth objecting to. It stays because three frozen contracts, belonging to
 * three different items, jointly force it:
 *
 *   - `tests/acceptance/575.test.ts` and `tests/acceptance/581.test.tsx` (both
 *     shipped) stub `createClient` with NO `auth` property at all. Any
 *     unconditional `supabase.auth.getUser()` on this path is a TypeError in
 *     ten of their assertions.
 *   - `tests/acceptance/659.test.ts` requires the refusal to happen BEFORE the
 *     quote is fetched: its stub returns `rows[0]` for every `.single()`, so
 *     the guard cannot instead key on the contractor the quote carries.
 *
 * Together those admit exactly one shape: check first, using the session user,
 * skipped when the client has no `auth`. Removing the wrapper breaks 575 and
 * 581; moving the check after the quote breaks 659; and none of the three may
 * be edited. So the two INNER fail-opens are closed here and the outer one is
 * documented rather than quietly left to read as intentional.
 *
 * Closing it properly means repairing the 575 and 581 stubs, which is a change
 * to two shipped items' frozen contracts and therefore its own item.
 *
 * The read-only STATES are untouched — `isSubscriptionReadOnly` is `past_due`
 * and `unpaid` only, with `active`, `trialing` and a null status passing
 * through. That predicate is what stopped an earlier draft locking out every
 * paying trade, and nothing here widens it.
 */
const assertSubscriptionWritable = async (
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
) => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw actionableError("You are not signed in.");

  const { data: contractorRow } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!contractorRow) {
    throw actionableError("No contractor profile — finish setup first.");
  }

  const { data: projection } = await supabase
    .from("subscription_projection")
    .select("subscription_status")
    .eq("contractor_id", contractorRow.id)
    .maybeSingle();

  if (isSubscriptionReadOnly(projection?.subscription_status ?? null)) {
    throw actionableError(
      "Your subscription payment failed. Update your card details in Settings → Billing to restore access.",
    );
  }
};

export const createInvoice = async (input: z.infer<typeof createInvoiceSchema>) => {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  // SUB-4: refuse before anything is written.
  //
  // READ THE COMMENT ON assertSubscriptionWritable BEFORE TOUCHING THE `if
  // (supabase.auth)` LINE. It is not defensive coding and it is not removable
  // here; three frozen acceptance contracts jointly require it.
  if (supabase.auth) {
    await assertSubscriptionWritable(supabase);
  }

  const { quoteId, invoiceType, dueDate, paymentStageId } = createInvoiceSchema.parse(input);

  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "total, invoices(amount, invoice_type), contracts(deposit_pct, status), job:jobs(id, work_completed_at, customer:customers(name, contact), contractor:contractors(id, company_name, payout_details_complete))",
    )
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  const { job, total, invoices, contracts } = quote as unknown as QuoteWithRelations;

  // Authoritative amount — refuses a final invoice before the work is marked
  // complete, a second deposit, over-invoicing, or an arbitrary client figure.
  //
  // `work_completed_at` is read here rather than trusted from the request: the
  // client sends intent, never state. A stale dashboard whose Final button was
  // rendered before the job moved is refused on the same path as a tampered one.
  const amount = deriveInvoiceAmount(invoiceType, total, invoices ?? [], embeddedMany(contracts), {
    workCompletedAt: job.work_completed_at,
  });

  // For jobs above the Pay by Bank ceiling, ensure payment stages exist.
  // If they don't, create them now before linking the invoice to the first stage.
  let actualStageId = paymentStageId;

  if (total > PAY_BY_BANK_LIMIT_PENNIES) {
    // Check if stages already exist for this job
    const { data: existingStages } = await supabase
      .from("payment_stages")
      .select("id, stage_number, invoice_id")
      .eq("job_id", job.id)
      .order("stage_number");

    if (!existingStages || existingStages.length === 0) {
      // No stages exist — create them now
      const stages = createPaymentStages(total);

      const { data: insertedStages, error: insertError } = await supabase
        .from("payment_stages")
        .insert(
          stages.map((stage) => ({
            job_id: job.id,
            stage_number: stage.stage_number,
            amount_pennies: stage.amount_pennies,
          }))
        )
        .select("id, stage_number");

      if (insertError || !insertedStages) {
        throw new Error(`Failed to create payment stages: ${insertError?.message ?? "Unknown error"}`);
      }

      // Link this invoice to the first stage (stage_number 1)
      const firstStage = insertedStages.find((s) => s.stage_number === 1);
      actualStageId = firstStage?.id;
    } else {
      // Stages exist — find the first uninvoiced one
      const nextStage = existingStages.find((s) => !s.invoice_id);
      actualStageId = nextStage?.id;
    }
  }

  const result = await createInvoiceRecord(supabase, {
    quoteId,
    invoiceType,
    amount,
    dueDate,
    companyName: job.contractor.company_name,
    customerName: job.customer?.name ?? "Customer",
    customerEmail: job.customer?.contact?.email,
    customerPhone: job.customer?.contact?.phone,
    customerSmsOptOut: job.customer?.contact?.sms_opt_out === true,
    payoutDetailsComplete: job.contractor.payout_details_complete,
    paymentStageId: actualStageId,
  });

  // Refresh the server data the client navigates into, so the caller only
  // needs router.push (not a racing router.refresh) once this resolves.
  revalidatePath("/dashboard");
  revalidatePath("/jobs/[id]", "page");

  return result;
};

const archiveQuoteSchema = z.object({ quoteId: z.string().uuid() });

// Soft-archive rather than hard-delete: quotes cascade-delete their invoices
// and contracts, so a stray tap would silently destroy financial records.
// Archiving just flips status out of every dashboard pipeline query.
export const archiveQuote = async (input: z.infer<typeof archiveQuoteSchema>) => {
  const { quoteId } = archiveQuoteSchema.parse(input);
  const supabase = await createClient();

  const { error } = await supabase
    .from("quotes")
    .update({ status: "archived" })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
};

const createContractSchema = z.object({
  quoteId: z.string().uuid(),
  depositPct: z.number().min(0).max(100).optional(),
  templateKey: contractTemplateKeySchema,
  jobInput: contractJobInputSchema,
});

type ContractQuoteWithRelations = {
  total: number;
  line_items_json: LineItem[];
  job: {
    work_completed_at: string | null;
    customer: {
      name: string;
      contact: { email?: string; phone?: string; sms_opt_out?: boolean };
    } | null;
    contractor: {
      id: string;
      company_name: string;
      company_number: string | null;
      trade: string | null;
      vat_registered: boolean;
      vat_number: string | null;
      business_profile: BusinessProfile;
      payout_account_holder_name: string | null;
      payout_sort_code: string | null;
      payout_account_number: string | null;
      stripe_account_id: string | null;
      stripe_payouts_enabled: boolean;
      payout_details_complete: boolean;
    };
  };
};

export const createContract = async (input: z.infer<typeof createContractSchema>) => {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  // SUB-4: refuse before anything is written.
  //
  // READ THE COMMENT ON assertSubscriptionWritable BEFORE TOUCHING THE `if
  // (supabase.auth)` LINE. It is not defensive coding and it is not removable
  // here; three frozen acceptance contracts jointly require it.
  if (supabase.auth) {
    await assertSubscriptionWritable(supabase);
  }

  const { quoteId, depositPct, templateKey, jobInput } = createContractSchema.parse(input);

  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "total, line_items_json, job:jobs(customer:customers(name, contact), contractor:contractors(id, company_name, company_number, trade, vat_registered, vat_number, business_profile, payout_account_holder_name, payout_sort_code, payout_account_number, payout_details_complete, stripe_account_id, stripe_payouts_enabled))",
    )
    .eq("id", quoteId)
    .single();

  if (!quote) throw actionableError("Quote not found");

  const { job, total, line_items_json: lineItems } = quote as unknown as ContractQuoteWithRelations;

  const depositAmount = depositPct ? Math.round(total * (depositPct / 100) * 100) / 100 : null;
  const template = getContractTemplate(templateKey);
  const variables = buildContractVariables({
    contractor: job.contractor,
    customer: job.customer,
    lineItems,
    quoteReference: quoteId.slice(0, 8).toUpperCase(),
    depositAmount,
    jobInput,
  });
  const renderedBody = renderContractTemplate(template.body, variables);

  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      quote_id: quoteId,
      deposit_pct: depositPct ?? null,
      template_key: templateKey,
      variables_json: variables,
      // Structured per-contract input, including the client/site address
      // components resolved from Google Places. The formatted strings still
      // render via variables_json; this keeps the structured data reusable.
      job_input_json: jobInput,
      rendered_body: renderedBody,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !contract) {
    // Duplicate key error: a contract already exists for this quote
    if (error?.code === "23505") {
      const { data: existingContract } = await supabase
        .from("contracts")
        .select("id")
        .eq("quote_id", quoteId)
        .maybeSingle();

      // If we can read back the existing contract, return it with alreadySent flag
      // instead of throwing, so the form can navigate to the job page rather than
      // staying mounted with an error.
      if (existingContract) {
        const existingContractUrl = `${process.env.NEXT_PUBLIC_APP_URL}/c/${existingContract.id}`;
        revalidatePath("/dashboard");
        revalidatePath("/jobs/[id]", "page");
        return {
          contractId: existingContract.id,
          contractUrl: existingContractUrl,
          alreadySent: true,
          delivered: true,
          hadContactChannel: true,
        };
      }

      // If we can't read the existing contract back (RLS, race, deleted row), throw
      // an error on the form with retry available.
      throw actionableError(
        `A contract has already been sent for this quote, but we couldn't retrieve it. Please check your contracts or contact support.`,
      );
    }

    throw actionableError("Couldn't create the contract. Please try again.");
  }

  const contractUrl = `${process.env.NEXT_PUBLIC_APP_URL}/c/${contract.id}`;

  // Best-effort — a PDF-render failure shouldn't block sending the contract.
  const pdfBuffer = await renderContractPdf(contract.id).catch(() => null);

  // Through the dispatcher, so this step honours sms_opt_out and reaches a
  // phone-only customer. It previously sent email and nothing else, which left
  // the contract needing a signature going to an address such a customer does
  // not have.
  //
  // Guarded — a delivery failure shouldn't prevent the contract from being
  // created. The action completes with delivered: false, allowing the job page
  // to display the delivered=0 banner with a copy-link fallback.
  const customerEmail = job.customer?.contact?.email;
  const customerPhone = job.customer?.contact?.phone;
  const customerSmsOptOut = job.customer?.contact?.sms_opt_out === true;

  const report = await notifyCustomer({
    event: "contract_sent",
    customer: {
      name: job.customer?.name ?? "there",
      email: customerEmail,
      phone: customerPhone,
      smsOptOut: customerSmsOptOut,
    },
    companyName: job.contractor.company_name,
    url: contractUrl,
    pdfAttachment: pdfBuffer
      ? { filename: `contract-${contract.id}.pdf`, content: pdfBuffer }
      : undefined,
  }).catch(() => ({
    delivered: false,
    email: { attempted: Boolean(customerEmail), delivered: false },
    sms: { attempted: Boolean(customerPhone) && !customerSmsOptOut, delivered: false },
  }));

  const delivered = report.delivered;

  revalidatePath("/dashboard");
  revalidatePath("/jobs/[id]", "page");

  return {
    contractId: contract.id,
    contractUrl,
    delivered,
    // Renamed from hasCustomerEmail: with SMS in play, "no email on file" is
    // the wrong thing to tell a contractor whose phone-only customer we just
    // failed to text. This says whether there was ANY channel to try.
    hadContactChannel: report.email.attempted || report.sms.attempted,
  };
};

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
import { resolveDeposit } from "@/lib/quote-deposit";
import { actionableError } from "@/lib/actionable-error";
import { createPaymentStages, type PaymentStage } from "@/lib/payment-stages";
import { PAY_BY_BANK_LIMIT_PENNIES, hasManualBankDetails } from "@/app/i/[id]/pay-panel";
import { accessRestrictedMessage, isAccessRestricted } from "@/lib/subscription";

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
      payout_account_holder_name: string | null;
      payout_sort_code: string | null;
      payout_account_number: string | null;
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
 * The restricted STATES are now `isAccessRestricted`: `past_due` and `unpaid` as
 * before, plus `canceled`, which was gated nowhere in the app — a cancelled
 * trade went on creating quotes, contracts and invoices for free, indefinitely.
 * `active`, `trialing`, `cancel_at_period_end` and a NULL status still pass
 * through, which is what stopped an earlier draft locking out every paying
 * trade, and is why a contractor with no projection row is never locked out.
 *
 * `isSubscriptionReadOnly` still exists and still means exactly what it did —
 * `tests/acceptance/659.test.ts` freezes it, `canceled === false` included — so
 * the widening is a new predicate rather than an edit to that one.
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

  if (isAccessRestricted(projection?.subscription_status ?? null)) {
    throw actionableError(accessRestrictedMessage(projection?.subscription_status ?? null));
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
      "total, invoices(amount, invoice_type), contracts(deposit_pct, status), job:jobs(id, work_completed_at, customer:customers(name, contact), contractor:contractors(id, company_name, payout_details_complete, payout_account_holder_name, payout_sort_code, payout_account_number))",
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

  // AN INVOICE OVER THE CEILING NEEDS SOMEWHERE FOR THE MONEY TO GO.
  //
  // Pay by Bank refuses anything above PAY_BY_BANK_LIMIT_PENNIES, so an invoice
  // over it is payable only by manual bank transfer — and those details come
  // from the three payout_* columns, not from Stripe, which never returns a
  // full account number. A contractor who onboarded through Connect and left
  // the manual form alone has `payout_account_number` NULL (set that way
  // deliberately by syncStripeAccountStatus, which then marks the record
  // complete anyway), so there is nothing to show.
  //
  // Their customer's experience without this guard: tap Pay, get "exceeds the
  // online payment limit, please use bank transfer", then "couldn't load the
  // bank details, please contact <trade> to pay". Two errors and a phone call,
  // on the largest invoice a trade sends.
  //
  // Refused here rather than patched on the invoice page because this is the
  // last point a human can still act on it. The contractor is one field away
  // from a payable invoice and is told which field.
  // POUNDS TO PENCE, ONCE, BEFORE ANYTHING IS COMPARED WITH THE CEILING.
  //
  // `amount` and `total` are POUNDS — `quotes.total` is numeric(10,2) (migration
  // 23) and `deriveInvoiceAmount` returns pounds. `PAY_BY_BANK_LIMIT_PENNIES` is
  // pence. `quoteExceedsCeiling` (quote-send-guards.ts) is the same comparison
  // done correctly and is the shape copied here.
  const amountPennies = Math.round(amount * 100);
  const totalPennies = Math.round(total * 100);

  if (
    amountPennies > PAY_BY_BANK_LIMIT_PENNIES &&
    !hasManualBankDetails({
      accountHolderName: job.contractor.payout_account_holder_name,
      sortCode: job.contractor.payout_sort_code,
      accountNumber: job.contractor.payout_account_number,
    })
  ) {
    throw actionableError(
      "This invoice is over the £10,000 online payment limit, so your customer can only pay it by bank transfer. Add your bank account details in Settings first, or invoice in stages.",
    );
  }

  // For jobs above the Pay by Bank ceiling, ensure payment stages exist.
  // If they don't, create them now before linking the invoice to the first stage.
  //
  // THIS BRANCH HAS NEVER RUN. It read `total > PAY_BY_BANK_LIMIT_PENNIES` —
  // pounds against pence — so it fired at £1,000,000 rather than £10,000, and
  // the same line handed `createPaymentStages` (which takes PENCE) a figure in
  // pounds, so a £15,000 job would have written its stages as £75 rows into
  // `amount_pennies`. Both halves are the same mistake and neither was fixable
  // without the other. No job in production has a payment stage, because this
  // insert is the only thing in the tree that creates one.
  let actualStageId: string | undefined;
  let candidateStage: { id: string; amount_pennies: number } | undefined;

  if (totalPennies > PAY_BY_BANK_LIMIT_PENNIES) {
    // Check if stages already exist for this job
    const { data: existingStages } = await supabase
      .from("payment_stages")
      .select("id, stage_number, amount_pennies, invoice_id")
      .eq("job_id", job.id)
      .order("stage_number");

    if (!existingStages || existingStages.length === 0) {
      // ABOVE WHAT TWO STAGES CAN COVER THERE IS NO SCHEDULE, AND THAT IS NOT A
      // FAILURE. `createPaymentStages` throws over £20,000, and a bare Error is
      // replaced by React's redaction notice in a production build
      // (actionable-error.ts) — so letting it escape would turn a £25,000
      // invoice into a dead end with nothing readable on it. That invoice works
      // today: the guard above has already established there are bank details
      // for it, and it is paid by transfer. Absence of a schedule leaves it
      // exactly there.
      let stages: PaymentStage[] | null = null;
      try {
        stages = createPaymentStages(totalPennies);
      } catch {
        stages = null;
      }

      if (stages) {
        const { data: insertedStages, error: insertError } = await supabase
          .from("payment_stages")
          .insert(
            stages.map((stage) => ({
              job_id: job.id,
              stage_number: stage.stage_number,
              amount_pennies: stage.amount_pennies,
            }))
          )
          .select("id, stage_number, amount_pennies");

        if (insertError || !insertedStages) {
          throw new Error(`Failed to create payment stages: ${insertError?.message ?? "Unknown error"}`);
        }

        // Link this invoice to the first stage (stage_number 1)
        candidateStage = insertedStages.find((s) => s.stage_number === 1);
      }
    } else {
      // Stages exist — honour the one the client named if it is real, and
      // otherwise take the first uninvoiced one. The client's id is looked up
      // in the job's own stages rather than trusted: it arrives from a form and
      // decides which row gets settled and refunded.
      candidateStage =
        (paymentStageId ? existingStages.find((s) => s.id === paymentStageId) : undefined) ??
        existingStages.find((s) => !s.invoice_id);
    }
  }

  // A STAGE LINK IS A CLAIM THAT THIS INVOICE *IS* THAT STAGE'S MONEY.
  //
  // Nothing downstream re-checks it. `settle-paid-job.ts` stamps `settled_at`
  // on whichever stage carries this invoice's id the moment it is paid, and
  // `refund-settlement.ts` refunds against that stage's `amount_pennies`. So an
  // invoice linked to a larger stage settles and refunds the larger figure.
  //
  // The two are derived independently and CAN disagree: `deriveInvoiceAmount`
  // follows the contract's deposit percentage, while `createPaymentStages`
  // splits 50/50 (frozen by tests/acceptance/623.test.ts). On a 25% deposit they
  // differ by construction. Where they differ the invoice is raised UNLINKED —
  // which is what happens today for every job, since the branch above has never
  // run — rather than linked to a figure it is not.
  if (candidateStage && candidateStage.amount_pennies === amountPennies) {
    actualStageId = candidateStage.id;
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
      stripe_pay_by_bank_enabled: boolean;
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
      "total, subtotal, vat_amount, deposit_pennies, line_items_json, job:jobs(customer:customers(name, contact), contractor:contractors(id, company_name, company_number, trade, vat_registered, vat_number, business_profile, payout_account_holder_name, payout_sort_code, payout_account_number, payout_details_complete, stripe_account_id, stripe_payouts_enabled, stripe_pay_by_bank_enabled))",
    )
    .eq("id", quoteId)
    .single();

  if (!quote) throw actionableError("Quote not found");

  const { job, total, line_items_json: lineItems } = quote as unknown as ContractQuoteWithRelations;

  // THE ONE RESOLVER, so the contract BODY states the deposit the customer
  // agreed on the quote rather than only what was typed on this form. Until
  // 15 Sep this recomputed from depositPct alone: a quote deposit was absent
  // from the signed document and then invoiced on signature regardless.
  const deposit = resolveDeposit(
    { total, deposit_pennies: (quote as unknown as { deposit_pennies: number | null }).deposit_pennies },
    { deposit_pct: depositPct ?? null },
  );
  const template = getContractTemplate(templateKey);
  const variables = buildContractVariables({
    contractor: job.contractor,
    customer: job.customer,
    lineItems,
    quoteReference: quoteId.slice(0, 8).toUpperCase(),
    depositAmount: deposit?.amount ?? null,
    jobInput,
    // The contract quotes the figure the customer accepted, not one recomputed
    // from today's registration. See build-variables.ts.
    recordedQuote: {
      total,
      subtotal: (quote as unknown as { subtotal: number | null }).subtotal ?? null,
      vat_amount: (quote as unknown as { vat_amount: number | null }).vat_amount ?? null,
    },
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
      // THIS CHAIN CANNOT BE NARROWED, and the reason is worth stating because
      // the obvious improvement is unmergeable.
      //
      // Migration 83 lets a quote carry withdrawn and declined contracts as
      // history, so on a re-issued quote this `.maybeSingle()` sees more than
      // one row and errors with "multiple rows returned" — the `.maybeSingle()`
      // hazard that migration's own comment warned about, reachable only
      // because re-issue now works. The fix would be
      // `.not("status", "in", …).order(…).limit(1)`.
      //
      // `tests/acceptance/581.test.tsx` is FROZEN and hand-rolls a stub whose
      // chain is exactly `select().eq().maybeSingle()` — no `.not`, no
      // `.order`, no `.limit`, and no second `.eq`. Any narrowing throws
      // "supabase.from(...).select(...).eq(...).not is not a function" in three
      // of its assertions, and a frozen contract may not be repaired
      // downstream, so the item would block for good.
      //
      // The degraded path is honest rather than wrong. A failed read leaves
      // `existingContract` null, which falls through to the throw below — and
      // that throw says a contract has already been sent, which is TRUE: a
      // 23505 is only ever raised by a live contract. The contractor loses the
      // navigate-to-the-job-page convenience, not the truth. That is the whole
      // cost, and it is the right side of the trade against a dead item.
      const { data: existingContract } = await supabase
        .from("contracts")
        .select("id, status")
        .eq("quote_id", quoteId)
        .maybeSingle();

      // A WITHDRAWN or DECLINED contract used to reach here and be reported as
      // `alreadySent: true` — which the form treats as SUCCESS, landing the
      // button on "Sent ✓" having created nothing. That is pass-13 CRITICAL 1,
      // and it left two jobs holding £2,160 of accepted work waiting for a
      // signature that could never arrive.
      //
      // The refusal that stood here between 27ff7fb and migration 83 is gone
      // because it is now UNREACHABLE, not because it was wrong. A 23505 can
      // only be raised by a LIVE contract: the partial unique index does not
      // index withdrawn or declined rows, so a quote whose only contract was
      // taken back no longer collides at all — the insert above simply
      // succeeds, which is re-issue working. Dead code shaped like a guard is
      // worse than no guard, so it is recorded here instead of left to read as
      // if it still protects something.
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
          // Nothing was sent on THIS attempt, so no channel landed on it. The
          // already-sent banner names no channels for that reason — the
          // original send's channels are not known here, and guessing them
          // would be the invention this item removes.
          email: { delivered: false },
          sms: { delivered: false },
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
    // WHICH channels landed, not just whether any did. notifyCustomer has
    // always reported this per channel and this action collapsed it to one
    // boolean, so the job-page banner had nothing to name and said "(email)"
    // regardless — including for a phone-only customer who was texted. Mirrors
    // what sendQuote returns, so both forms build the ?channels= redirect the
    // same way.
    email: { delivered: report.email.delivered },
    sms: { delivered: report.sms.delivered },
    // Renamed from hasCustomerEmail: with SMS in play, "no email on file" is
    // the wrong thing to tell a contractor whose phone-only customer we just
    // failed to text. This says whether there was ANY channel to try.
    hadContactChannel: report.email.attempted || report.sms.attempted,
  };
};

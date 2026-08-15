import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe-client";

const PAY_BY_BANK_LIMIT_PENNIES = 10_000_00;

type InvoiceRow = {
  id: string;
  amount: number;
  status: string;
  quote: {
    job: {
      id: string;
      contractor: {
        id: string;
        stripe_account_id: string | null;
        stripe_charges_enabled: boolean;
      } | null;
    } | null;
  } | null;
};

export const POST = async (request: NextRequest) => {
  let stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  let invoiceId: string | undefined;
  try {
    const json = (await request.json()) as { invoiceId?: string };
    invoiceId = json.invoiceId;
  } catch {
    // fall through to missing-id check
  }
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select(
      "id, amount, status, quote:quotes(job:jobs(id, contractor:contractors(id, stripe_account_id, stripe_charges_enabled)))",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  const invoice = data as unknown as InvoiceRow | null;
  const job = invoice?.quote?.job;
  const contractor = job?.contractor;
  if (!invoice || !job || !contractor) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (invoice.status !== "sent") {
    return NextResponse.json({ error: "Invoice is not payable" }, { status: 409 });
  }

  if (!contractor.stripe_account_id || !contractor.stripe_charges_enabled) {
    return NextResponse.json(
      { error: "Contractor has not completed payout setup" },
      { status: 409 },
    );
  }

  const amountPennies = Math.round(invoice.amount * 100);
  if (amountPennies > PAY_BY_BANK_LIMIT_PENNIES) {
    return NextResponse.json(
      { error: "Amount exceeds Pay by Bank limit", code: "AMOUNT_TOO_HIGH" },
      { status: 422 },
    );
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountPennies,
      currency: "gbp",
      payment_method_types: ["customer_balance"],
      payment_method_data: {
        type: "customer_balance",
      },
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer",
          bank_transfer: {
            type: "gb_bank_transfer",
          },
        },
      },
      transfer_data: {
        destination: contractor.stripe_account_id,
      },
      application_fee_amount: 0,
      metadata: {
        invoice_id: invoice.id,
        job_id: job.id,
        contractor_id: contractor.id,
      },
    });

    await admin
      .from("invoices")
      .update({ truelayer_payment_id: paymentIntent.id })
      .eq("id", invoice.id);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      publishableKey,
    });
  } catch (err) {
    console.error("Failed to create Payment Intent:", err);
    return NextResponse.json(
      { error: "Couldn't start the payment. Please try again." },
      { status: 502 },
    );
  }
};

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { draftChaseMessage } from "@/lib/chase";
import {
  planChase,
  MAX_CONTACT_WAVES,
  CHASE_CAP_CHANNEL,
  CHASE_CAP_TEMPLATE,
} from "@/lib/chase-plan";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { sendChaseEmail } from "@/lib/email";
import { sendChaseSms } from "@/lib/sms";
import { rejectUnauthorizedCron } from "@/lib/cron-auth";

type InvoiceWithRelations = {
  id: string;
  amount: number;
  due_date: string | null;
  quote: {
    job: {
      id: string;
      customer: {
        name: string;
        contact: { email?: string; phone?: string; sms_opt_out?: boolean };
      } | null;
      contractor: { company_name: string };
    } | null;
  } | null;
  chase_events: { channel: string; template_used: string | null }[];
};

export const GET = async (request: NextRequest) => {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminClient();
  // Only 'sent' invoices are ever chased. A settlement (on- or off-rails) flips
  // the invoice to 'paid', so it drops out of this query — that is how any
  // settlement halts the sequence immediately, even mid-way through it.
  const { data: invoicesRaw } = await admin
    .from("invoices")
    .select(
      "id, amount, due_date, quote:quotes(job:jobs(id, customer:customers(name, contact), contractor:contractors(company_name))), chase_events(channel, template_used)",
    )
    .eq("status", "sent")
    .not("due_date", "is", null);

  const invoices = (invoicesRaw ?? []) as unknown as InvoiceWithRelations[];
  const now = Date.now();
  let sent = 0;
  let capped = 0;

  for (const invoice of invoices) {
    const job = invoice.quote?.job;
    if (!job) continue;

    const plan = planChase(invoice.due_date, invoice.chase_events, now);
    if (plan.action === "none") continue;

    // Hard cap reached: stop contacting the customer for good, record a one-time
    // marker so the timeline can show reminders stopped, and nudge the trade to
    // take it from here. Never sends anything to the customer.
    if (plan.action === "cap") {
      await admin.from("chase_events").insert({
        invoice_id: invoice.id,
        channel: CHASE_CAP_CHANNEL,
        template_used: CHASE_CAP_TEMPLATE,
      });
      const customerName = job.customer?.name ?? "your customer";
      await notifyContractorOfCustomerAction(admin, {
        jobId: job.id,
        event: "chase_stopped",
        subject: `Payment reminders to ${customerName} have stopped`,
        heading: `We've stopped chasing ${customerName} after ${MAX_CONTACT_WAVES} reminders.`,
        nextStep:
          "Nothing more will be sent automatically. Give them a call, or mark the invoice as paid if they've settled up off-app.",
      });
      capped += 1;
      continue;
    }

    const { template, daysOverdue } = plan;
    const contact = job.customer?.contact;
    const email = contact?.email;
    const phone = contact?.phone;

    // Per-channel dedup: a given wave goes out at most once on each channel, so a
    // customer with both email and SMS still gets one of each per wave, and a
    // retried run never double-sends the same channel.
    const alreadySent = (channel: string) =>
      invoice.chase_events.some((e) => e.channel === channel && e.template_used === template);

    const canEmail = Boolean(email) && !alreadySent("email");
    const canSms = Boolean(phone) && contact?.sms_opt_out !== true && !alreadySent("sms");
    if (!canEmail && !canSms) continue;

    const body = await draftChaseMessage({
      companyName: job.contractor.company_name,
      customerName: job.customer!.name,
      amount: invoice.amount,
      daysOverdue,
    });

    if (canEmail) {
      const { delivered } = await sendChaseEmail({
        to: email as string,
        companyName: job.contractor.company_name,
        body,
        paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/i/${invoice.id}`,
      });
      if (delivered) {
        await admin
          .from("chase_events")
          .insert({ invoice_id: invoice.id, channel: "email", template_used: template });
        sent += 1;
      }
    }

    if (canSms) {
      const { delivered } = await sendChaseSms({
        to: phone as string,
        companyName: job.contractor.company_name,
        body,
        paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/i/${invoice.id}`,
      });
      if (delivered) {
        await admin
          .from("chase_events")
          .insert({ invoice_id: invoice.id, channel: "sms", template_used: template });
        sent += 1;
      }
    }
  }

  return NextResponse.json({ sent, capped });
};

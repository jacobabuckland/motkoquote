import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { draftChaseMessage } from "@/lib/chase";
import { sendChaseEmail } from "@/lib/email";
import { sendChaseSms } from "@/lib/sms";

const CHASE_DAYS = [3, 7, 14] as const;

type InvoiceWithRelations = {
  id: string;
  amount: number;
  due_date: string | null;
  stripe_payment_link_url: string | null;
  quote: {
    job: {
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
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: invoicesRaw } = await admin
    .from("invoices")
    .select(
      "id, amount, due_date, stripe_payment_link_url, quote:quotes(job:jobs(customer:customers(name, contact), contractor:contractors(company_name))), chase_events(channel, template_used)",
    )
    .eq("status", "sent")
    .not("due_date", "is", null);

  const invoices = (invoicesRaw ?? []) as unknown as InvoiceWithRelations[];
  const now = Date.now();
  let sent = 0;

  for (const invoice of invoices) {
    const dueDate = new Date(invoice.due_date as string).getTime();
    const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
    const bucket = [...CHASE_DAYS].filter((d) => daysOverdue >= d).pop();
    if (!bucket) continue;

    const template = `day_${bucket}`;
    const job = invoice.quote?.job;
    const contact = job?.customer?.contact;
    const email = contact?.email;
    const phone = contact?.phone;
    if (!job) continue;

    // Per-channel dedup: a given template goes out at most once on each channel,
    // so a customer with both email and SMS still gets one of each per bucket,
    // and a retried run never double-sends the same channel.
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
        paymentUrl: invoice.stripe_payment_link_url,
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
        paymentUrl: invoice.stripe_payment_link_url,
      });
      if (delivered) {
        await admin
          .from("chase_events")
          .insert({ invoice_id: invoice.id, channel: "sms", template_used: template });
        sent += 1;
      }
    }
  }

  return NextResponse.json({ sent });
};

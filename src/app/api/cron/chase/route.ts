import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { draftChaseMessage } from "@/lib/chase";
import { sendChaseEmail } from "@/lib/email";
import { logError } from "@/lib/errors";

const CHASE_DAYS = [3, 7, 14] as const;

type InvoiceWithRelations = {
  id: string;
  amount: number;
  due_date: string | null;
  stripe_payment_link_url: string | null;
  quote: {
    job: {
      customer: { name: string; contact: { email?: string } } | null;
      contractor: { company_name: string };
    } | null;
  } | null;
  chase_events: { template_used: string | null }[];
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
      "id, amount, due_date, stripe_payment_link_url, quote:quotes(job:jobs(customer:customers(name, contact), contractor:contractors(company_name))), chase_events(template_used)",
    )
    .eq("status", "sent")
    .not("due_date", "is", null);

  const invoices = (invoicesRaw ?? []) as unknown as InvoiceWithRelations[];
  const now = Date.now();
  let sent = 0;

  for (const invoice of invoices) {
    try {
      const dueDate = new Date(invoice.due_date as string).getTime();
      const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
      const bucket = [...CHASE_DAYS].filter((d) => daysOverdue >= d).pop();
      if (!bucket) continue;

      const template = `day_${bucket}`;
      const alreadySent = invoice.chase_events.some((e) => e.template_used === template);
      if (alreadySent) continue;

      const job = invoice.quote?.job;
      const email = job?.customer?.contact?.email;
      if (!job || !email) continue;

      const body = await draftChaseMessage({
        companyName: job.contractor.company_name,
        customerName: job.customer!.name,
        amount: invoice.amount,
        daysOverdue,
      });

      const { delivered } = await sendChaseEmail({
        to: email,
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
    } catch (error) {
      await logError("chase_cron", error, { context: { invoice_id: invoice.id } });
    }
  }

  return NextResponse.json({ sent });
};

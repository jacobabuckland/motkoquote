"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planManualReminder } from "@/lib/manual-reminder";
import { type ChaseEventRow } from "@/lib/chase-plan";
import { daysOverdue as londonDaysOverdue } from "@/lib/overdue";
import { sendChaseEmail } from "@/lib/email";
import { sendChaseSms } from "@/lib/sms";

const schema = z.object({ invoiceId: z.string().uuid() });

export type SendReminderResult =
  | { ok: true; wavesRemaining: number }
  | { error: string };

// Same terminal states the cron refuses to chase into. Kept in step with
// api/cron/chase/route.ts on purpose: a manual reminder must not reach a
// customer the automated sequence has already been told to leave alone.
const UNCHASEABLE_QUOTE_STATUSES = new Set(["archived", "declined"]);

/**
 * Sends the next scheduled reminder wave NOW, at the contractor's request.
 *
 * It spends a wave rather than adding one — see lib/manual-reminder.ts for why
 * that is the whole design. Everything else here is the cron's own refusal
 * list, applied to a human-initiated send:
 *
 *   - ownership, via RLS on the user-scoped client
 *   - the invoice is still 'sent' (a settled one drops out of chasing)
 *   - the parent job is not archived, the parent quote not archived/declined
 *   - the invoice is actually overdue
 *   - the cap, counted JOB-WIDE the way the cron counts it — not per invoice
 *
 * The cap check is re-derived here rather than trusted from the page. A page
 * rendered before another wave went out would otherwise let a trade spend a
 * wave that no longer exists.
 */
export const sendReminderNow = async (
  input: { invoiceId: string },
): Promise<SendReminderResult> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Something looks off — try again." };
  const { invoiceId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in and try again." };

  // Ownership via RLS: this select only returns invoices on the trade's own
  // jobs, so a missing row is refused without distinguishing "not yours" from
  // "not there".
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, amount, status, due_date, quote:quotes(status, job:jobs(id, archived_at, customer:customers(name, contact), contractor:contractors(company_name)))",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return { error: "We couldn't find that invoice." };

  const quote = invoice.quote as unknown as {
    status: string;
    job: {
      id: string;
      archived_at: string | null;
      customer: {
        name: string;
        contact: { email?: string; phone?: string; sms_opt_out?: boolean };
      } | null;
      contractor: { company_name: string } | null;
    } | null;
  } | null;
  const job = quote?.job ?? null;

  if (invoice.status !== "sent") return { error: "This invoice isn't awaiting payment." };
  if (!job || !job.customer || !job.contractor) {
    return { error: "We couldn't find that invoice." };
  }
  if (job.archived_at) return { error: "This job is archived." };
  if (quote && UNCHASEABLE_QUOTE_STATUSES.has(quote.status)) {
    return { error: "This job is no longer live." };
  }
  if (!invoice.due_date) return { error: "This invoice has no due date yet." };

  const overdueBy = londonDaysOverdue(invoice.due_date, Date.now());
  if (overdueBy < 1) {
    return { error: "This invoice isn't overdue yet." };
  }

  const admin = createAdminClient();

  // The cap, job-wide. The cron's primary check counts distinct waves across
  // every invoice AND payment stage on the job, so this must too — counting
  // only this invoice's events would let a staged job send more than four.
  const [{ data: jobInvoices }, { data: jobStages }] = await Promise.all([
    admin
      .from("invoices")
      .select("id, quote_id, quotes!inner(job_id), chase_events(channel, template_used)")
      .eq("quotes.job_id", job.id),
    admin
      .from("payment_stages")
      .select("id, chase_events(channel, template_used)")
      .eq("job_id", job.id),
  ]);

  const events: ChaseEventRow[] = [
    ...((jobInvoices ?? []) as { chase_events: ChaseEventRow[] }[]).flatMap(
      (row) => row.chase_events ?? [],
    ),
    ...((jobStages ?? []) as { chase_events: ChaseEventRow[] }[]).flatMap(
      (row) => row.chase_events ?? [],
    ),
  ];

  const plan = planManualReminder(events);
  if (plan.action === "none") {
    return {
      error: `We've already sent ${job.customer.name.split(" ")[0]} every reminder. Give them a call.`,
    };
  }

  const contact = job.customer.contact ?? {};
  const email = contact.email;
  const phone = contact.phone;
  const canSms = Boolean(phone) && contact.sms_opt_out !== true;
  if (!email && !canSms) {
    return { error: "We have no email or phone number for this customer." };
  }

  // Imported HERE, not at module scope. lib/chase.ts constructs an Anthropic
  // client as a top-level side effect, and this action is reachable from a
  // "use client" button — so a static import drags the SDK into the job page's
  // module graph and throws the moment that graph is loaded outside a server
  // runtime. The cron route defers lib/cron-auth the same way.
  const { draftChaseMessage } = await import("@/lib/chase");
  const body = await draftChaseMessage({
    companyName: job.contractor.company_name,
    customerName: job.customer.name,
    amount: invoice.amount,
    daysOverdue: overdueBy,
  });

  const paymentUrl = `${process.env.NEXT_PUBLIC_APP_URL}/i/${invoice.id}`;

  // Claim before sending, exactly as the cron does: the insert either wins or
  // hits the unique index because a cron run already owns this wave. That is
  // what stops a tap and a cron run double-sending the same template.
  const claim = async (channel: string): Promise<boolean> => {
    const { error } = await admin
      .from("chase_events")
      .insert({ invoice_id: invoice.id, channel, template_used: plan.template });
    return !error;
  };
  const releaseClaim = async (channel: string): Promise<void> => {
    await admin
      .from("chase_events")
      .delete()
      .eq("invoice_id", invoice.id)
      .eq("channel", channel)
      .eq("template_used", plan.template);
  };

  let delivered = 0;
  if (email && (await claim("email"))) {
    const res = await sendChaseEmail({
      to: email,
      companyName: job.contractor.company_name,
      body,
      paymentUrl,
      payEnabled: true,
    });
    if (res.delivered) delivered += 1;
    else await releaseClaim("email");
  }

  if (canSms && (await claim("sms"))) {
    const res = await sendChaseSms({
      to: phone as string,
      companyName: job.contractor.company_name,
      body,
      paymentUrl,
      payEnabled: true,
    });
    if (res.delivered) delivered += 1;
    else await releaseClaim("sms");
  }

  // Nothing reached the customer and every claim has been released, so the wave
  // is still available — the cron will take it on its own day. Say so plainly
  // rather than reporting a send that did not happen.
  if (delivered === 0) {
    return { error: "We couldn't get the reminder out. Try again in a minute." };
  }

  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/dashboard");

  return { ok: true, wavesRemaining: plan.wavesRemaining };
};

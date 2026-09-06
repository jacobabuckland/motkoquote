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
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

type InvoiceWithRelations = {
  id: string;
  amount: number;
  due_date: string | null;
  quote: {
    status: string;
    job: {
      id: string;
      archived_at: string | null;
      customer: {
        name: string;
        contact: { email?: string; phone?: string; sms_opt_out?: boolean };
      } | null;
      contractor: { company_name: string };
    } | null;
  } | null;
  chase_events: { channel: string; template_used: string | null }[];
};

type StageWithRelations = {
  id: string;
  job_id: string;
  stage_number: number;
  amount_pennies: number;
  due_date: string | null;
  invoice_id: string | null;
  settled_at: string | null;
  job: {
    id: string;
    archived_at: string | null;
    quote: { status: string };
    customer: {
      name: string;
      contact: { email?: string; phone?: string; sms_opt_out?: boolean };
    };
    contractor: { company_name: string };
  };
  chase_events: { channel: string; template_used: string | null }[];
};

// M8 (#7) — a chase only makes sense while the deal is live. Once the parent
// quote is archived (contractor filed it away) or declined, its invoices must
// drop out of the sequence: chasing a customer over an archived job is exactly
// the bug we're closing. 'accepted' is the normal chaseable state; we exclude by
// the terminal states so a future status doesn't silently stop chasing.
const UNCHASEABLE_QUOTE_STATUSES = new Set(["archived", "declined"]);

export const GET = async (request: NextRequest) => {
  const { rejectUnauthorizedCron } = await import("@/lib/cron-auth");
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminClient();
  // Run lock: if an overlapping run holds it, no-op. At-most-once per wave is
  // already guaranteed by the chase_events unique index (claim-before-send
  // below); this just avoids two runs racing over the same invoices at all.
  const locked = await acquireCronLock(admin, "chase");
  if (!locked) return NextResponse.json({ sent: 0, capped: 0, skipped: "locked" });

  try {
    // Only 'sent' invoices are ever chased. A settlement (on- or off-rails) flips
    // the invoice to 'paid', so it drops out of this query — that is how any
    // settlement halts the sequence immediately, even mid-way through it.
    const { data: invoicesRaw } = await admin
      .from("invoices")
      .select(
        "id, amount, due_date, quote:quotes(status, job:jobs(id, archived_at, customer:customers(name, contact), contractor:contractors(company_name))), chase_events(channel, template_used)",
      )
      .eq("status", "sent")
      .not("due_date", "is", null);

    const invoices = (invoicesRaw ?? []) as unknown as InvoiceWithRelations[];

    // Load unsettled payment stages with due dates. Stages with invoice_id are
    // excluded here because they're already chased via the invoice path above.
    const { data: stagesRaw } = await admin
      .from("payment_stages")
      .select(
        "id, job_id, stage_number, amount_pennies, due_date, invoice_id, settled_at, job:jobs(id, archived_at, quote:quotes(status), customer:customers(name, contact), contractor:contractors(company_name)), chase_events(channel, template_used)",
      )
      .not("due_date", "is", null);

    const stages = (stagesRaw ?? []) as unknown as StageWithRelations[];

    const now = Date.now();
    let sent = 0;
    let capped = 0;

    // Claim a (channel, wave) before dispatching. The insert either wins (this
    // run owns the send) or hits the unique index (another run already owns it —
    // skip). This is what makes overlapping runs send exactly once instead of the
    // in-memory check racing itself.
    const claim = async (
      invoiceId: string,
      channel: string,
      template: string,
    ): Promise<boolean> => {
      const { error } = await admin
        .from("chase_events")
        .insert({ invoice_id: invoiceId, channel, template_used: template });
      return !error;
    };
    // Compensating release: if the send itself fails after we claimed, drop the
    // claim so a later run can retry the wave (otherwise the unique index would
    // wedge it shut forever on a transient delivery blip).
    const releaseClaim = async (
      invoiceId: string,
      channel: string,
      template: string,
    ): Promise<void> => {
      await admin
        .from("chase_events")
        .delete()
        .eq("invoice_id", invoiceId)
        .eq("channel", channel)
        .eq("template_used", template);
    };

    // Stage-specific claim/release: same as above but for stage_id instead of invoice_id
    const claimStage = async (
      stageId: string,
      channel: string,
      template: string,
    ): Promise<boolean> => {
      const { error } = await admin
        .from("chase_events")
        .insert({ stage_id: stageId, channel, template_used: template });
      return !error;
    };

    const releaseClaimStage = async (
      stageId: string,
      channel: string,
      template: string,
    ): Promise<void> => {
      await admin
        .from("chase_events")
        .delete()
        .eq("stage_id", stageId)
        .eq("channel", channel)
        .eq("template_used", template);
    };

    // Whether the invoice link can promise one-tap pay-by-bank. Always true now
    // that Stripe Pay by Bank is the active payment provider (PAY-2/PAY-3).
    const payEnabled = true;

    for (const invoice of invoices) {
      // M8: never chase an invoice whose parent quote has been archived/declined.
      if (invoice.quote && UNCHASEABLE_QUOTE_STATUSES.has(invoice.quote.status)) continue;

      const job = invoice.quote?.job;
      if (!job) continue;

      // JOB-1: never chase an invoice whose parent job is archived. Archiving
      // stops automated customer chasing immediately, even mid-sequence.
      if (job.archived_at) continue;

      const plan = planChase(invoice.due_date, invoice.chase_events, now);
      if (plan.action === "none") continue;

      // Hard cap reached: stop contacting the customer for good, record a one-time
      // marker so the timeline can show reminders stopped, and nudge the trade to
      // take it from here. Never sends anything to the customer. The marker claim
      // is idempotent under the unique index, so only the first run notifies.
      if (plan.action === "cap") {
        const wonCap = await claim(invoice.id, CHASE_CAP_CHANNEL, CHASE_CAP_TEMPLATE);
        if (!wonCap) continue;
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

      // Fast-path per-channel dedup off the rows we already loaded, so a settled
      // wave costs no insert. The claim below is the authoritative guard against a
      // concurrent run.
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

      let waveSent = false;
      if (canEmail && (await claim(invoice.id, "email", template))) {
        const { delivered } = await sendChaseEmail({
          to: email as string,
          companyName: job.contractor.company_name,
          body,
          paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/i/${invoice.id}`,
          payEnabled,
        });
        if (delivered) {
          sent += 1;
          waveSent = true;
        } else await releaseClaim(invoice.id, "email", template);
      }

      if (canSms && (await claim(invoice.id, "sms", template))) {
        const { delivered } = await sendChaseSms({
          to: phone as string,
          companyName: job.contractor.company_name,
          body,
          paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/i/${invoice.id}`,
          payEnabled,
        });
        if (delivered) {
          sent += 1;
          waveSent = true;
        } else await releaseClaim(invoice.id, "sms", template);
      }

      // After sending, check if we just sent the final wave and should insert the
      // cap marker immediately. This happens when we've sent the 4th distinct wave.
      if (waveSent) {
        const wavesSentCount = new Set(
          invoice.chase_events
            .filter((e) => e.channel === "email" || e.channel === "sms")
            .map((e) => e.template_used),
        ).size + 1;
        if (wavesSentCount >= MAX_CONTACT_WAVES) {
          const wonCap = await claim(invoice.id, CHASE_CAP_CHANNEL, CHASE_CAP_TEMPLATE);
          if (wonCap) {
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
          }
        }
      }
    }

    // Process payment stages: chase unsettled stages that have a due date and no
    // invoice (stages with invoices are already chased via the invoice path).
    for (const stage of stages) {
      // Skip stages that already have an invoice — they're chased via the invoice
      if (stage.invoice_id) continue;

      // Skip settled stages — settled_at not null means paid
      if (stage.settled_at) continue;

      // Never chase a stage whose job is archived (matches invoice rule)
      if (stage.job.archived_at) continue;

      // Never chase a stage whose quote is declined/archived (matches invoice rule)
      if (UNCHASEABLE_QUOTE_STATUSES.has(stage.job.quote.status)) continue;

      const plan = planChase(stage.due_date, stage.chase_events, now);
      if (plan.action === "none") continue;

      // Hard cap reached for this stage
      if (plan.action === "cap") {
        const wonCap = await claimStage(stage.id, CHASE_CAP_CHANNEL, CHASE_CAP_TEMPLATE);
        if (!wonCap) continue;
        const customerName = stage.job.customer?.name ?? "your customer";
        await notifyContractorOfCustomerAction(admin, {
          jobId: stage.job.id,
          event: "chase_stopped",
          subject: `Payment reminders to ${customerName} have stopped`,
          heading: `We've stopped chasing ${customerName} after ${MAX_CONTACT_WAVES} reminders.`,
          nextStep:
            "Nothing more will be sent automatically. Give them a call, or mark the payment as received if they've settled up off-app.",
        });
        capped += 1;
        continue;
      }

      const { template, daysOverdue } = plan;
      const contact = stage.job.customer?.contact;
      const email = contact?.email;
      const phone = contact?.phone;

      const alreadySent = (channel: string) =>
        stage.chase_events.some((e) => e.channel === channel && e.template_used === template);

      const canEmail = Boolean(email) && !alreadySent("email");
      const canSms = Boolean(phone) && contact?.sms_opt_out !== true && !alreadySent("sms");
      if (!canEmail && !canSms) continue;

      const body = await draftChaseMessage({
        companyName: stage.job.contractor.company_name,
        customerName: stage.job.customer.name,
        amount: stage.amount_pennies,
        daysOverdue,
      });

      let waveSent = false;
      if (canEmail && (await claimStage(stage.id, "email", template))) {
        const { delivered } = await sendChaseEmail({
          to: email as string,
          companyName: stage.job.contractor.company_name,
          body,
          paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/s/${stage.id}`,
          payEnabled,
        });
        if (delivered) {
          sent += 1;
          waveSent = true;
        } else await releaseClaimStage(stage.id, "email", template);
      }

      if (canSms && (await claimStage(stage.id, "sms", template))) {
        const { delivered } = await sendChaseSms({
          to: phone as string,
          companyName: stage.job.contractor.company_name,
          body,
          paymentUrl: `${process.env.NEXT_PUBLIC_APP_URL}/s/${stage.id}`,
          payEnabled,
        });
        if (delivered) {
          sent += 1;
          waveSent = true;
        } else await releaseClaimStage(stage.id, "sms", template);
      }

      // After sending, check if we just sent the final wave and should insert the
      // cap marker immediately. This happens when we've sent the 4th distinct wave.
      if (waveSent) {
        const wavesSentCount = new Set(
          stage.chase_events
            .filter((e) => e.channel === "email" || e.channel === "sms")
            .map((e) => e.template_used),
        ).size + 1;
        if (wavesSentCount >= MAX_CONTACT_WAVES) {
          const wonCap = await claimStage(stage.id, CHASE_CAP_CHANNEL, CHASE_CAP_TEMPLATE);
          if (wonCap) {
            const customerName = stage.job.customer?.name ?? "your customer";
            await notifyContractorOfCustomerAction(admin, {
              jobId: stage.job.id,
              event: "chase_stopped",
              subject: `Payment reminders to ${customerName} have stopped`,
              heading: `We've stopped chasing ${customerName} after ${MAX_CONTACT_WAVES} reminders.`,
              nextStep:
                "Nothing more will be sent automatically. Give them a call, or mark the payment as received if they've settled up off-app.",
            });
            capped += 1;
          }
        }
      }
    }

    return NextResponse.json({ sent, capped });
  } finally {
    await releaseCronLock(admin, "chase");
  }
};

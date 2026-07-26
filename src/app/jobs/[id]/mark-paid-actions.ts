"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { settlePaidJob } from "@/lib/settle-paid-job";
import { resolveManualPaidAt, MAX_BACKDATE_DAYS } from "@/lib/mark-paid-date";

// Only off-rails methods are markable manually; 'motko_bank' is the on-rails
// path and can only be set by the TrueLayer webhook.
const markPaidSchema = z.object({
  invoiceId: z.string().uuid(),
  paymentMethod: z.enum(["cash", "bank_transfer", "other"]),
  // A yyyy-mm-dd date the trade picked, or omitted for "today".
  paidOn: z.string().optional(),
});

export type MarkPaidInput = z.infer<typeof markPaidSchema>;
export type MarkPaidResult = { ok: true } | { error: string };

// Marks a 'sent' invoice paid off-rails. Ownership is enforced by RLS: the
// user-scoped select only returns invoices on the trade's own jobs, so a trade
// can never settle someone else's invoice. Settlement itself runs through the
// single settlePaidJob path with the service-role client (it touches
// cross-owner referral rows), identical to the webhook.
export const markInvoicePaid = async (input: MarkPaidInput): Promise<MarkPaidResult> => {
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) return { error: "Something looks off — try again." };
  const { invoiceId, paymentMethod, paidOn } = parsed.data;

  const paidAt = resolveManualPaidAt(paidOn, Date.now());
  if (!paidAt) {
    return { error: `Pick a date from the last ${MAX_BACKDATE_DAYS} days, not in the future.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in and try again." };

  // Ownership + state check via RLS. A missing row means either it isn't theirs
  // or it doesn't exist; either way we refuse.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "We couldn't find that invoice." };
  if (invoice.status === "paid") return { error: "This invoice is already paid." };

  await settlePaidJob(createAdminClient(), {
    invoiceId,
    source: "manual",
    paymentMethod,
    paidAt,
  });

  revalidatePath("/dashboard");
  revalidatePath("/jobs/[id]", "page");
  return { ok: true };
};

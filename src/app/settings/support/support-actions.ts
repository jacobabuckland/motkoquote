"use server";

import { createClient } from "@/lib/supabase/server";
import { sendSupportEmail } from "@/lib/email";
import { supportMessageSchema } from "@/lib/schemas/support";

/**
 * Send a support message to the motko inbox.
 *
 * Signed-in only, and the identity is taken from the session rather than the
 * form: a support request that can claim to be from any company is worse than
 * one that carries no identity at all.
 *
 * Re-validates server-side. The client validates too, for the error message,
 * but a server action is a public endpoint and client validation is a
 * courtesy, not a control.
 */
export const sendSupportMessage = async (
  raw: unknown,
): Promise<{ ok: true } | { error: string }> => {
  const parsed = supportMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your message." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Not signed in." };

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, company_name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const { delivered } = await sendSupportEmail({
    subject: parsed.data.subject,
    message: parsed.data.message,
    fromEmail: user.email,
    companyName: contractor?.company_name ?? "Unknown company",
    contractorId: contractor?.id ?? null,
  });

  // Said plainly rather than swallowed. A support form that reports success
  // when nothing was sent leaves someone waiting for a reply that cannot come,
  // and the address below is the whole point of the page.
  if (!delivered) {
    return {
      error:
        "We couldn't send that just now. Please email hello@motko.app directly and we'll pick it up.",
    };
  }

  return { ok: true };
};

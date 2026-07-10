"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export const acceptQuote = async (quoteId: string) => {
  const admin = createAdminClient();
  const { error } = await admin
    .from("quotes")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);
};

export const declineQuote = async (quoteId: string) => {
  const admin = createAdminClient();
  const { error } = await admin
    .from("quotes")
    .update({ status: "declined", declined_at: new Date().toISOString() })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);
};

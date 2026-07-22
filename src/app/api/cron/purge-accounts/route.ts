import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily purge of soft-deleted accounts whose 30-day grace period has elapsed.
// Anonymises the contractor's personal and operational data in place while
// retaining issued quotes/invoices/contracts as the financial record required
// for legal/tax purposes.
//
// We do NOT delete the contractor row or the auth user: invoices and contracts
// chain up to the contractor via ON DELETE CASCADE, so removing it would
// destroy the very records we must keep. TrueLayer holds its own copies of
// customer/invoice/payment data under its own retention — nothing here touches
// TrueLayer.
export const GET = async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await admin
    .from("contractors")
    .select("id, owner_user_id")
    .is("purged_at", null)
    .not("purge_after", "is", null)
    .lte("purge_after", nowIso);

  const contractors = (due ?? []) as { id: string; owner_user_id: string }[];
  let purged = 0;

  for (const contractor of contractors) {
    const { id, owner_user_id } = contractor;

    // Remove embeddings, team, and merchant links outright — pure personal /
    // business data with no financial-record value.
    await admin.from("knowledge_chunks").delete().eq("contractor_id", id);
    await admin.from("team_members").delete().eq("contractor_id", id);
    await admin.from("merchant_accounts").delete().eq("contractor_id", id);

    // Strip customer PII but keep the row so quotes/invoices still resolve.
    await admin
      .from("customers")
      .update({ name: "Deleted customer", contact: {} })
      .eq("contractor_id", id);

    // Scrub free-text/voice personal data off jobs; keep the row for the
    // financial chain.
    await admin
      .from("jobs")
      .update({
        source_audio_url: null,
        transcript: null,
        extracted_json: null,
        conversation_json: [],
        sow_json: null,
      })
      .eq("contractor_id", id);

    // Tear down the owner's push subscriptions and preferences.
    await admin.from("push_subscriptions").delete().eq("user_id", owner_user_id);
    await admin.from("notification_preferences").delete().eq("user_id", owner_user_id);

    // Anonymise the contractor's own identity/business PII in place, and mark
    // the account purged so it isn't processed again.
    await admin
      .from("contractors")
      .update({
        company_name: "Deleted account",
        company_number: null,
        vat_number: null,
        branding: {},
        business_profile: {},
        purged_at: nowIso,
      })
      .eq("id", id);

    purged += 1;
  }

  return NextResponse.json({ purged });
};

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// NOTIF-3: Returns whether the signed-in contractor has sent their first quote.
// Used by FirstQuotePrompt to decide whether to show the in-app push permission
// prompt. Auth-scoped: the query is filtered to the signed-in user's contractor
// profile, so no contractor can read another's state.
export const GET = async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: contractor } = await supabase
    .from("contractors")
    .select("first_quote_sent_at")
    .eq("owner_user_id", user.id)
    .single();

  if (!contractor) {
    return NextResponse.json({ error: "No contractor profile" }, { status: 404 });
  }

  return NextResponse.json({
    first_quote_sent_at: contractor.first_quote_sent_at,
  });
};

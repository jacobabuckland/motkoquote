// Who is asking, as the chat's server actions and its streaming route both need
// to know it. One place, so the two can never authenticate differently.

import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient } from "./anthropic-client";
import { realActions } from "./real-actions";
import type { PaServiceContext } from "./service";

export const resolveChatContext = async (): Promise<PaServiceContext | null> => {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data: contractor } = await db
    .from("contractors")
    .select("id, company_name, vat_registered")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!contractor) return null;
  return {
    db,
    contractor: contractor as PaServiceContext["contractor"],
    llm: createAnthropicClient(),
    actions: realActions,
    now: () => new Date(),
  };
};

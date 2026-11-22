import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import { requireContractor } from "@/lib/require-contractor";
import { getRenderTime } from "@/lib/format";
import { createAnthropicClient } from "@/lib/pa/anthropic-client";
import { realActions } from "@/lib/pa/real-actions";
import { loadNeedsAttention } from "@/lib/pa/needs-attention";
import { loadLatestThreadId, loadThread, type PaServiceContext } from "@/lib/pa/service";
import { ChatClient } from "./chat-client";

// The conversation. Signed-out visitors go to /login (the proxy would send
// them there anyway; this is the page's own check, like the other app pages).
// What customers owe, for the figure at the head of the thread. The same money
// position the dashboard's ledger answers from. If it can't be read the strip is
// simply left out: the figure is a nicety and must never take the page down.
const loadOwed = async (ctx: PaServiceContext): Promise<number | null> => {
  try {
    const position = await ctx.actions.getMoneyPosition();
    return position.owedToYou.reduce((sum, row) => sum + row.totalOwed, 0);
  } catch {
    return null;
  }
};

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const contractor = await requireContractor<{
    id: string;
    company_name: string;
    vat_registered: boolean;
  }>(supabase, user.id, "id, company_name, vat_registered");

  const ctx: PaServiceContext = {
    db: supabase,
    contractor,
    llm: createAnthropicClient(),
    actions: realActions,
    now: () => new Date(),
  };

  const threadId = await loadLatestThreadId(supabase, contractor.id);
  const [messages, attention, owed] = await Promise.all([
    threadId ? loadThread(ctx, threadId) : Promise.resolve([]),
    loadNeedsAttention(supabase, contractor, getRenderTime()),
    loadOwed(ctx),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pt-4">
        <ChatClient
          initialThreadId={threadId}
          initialMessages={messages}
          attention={attention}
          owed={owed}
        />
      </main>
    </div>
  );
}

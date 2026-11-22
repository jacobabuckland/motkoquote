// The PA service: the orchestration the server actions call. Everything the
// outside world supplies — database client, LLM, actions, clock — is injected,
// so this runs end to end in tests with no network.
//
// Authentication is NOT done here. The caller (app/chat/actions.ts) has already
// resolved the signed-in user to a contractor; every query below is then scoped
// to that contractor id, and RLS says the same thing a second time.

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit, recordRateLimitUse } from "@/lib/rate-limit";
import { runAgent } from "./agent";
import {
  deriveAssumptions,
  ensureAssumptionRecord,
  loadAssumptionRecord,
  setSlotConfirmation,
} from "./assumptions";
import { loadJobBundle } from "./data";
import {
  confirmPendingAction,
  ProposalRefused,
  proposeSendQuote,
  type GateContext,
} from "./pending";
import { buildSystemPrompt } from "./prompt";
import { buildQuoteCard } from "./quote-card";
import { buildToolRegistry } from "./tools";
import type {
  AssumptionSlot,
  Card,
  ConfirmCard,
  LlmClient,
  LlmMessage,
  PaActions,
  PaContractor,
  ToolContext,
} from "./types";

export const MAX_MESSAGE_CHARS = 2000;
const HISTORY_LIMIT = 20;
const LOAD_LIMIT = 60;
export const RATE_LIMIT = { limit: 40, windowMs: 60 * 60 * 1000 } as const;

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: Card[];
  createdAt: string;
  // A link the message offers, e.g. to the job page after a send.
  link?: string;
};

export type PaServiceContext = {
  db: SupabaseClient;
  contractor: PaContractor;
  llm: LlmClient;
  actions: PaActions;
  now: () => Date;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  cards: unknown;
  created_at: string;
};

const toView = (row: MessageRow): ChatMessageView | null =>
  row.role === "tool"
    ? null
    : {
        id: row.id,
        role: row.role,
        content: row.content,
        cards: Array.isArray(row.cards) ? (row.cards as Card[]) : [],
        createdAt: row.created_at,
      };

export const loadLatestThreadId = async (
  db: SupabaseClient,
  contractorId: string,
): Promise<string | null> => {
  const { data } = await db
    .from("pa_threads")
    .select("id")
    .eq("contractor_id", contractorId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
};

const requireThread = async (
  db: SupabaseClient,
  contractorId: string,
  threadId: string,
): Promise<boolean> => {
  const { data } = await db
    .from("pa_threads")
    .select("id")
    .eq("id", threadId)
    .eq("contractor_id", contractorId)
    .maybeSingle();
  return Boolean(data);
};

const createThread = async (
  db: SupabaseClient,
  contractorId: string,
  now: Date,
): Promise<string> => {
  const stamp = now.toISOString();
  const { data, error } = await db
    .from("pa_threads")
    .insert({ contractor_id: contractorId, created_at: stamp, updated_at: stamp })
    .select("id")
    .single();
  const id = (data as { id?: string } | null)?.id;
  if (error || !id) throw new Error("Couldn't start the conversation.");
  return id;
};

const saveMessage = async (
  ctx: PaServiceContext,
  threadId: string,
  message: {
    role: "user" | "assistant";
    content: string;
    cards?: Card[];
    toolCalls?: unknown;
  },
): Promise<ChatMessageView> => {
  const createdAt = ctx.now().toISOString();
  const { data, error } = await ctx.db
    .from("pa_messages")
    .insert({
      thread_id: threadId,
      contractor_id: ctx.contractor.id,
      role: message.role,
      content: message.content,
      cards: message.cards ?? [],
      tool_calls: message.toolCalls ?? null,
      channel: "app",
      created_at: createdAt,
    })
    .select("id")
    .single();
  const id = (data as { id?: string } | null)?.id;
  if (error || !id) throw new Error("Couldn't save the message.");
  await ctx.db
    .from("pa_threads")
    .update({ updated_at: createdAt })
    .eq("id", threadId)
    .eq("contractor_id", ctx.contractor.id);
  return {
    id,
    role: message.role,
    content: message.content,
    cards: message.cards ?? [],
    createdAt,
  };
};

// Cards are stored as they were when shown. On the way out, quote cards are
// rebuilt from the live quote (an assumption confirmed, a price changed) and
// confirm cards say whether they are still live — so a reloaded thread never
// shows a stale Send button.
export const refreshCards = async (
  ctx: PaServiceContext,
  messages: ChatMessageView[],
): Promise<ChatMessageView[]> => {
  const cache = new Map<string, Card | null>();
  const refreshed: ChatMessageView[] = [];
  for (const message of messages) {
    const cards: Card[] = [];
    for (const card of message.cards) {
      if (card.type === "quote") {
        if (!cache.has(card.jobId)) {
          const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, card.jobId);
          const record = bundle
            ? await loadAssumptionRecord(ctx.db, ctx.contractor.id, card.jobId)
            : null;
          cache.set(
            card.jobId,
            bundle ? buildQuoteCard(bundle, ctx.contractor.vat_registered, record) : null,
          );
        }
        const live = cache.get(card.jobId);
        if (live) cards.push(live);
      } else {
        const { data } = await ctx.db
          .from("pa_pending_actions")
          .select("confirmed_at, expires_at, outcome, outcome_message")
          .eq("id", card.pendingActionId)
          .eq("contractor_id", ctx.contractor.id)
          .maybeSingle();
        const row = data as {
          confirmed_at: string | null;
          expires_at: string;
          outcome: "done" | "refused" | null;
          outcome_message: string | null;
        } | null;
        // A claimed row is only "done" if the action actually ran.
        const state: ConfirmCard["state"] = !row
          ? "expired"
          : row.confirmed_at
            ? row.outcome === "done"
              ? "done"
              : row.outcome === "refused"
                ? "refused"
                : "unknown"
            : new Date(row.expires_at).getTime() <= ctx.now().getTime()
              ? "expired"
              : "pending";
        cards.push({
          ...card,
          state,
          ...(state === "refused" && row?.outcome_message
            ? { outcomeMessage: row.outcome_message }
            : {}),
        });
      }
    }
    refreshed.push({ ...message, cards });
  }
  return refreshed;
};

export const loadThread = async (
  ctx: PaServiceContext,
  threadId: string,
  options: { refreshCards?: boolean } = {},
): Promise<ChatMessageView[]> => {
  if (!(await requireThread(ctx.db, ctx.contractor.id, threadId))) return [];
  const { data } = await ctx.db
    .from("pa_messages")
    .select("id, role, content, cards, created_at")
    .eq("thread_id", threadId)
    .eq("contractor_id", ctx.contractor.id)
    .order("created_at", { ascending: false })
    .limit(LOAD_LIMIT);
  const rows = ((data as unknown as MessageRow[] | null) ?? []).slice().reverse();
  const views = rows.map(toView).filter((view): view is ChatMessageView => view !== null);
  return options.refreshCards === false ? views : refreshCards(ctx, views);
};

// Plain-text history for the model. Tool traces are not replayed; cards are
// reduced to a pointer carrying job ids (ids only: no customer text) so the
// model can refer back to a quote it showed.
const historyFor = (messages: ChatMessageView[]): LlmMessage[] => {
  const recent = messages.slice(-HISTORY_LIMIT);
  // The API wants the first turn to be the user's.
  const firstUser = recent.findIndex((message) => message.role === "user");
  return (firstUser === -1 ? [] : recent.slice(firstUser)).map((message) => {
    const pointers = message.cards
      .filter((card): card is Extract<Card, { type: "quote" }> => card.type === "quote")
      .map((card) => `quote card for job ${card.jobId}`);
    const suffix = pointers.length > 0 ? `\n[shown: ${pointers.join("; ")}]` : "";
    return { role: message.role, content: `${message.content}${suffix}` };
  });
};

export type SendResult =
  | { ok: true; threadId: string; messages: ChatMessageView[] }
  | { ok: false; error: string };

export const handleUserMessage = async (
  ctx: PaServiceContext,
  input: { threadId?: string | null; text: string },
): Promise<SendResult> => {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Type a message first." };
  if (text.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Keep it under ${MAX_MESSAGE_CHARS} characters.` };
  }

  const limitKey = `pa:${ctx.contractor.id}`;
  const decision = checkRateLimit(limitKey, RATE_LIMIT);
  if (!decision.allowed) {
    return { ok: false, error: "That's a lot of messages. Give it a few minutes." };
  }
  // Recorded in the same synchronous step as the check, before any await, so a
  // parallel burst can't all pass it. A turn whose model call then fails
  // therefore still counts against the allowance.
  recordRateLimitUse(limitKey, RATE_LIMIT);

  let threadId = input.threadId ?? null;
  if (threadId) {
    if (!(await requireThread(ctx.db, ctx.contractor.id, threadId))) {
      return { ok: false, error: "I can't find that conversation." };
    }
  } else {
    threadId = (await loadLatestThreadId(ctx.db, ctx.contractor.id)) ?? null;
    if (!threadId) threadId = await createThread(ctx.db, ctx.contractor.id, ctx.now());
  }

  const history = await loadThread(ctx, threadId, { refreshCards: false });
  const userMessage = await saveMessage(ctx, threadId, { role: "user", content: text });

  const toolCtx: ToolContext = {
    db: ctx.db,
    contractor: ctx.contractor,
    threadId,
    llm: ctx.llm,
    actions: ctx.actions,
    now: ctx.now,
  };
  const result = await runAgent({
    llm: ctx.llm,
    system: buildSystemPrompt({
      companyName: ctx.contractor.company_name,
      today: ctx.now().toISOString().slice(0, 10),
    }),
    history: historyFor(history),
    userText: text,
    registry: buildToolRegistry(),
    ctx: toolCtx,
  });

  const assistantMessage = await saveMessage(ctx, threadId, {
    role: "assistant",
    content: result.reply,
    cards: result.cards,
    toolCalls: result.toolCalls,
  });

  return { ok: true, threadId, messages: [userMessage, assistantMessage] };
};

// ---------------------------------------------------------------------------
// Requests that come from the contractor's own taps
// ---------------------------------------------------------------------------

const gateOf = (ctx: PaServiceContext, threadId: string): GateContext => ({
  db: ctx.db,
  contractor: ctx.contractor,
  threadId,
  actions: ctx.actions,
  now: ctx.now,
});

export type TapResult =
  | { ok: true; messages: ChatMessageView[] }
  | { ok: false; error: string };

// The Send button on a quote card. It does NOT send: it sets up the same
// confirm card the model's propose_send_quote does, and the contractor then
// taps that.
export const proposeSendFromCard = async (
  ctx: PaServiceContext,
  input: { threadId: string; jobId: string },
): Promise<TapResult> => {
  if (!(await requireThread(ctx.db, ctx.contractor.id, input.threadId))) {
    return { ok: false, error: "I can't find that conversation." };
  }
  try {
    const card = await proposeSendQuote(gateOf(ctx, input.threadId), input.jobId);
    const message = await saveMessage(ctx, input.threadId, {
      role: "assistant",
      content: "Check the details, then confirm.",
      cards: [card],
    });
    return { ok: true, messages: [message] };
  } catch (error) {
    if (error instanceof ProposalRefused) return { ok: false, error: error.message };
    return { ok: false, error: "Couldn't set that up. Nothing has been sent." };
  }
};

// The tap on a confirm card.
export const confirmFromCard = async (
  ctx: PaServiceContext,
  input: { threadId: string; pendingId: string },
): Promise<TapResult & { link?: string }> => {
  const result = await confirmPendingAction(gateOf(ctx, input.threadId), input.pendingId);
  // A second tap (two tabs, a double press) on something that really was done is
  // a calm no-op. A second tap on something that was REFUSED is not: it repeats
  // the refusal, and "I can't tell" stays "I can't tell". Only a recorded success
  // may read as done.
  if (!result.ok && result.code === "already_done") return { ok: true, messages: [] };
  if (!result.ok) return { ok: false, error: result.message };
  const message = await saveMessage(ctx, input.threadId, {
    role: "assistant",
    content: result.message,
  });
  return { ok: true, messages: [{ ...message, link: result.link }], link: result.link };
};

// The tap on an assumption chip. Only a user request reaches here; the model
// has no tool for it. A slot with no value cannot be confirmed — nothing is
// defaulted on the contractor's behalf.
export type AssumptionTapResult =
  | { ok: true; card: Card | null }
  | { ok: false; error: string; card?: Card | null };

export const confirmAssumptionFromCard = async (
  ctx: PaServiceContext,
  input: { jobId: string; slot: AssumptionSlot; expectedValue: string },
): Promise<AssumptionTapResult> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, input.jobId);
  if (!bundle?.quote) return { ok: false, error: "I can't find that quote." };
  if (bundle.quote.status !== "draft") {
    return { ok: false, error: "That quote has already gone out." };
  }
  const assumption = deriveAssumptions(bundle.sow, null).find((a) => a.slot === input.slot);
  if (!assumption || assumption.value === null) {
    return { ok: false, error: "Tell me that one first and I'll put it on the draft." };
  }
  // The contractor confirms what they SAW. If the value has moved since the
  // card was drawn, refuse and hand back the fresh card.
  if (assumption.value !== input.expectedValue) {
    const record = await loadAssumptionRecord(ctx.db, ctx.contractor.id, input.jobId);
    return {
      ok: false,
      error: "That changed since you last looked. Check it again.",
      card: buildQuoteCard(bundle, ctx.contractor.vat_registered, record),
    };
  }
  await ensureAssumptionRecord(
    ctx.db,
    ctx.contractor.id,
    input.jobId,
    bundle.sow,
    ctx.now(),
    true,
  );
  await setSlotConfirmation(ctx.db, ctx.contractor.id, input.jobId, input.slot, ctx.now(), ctx.now());
  const record = await loadAssumptionRecord(ctx.db, ctx.contractor.id, input.jobId);
  return { ok: true, card: buildQuoteCard(bundle, ctx.contractor.vat_registered, record) };
};

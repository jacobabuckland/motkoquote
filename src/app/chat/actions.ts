"use server";

// The chat's server actions. Each one is a POST the contractor's browser makes,
// and each one starts by resolving the signed-in user to their contractor — the
// threadId, jobId and pendingId in the input are claims to be checked against
// that contractor, never trusted.
//
// confirmPendingAction is the one that matters: it is the ONLY way a pending
// send / invoice / paid / delete is ever executed, and it exists here, as a
// request from the contractor's own browser, rather than as a tool the model
// holds.

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient } from "@/lib/pa/anthropic-client";
import { realActions } from "@/lib/pa/real-actions";
import {
  confirmAssumptionFromCard,
  confirmFromCard,
  handleUserMessage,
  loadThread,
  proposeSendFromCard,
  type ChatMessageView,
  type PaServiceContext,
} from "@/lib/pa/service";
import type { Card } from "@/lib/pa/types";

const NOT_SIGNED_IN = "Please sign in and try again.";

const resolveContext = async (): Promise<PaServiceContext | null> => {
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

export type ChatActionResult =
  | { ok: true; threadId?: string; messages: ChatMessageView[]; link?: string }
  | { ok: false; error: string };

const sendSchema = z.object({
  threadId: z.string().uuid().nullish(),
  text: z.string(),
});

export const sendChatMessage = async (
  input: z.infer<typeof sendSchema>,
): Promise<ChatActionResult> => {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something looks off. Try again." };
  const ctx = await resolveContext();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  try {
    return await handleUserMessage(ctx, parsed.data);
  } catch {
    return { ok: false, error: "Something went wrong. Nothing has been sent." };
  }
};

const proposeSchema = z.object({ threadId: z.string().uuid(), jobId: z.string().uuid() });

export const proposeSendQuoteFromCard = async (
  input: z.infer<typeof proposeSchema>,
): Promise<ChatActionResult> => {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something looks off. Try again." };
  const ctx = await resolveContext();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  return proposeSendFromCard(ctx, parsed.data);
};

const confirmSchema = z.object({ threadId: z.string().uuid(), pendingId: z.string().uuid() });

export const confirmPendingAction = async (
  input: z.infer<typeof confirmSchema>,
): Promise<ChatActionResult> => {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That confirmation isn't valid." };
  const ctx = await resolveContext();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  try {
    return await confirmFromCard(ctx, parsed.data);
  } catch {
    return { ok: false, error: "Something went wrong. Check the job page before trying again." };
  }
};

const assumptionSchema = z.object({
  jobId: z.string().uuid(),
  slot: z.enum(["pricing_mode", "crew", "materials_supply"]),
});

export const confirmAssumption = async (
  input: z.infer<typeof assumptionSchema>,
): Promise<{ ok: true; card: Card | null } | { ok: false; error: string }> => {
  const parsed = assumptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something looks off. Try again." };
  const ctx = await resolveContext();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  try {
    return await confirmAssumptionFromCard(ctx, parsed.data);
  } catch {
    return { ok: false, error: "Couldn't confirm that. Try again." };
  }
};

const reloadSchema = z.object({ threadId: z.string().uuid() });

// Re-reads the thread with live cards, so a quote that has just gone out no
// longer shows a Send button.
export const reloadChat = async (
  input: z.infer<typeof reloadSchema>,
): Promise<ChatActionResult> => {
  const parsed = reloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something looks off. Try again." };
  const ctx = await resolveContext();
  if (!ctx) return { ok: false, error: NOT_SIGNED_IN };
  return { ok: true, messages: await loadThread(ctx, parsed.data.threadId) };
};

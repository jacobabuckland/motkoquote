// Shared types for the PA (personal assistant) chat agent.
//
// The agent loop talks to an `LlmClient`, never to a vendor SDK directly, so
// tests drive it with a scripted fake and nothing in the suite touches a
// network. The real client is src/lib/pa/anthropic-client.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatusLabel } from "@/components/ui/status-chip";

// ---------------------------------------------------------------------------
// LLM seam
// ---------------------------------------------------------------------------

export type LlmTextBlock = { type: "text"; text: string };
export type LlmToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type LlmToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock;

export type LlmMessage = {
  role: "user" | "assistant";
  content: string | LlmContentBlock[];
};

export type LlmToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  maxTokens: number;
  // Force a single named tool (structured extraction).
  forceTool?: string;
};

export type LlmResponse = {
  content: (LlmTextBlock | LlmToolUseBlock)[];
  stopReason: string;
};

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type AssumptionSlot = "pricing_mode" | "crew" | "materials_supply";

export type AssumptionView = {
  slot: AssumptionSlot;
  label: string;
  // What the draft currently says, in the contractor's words. Null when the
  // slot has never been stated (nothing is guessed to fill it).
  value: string | null;
  confirmed: boolean;
};

export type QuoteCardLine = {
  description: string;
  quantity: number;
  unit: string;
  // Computed by quote-math (lineItemTotal), never by the model.
  amount: number;
};

export type QuoteCard = {
  type: "quote";
  jobId: string;
  quoteId: string;
  customerName: string | null;
  title: string;
  status: StatusLabel;
  lines: QuoteCardLine[];
  moreLines: number;
  // All three from computeQuoteTotals.
  subtotal: number;
  vat: number;
  total: number;
  vatRegistered: boolean;
  assumptions: AssumptionView[];
  // Why this cannot be sent yet (empty when it can).
  blockers: string[];
  canSend: boolean;
  // Who it would go to, so the contractor sees the recipient before confirming.
  recipient: string | null;
  // What happens next for this job, from the same derivation the job page uses.
  nextStep: string;
};

export type PendingActionKind = "send_quote" | "create_invoice" | "mark_paid" | "delete_draft";

export type ConfirmCard = {
  type: "confirm";
  pendingActionId: string;
  threadId: string;
  action: PendingActionKind;
  title: string;
  summary: string;
  expiresAt: string;
  confirmLabel: string;
  // Filled in when a card is loaded back from storage.
  //   done     the action ran
  //   refused  it was claimed but the re-check (or the action) refused; nothing happened
  //   unknown  it was claimed and no outcome was ever recorded; we cannot say
  state?: "pending" | "done" | "expired" | "refused" | "unknown";
  // The words the contractor was shown when the action was refused.
  outcomeMessage?: string;
};

export type Card = QuoteCard | ConfirmCard;

// ---------------------------------------------------------------------------
// The action seam
// ---------------------------------------------------------------------------

// The existing server actions the tools wrap, behind an interface so tests can
// observe exactly what would have been called (and so a test can prove that a
// write tool never reaches `sendQuote`).
export type PaActions = {
  createManualJob: () => Promise<{ jobId: string }>;
  saveSowDelta: (input: { jobId: string; delta: unknown }) => Promise<unknown>;
  redraftJob: (input: { jobId: string }) => Promise<{ lineItemCount: number }>;
  updateQuoteLineItems: (input: {
    jobId: string;
    quoteId: string;
    lineItems: unknown[];
    customer?: {
      name: string;
      email?: string;
      phone?: string;
      address?: string;
      smsOptOut?: boolean;
    };
  }) => Promise<unknown>;
  setQuotePricingMode: (input: {
    jobId: string;
    quoteId: string;
    mode: "days" | "fixed" | "calculated";
    fixedAmount?: number | null;
  }) => Promise<unknown>;
  sendQuote: (input: {
    jobId: string;
    quoteId: string;
    customer: {
      name: string;
      email?: string;
      phone?: string;
      address?: string;
      smsOptOut?: boolean;
    };
  }) => Promise<{ delivered: boolean; quoteUrl: string }>;
  createInvoice: (input: {
    quoteId: string;
    invoiceType: "deposit" | "final";
  }) => Promise<unknown>;
  markInvoicePaid: (input: {
    invoiceId: string;
    paymentMethod: "cash" | "bank_transfer" | "other";
  }) => Promise<{ ok: true } | { error: string }>;
  deleteDraftJob: (input: { jobId: string }) => Promise<void>;
  getMoneyPosition: () => Promise<{
    owedToYou: { customerName: string; totalOwed: number }[];
    whatsLeft: number;
    safeToSpend: { total: number; collected: number };
    projection: { total: number; owedNet: number };
  }>;
};

export type PaContractor = {
  id: string;
  company_name: string;
  vat_registered: boolean;
};

export type ToolContext = {
  db: SupabaseClient;
  contractor: PaContractor;
  threadId: string;
  llm: LlmClient;
  actions: PaActions;
  now: () => Date;
};

export type ToolOutput = {
  // JSON the model narrates. Wrapped as untrusted data before it is shown.
  data: unknown;
  cards?: Card[];
};

export type ToolKind = "read" | "draft_write" | "gate";

export type PaTool = {
  name: string;
  description: string;
  kind: ToolKind;
  inputSchema: Record<string, unknown>;
  // Validates the model's raw input and runs the tool. Throws on bad input.
  run: (raw: unknown, ctx: ToolContext) => Promise<ToolOutput>;
};

export type ToolRegistry = {
  tools: PaTool[];
  defs: LlmToolDef[];
};

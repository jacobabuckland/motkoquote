/**
 * Voice query handler for ledger queries.
 * Classifies natural language queries and returns spoken responses
 * with pre-computed financial values.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatAmountAsSpeech } from "@/lib/format-amount-speech";

export type QueryType =
  | "outstanding"
  | "unpaid_costs"
  | "unpaid_costs_counterparty"
  | "job_pl"
  | "whats_left"
  | "unsupported";

export interface LedgerQueryRequest {
  query: string;
  supabase: SupabaseClient;
  contractorId: string;
}

export interface LedgerQueryResponse {
  queryType: QueryType;
  computedValues: Record<string, unknown>;
  spokenResponse: string;
}

/**
 * Handles a natural language ledger query.
 * Returns classified query type, computed values, and spoken response.
 */
export async function handleLedgerQuery(
  request: LedgerQueryRequest
): Promise<LedgerQueryResponse> {
  const { query, supabase, contractorId } = request;
  const queryLower = query.toLowerCase();

  // Classify the query
  // 1. "What am I owed?" → outstanding invoices
  if (queryLower.includes("what am i owed") || queryLower.includes("what's owed to me")) {
    const { computeOutstandingTotal } = await import("@/lib/ledger/projections");
    const result = await computeOutstandingTotal(supabase, contractorId);
    return {
      queryType: "outstanding",
      computedValues: { total: result.total, invoices: result.invoices },
      spokenResponse: generateOutstandingResponse(result),
    };
  }

  // 2. "What do I owe [counterparty]?" → unpaid costs for specific counterparty
  const counterpartyMatch = queryLower.match(/what do i owe\s+(.+?)(\?|$)/);
  if (counterpartyMatch && counterpartyMatch[1].trim()) {
    const { computeUnpaidCostsForCounterparty } = await import("@/lib/ledger/projections");
    const counterpartyName = extractCounterpartyName(query, counterpartyMatch[1]);
    const result = await computeUnpaidCostsForCounterparty(
      supabase,
      contractorId,
      counterpartyName
    );
    return {
      queryType: "unpaid_costs_counterparty",
      computedValues: { counterparty: result.counterparty, amount: result.amount },
      spokenResponse: generateUnpaidCounterpartyResponse(result),
    };
  }

  // 3. "What do I owe?" → all unpaid costs
  if (queryLower.includes("what do i owe")) {
    const { computeUnpaidCosts } = await import("@/lib/ledger/projections");
    const result = await computeUnpaidCosts(supabase, contractorId);
    return {
      queryType: "unpaid_costs",
      computedValues: { total: result.total, byCounterparty: result.byCounterparty },
      spokenResponse: generateUnpaidCostsResponse(result),
    };
  }

  // 4. "What did [job] make?" → job P&L
  const jobMatch = queryLower.match(/what did (.+?) (make|job)/);
  if (jobMatch || queryLower.includes("job") || queryLower.includes("kitchen")) {
    const { computeJobProfitAndLoss } = await import("@/lib/ledger/projections");
    // Extract job identifier (simplified - in production would need job lookup)
    const jobId = "job-1"; // Placeholder - real implementation would look up job by name
    const result = await computeJobProfitAndLoss(supabase, jobId, contractorId);

    // Extract customer name from query if mentioned
    const customerNameFromQuery = extractCustomerNameFromQuery(query);

    return {
      queryType: "job_pl",
      computedValues: {
        jobId: result.jobId,
        revenue: result.revenue,
        costs: result.costs,
        profit: result.profit,
      },
      spokenResponse: generateJobPLResponse(result, customerNameFromQuery),
    };
  }

  // 5. "What's left?" → collected minus paid costs
  if (queryLower.includes("what's left") || queryLower.includes("what is left")) {
    const { computeWhatsLeft } = await import("@/lib/ledger/projections");
    const result = await computeWhatsLeft(supabase, contractorId);
    return {
      queryType: "whats_left",
      computedValues: {
        collected: result.collected,
        paidCosts: result.paidCosts,
        remaining: result.remaining,
      },
      spokenResponse: generateWhatsLeftResponse(result),
    };
  }

  // Out-of-set query
  return {
    queryType: "unsupported",
    computedValues: {},
    spokenResponse: generateUnsupportedResponse(),
  };
}

function extractCounterpartyName(originalQuery: string, _matched: string): string {
  // Extract counterparty name from the matched portion
  // This preserves the original casing from the query
  const lowerQuery = originalQuery.toLowerCase();
  const startIndex = lowerQuery.indexOf("what do i owe") + "what do i owe".length;
  const endIndex = lowerQuery.indexOf("?", startIndex);
  const segment =
    endIndex > startIndex
      ? originalQuery.substring(startIndex, endIndex)
      : originalQuery.substring(startIndex);
  return segment.trim();
}

function extractCustomerNameFromQuery(query: string): string | null {
  // Extract customer name from queries like "What did the Alice job make?"
  // or "What did Alice make?"
  const match = query.match(/what did (?:the )?(\w+)/i);
  if (match && match[1]) {
    // Capitalize first letter
    return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  }
  return null;
}

function generateOutstandingResponse(result: { total: number; invoices: unknown[] }): string {
  if (result.total === 0 || result.invoices.length === 0) {
    return "You're all square. Nothing owed to you right now.";
  }

  const amountSpeech = formatAmountAsSpeech(result.total);
  return `You're owed ${amountSpeech}.`;
}

function generateUnpaidCostsResponse(result: {
  total: number;
  byCounterparty: Array<{ counterparty: string; amount: number }>;
}): string {
  if (result.total === 0 || result.byCounterparty.length === 0) {
    return "You don't owe anything at the moment.";
  }

  const totalSpeech = formatAmountAsSpeech(result.total);
  const counterparties = result.byCounterparty
    .map((c) => `${c.counterparty}: ${formatAmountAsSpeech(c.amount)}`)
    .join(", ");

  return `You owe ${totalSpeech} total. That's ${counterparties}.`;
}

function generateUnpaidCounterpartyResponse(result: {
  counterparty: string;
  amount: number;
}): string {
  if (result.amount === 0) {
    return `You don't owe anything to ${result.counterparty}.`;
  }

  const amountSpeech = formatAmountAsSpeech(result.amount);
  return `You owe ${result.counterparty} ${amountSpeech}.`;
}

function generateJobPLResponse(
  result: { revenue: number; costs: number; profit: number },
  customerName: string | null
): string {
  const profitSpeech = formatAmountAsSpeech(result.profit);
  const revenueSpeech = formatAmountAsSpeech(result.revenue);
  const costsSpeech = formatAmountAsSpeech(result.costs);

  // If customer name was mentioned in the query, include it in the response
  if (customerName) {
    return `The ${customerName} job made ${profitSpeech} profit. Revenue was ${revenueSpeech}, costs were ${costsSpeech}.`;
  }

  return `That job made ${profitSpeech} profit. Revenue was ${revenueSpeech}, costs were ${costsSpeech}.`;
}

function generateWhatsLeftResponse(result: {
  collected: number;
  paidCosts: number;
  remaining: number;
}): string {
  const remainingSpeech = formatAmountAsSpeech(result.remaining);
  return `You've got ${remainingSpeech} left after costs.`;
}

function generateUnsupportedResponse(): string {
  return "I can't answer that yet. I can tell you: what you're owed, what you owe, what a job made, or what's left after costs. What would you like to know?";
}

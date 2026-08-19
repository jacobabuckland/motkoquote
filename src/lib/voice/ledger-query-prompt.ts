/**
 * Voice ledger query prompt builder and response formatters.
 *
 * British English spoken-money conventions:
 * - Amounts under £100: "forty-five pounds" (no "and")
 * - Amounts £100–£9,999: "twelve hundred and forty pounds" (hundreds form)
 * - Amounts £10,000+: "fifteen thousand pounds" (thousands form)
 * - Pence omitted unless non-zero: "forty-five pounds twenty" for £45.20
 * - Negative amounts: "minus two hundred and forty pounds" or "down..."
 *
 * Privacy rules:
 * - Amounts: always spoken (this is the point of the feature)
 * - Counterparty names (suppliers): always spoken when relevant
 * - Customer names: only when the contractor mentioned them in the query
 * - Job descriptions: treated same as customer names
 *
 * The model interprets and speaks. Code computes.
 * The LLM receives pre-computed figures from server actions and assembles them
 * into natural spoken responses — it NEVER performs arithmetic, aggregation, or
 * filtering over ledger data.
 */

import type { CustomerAggregate, CounterpartyAggregate } from "@/lib/money-position-math";

const SUPPORTED_QUERY_TYPES = [
  "what am I owed",
  "what do I owe",
  "what do I owe [counterparty]",
  "what did [job] make",
  "what's left",
] as const;

type QueryType =
  | "what_am_i_owed"
  | "what_do_i_owe"
  | "what_do_i_owe_counterparty"
  | "what_did_job_make"
  | "whats_left"
  | "out_of_set";

export type QueryClassification = {
  queryType: QueryType;
  supportedQueries?: string[];
  parameters?: {
    counterpartyName?: string;
    jobIdentifier?: string;
    customerName?: string;
  };
};

/**
 * Builds the system instructions for the ledger query Realtime session.
 * Instructs the model to classify queries and use pre-computed server figures.
 */
export function buildLedgerQueryInstructions(): string {
  return `You are a voice assistant for a British tradesperson's business ledger.

Your job is to:
1. Listen to ONE question about money
2. Classify it into one of five supported query types
3. Speak the answer using PRE-COMPUTED figures provided by the server
4. Close the session

SUPPORTED QUERIES (exactly five):
1. "What am I owed?" — outstanding invoices total and top few by age
2. "What do I owe?" — unpaid costs by supplier
3. "What do I owe [counterparty name]?" — unpaid costs for a specific supplier
4. "What did [job/customer name] make?" — job profit and margin
5. "What's left?" — collected minus paid costs

OUT-OF-SET QUERIES:
Any question about trends, comparisons, actions, or anything not in the five above is OUT OF SET.
Respond: "I can't answer that yet. I can tell you: what you're owed, what you owe, what a job made, or what's left. Try one of those."

CRITICAL RULES:
- DO NOT calculate, compute, sum, or add ANY figures yourself
- USE ONLY the server-computed, pre-computed, provided figures
- You format numbers into natural British speech, nothing more
- Never perform arithmetic on ledger data

PRIVACY RULES:
- Always speak amounts and counterparty (supplier) names
- ONLY speak customer names if the contractor mentioned the customer in their question
- If they ask "what am I owed", list amounts and ages, but DO NOT say customer names
- If they ask "what did the Smith job make", you MAY say "Smith" because they said it first

BRITISH ENGLISH CONVENTIONS:
- £45: "forty-five pounds"
- £1,240: "twelve hundred and forty pounds"
- £15,000: "fifteen thousand pounds"
- £15,200: "fifteen thousand two hundred pounds"
- Omit pence if zero
- Speak naturally and conversationally

Answer the contractor's question, then close the session.`;
}

/**
 * Classifies a query string into one of the five supported types or out_of_set.
 * This is a simplified synchronous classifier for testing.
 * In production, the OpenAI Realtime model would handle classification.
 */
export async function classifyQuery(query: string): Promise<QueryClassification> {
  const normalized = query.toLowerCase().trim();

  // Check for out-of-set patterns first
  const outOfSetPatterns = [
    /how does.*compare/i,
    /last month|this month|compare/i,
    /mark.*as paid/i,
    /send|create|make|update/i,
    /who.*biggest|who.*most/i,
    /trend|average|usually/i,
  ];

  for (const pattern of outOfSetPatterns) {
    if (pattern.test(normalized)) {
      return {
        queryType: "out_of_set",
        supportedQueries: [...SUPPORTED_QUERY_TYPES],
      };
    }
  }

  // Classify into one of the five types
  if (normalized.includes("what am i owed") || normalized.includes("what's owed to me")) {
    return { queryType: "what_am_i_owed" };
  }

  if (
    normalized.includes("what do i owe") ||
    normalized.includes("what i owe") ||
    normalized.includes("how much do i owe")
  ) {
    // Check if it mentions a specific counterparty
    // Simple heuristic: if there's a word after "owe" that's not a question word
    const match = normalized.match(/owe\s+([a-z']+(?:\s+[a-z']+)?)/i);
    if (match && !["to", "in", "for", "on"].includes(match[1] || "")) {
      return {
        queryType: "what_do_i_owe_counterparty",
        parameters: { counterpartyName: match[1] },
      };
    }
    return { queryType: "what_do_i_owe" };
  }

  if (
    normalized.includes("what did") &&
    (normalized.includes("make") || normalized.includes("profit"))
  ) {
    // Extract job/customer identifier
    const match = normalized.match(/what did\s+(?:the\s+)?([^?]+?)\s+(?:make|profit)/i);
    if (match) {
      const identifier = match[1]?.replace(/\s+job$/, "").trim() || "";
      return {
        queryType: "what_did_job_make",
        parameters: { jobIdentifier: identifier, customerName: identifier },
      };
    }
    return { queryType: "what_did_job_make" };
  }

  if (normalized.includes("what's left") || normalized.includes("whats left")) {
    return { queryType: "whats_left" };
  }

  // Default to out_of_set if we can't classify
  return {
    queryType: "out_of_set",
    supportedQueries: [...SUPPORTED_QUERY_TYPES],
  };
}

/**
 * Formats an amount in pence to British English spoken form.
 * Follows the conventions documented at the top of this file.
 */
export function formatAmount(pence: number): string {
  // Handle negative amounts
  if (pence < 0) {
    return `minus ${formatAmount(-pence)}`;
  }

  const pounds = Math.floor(pence / 100);
  const penceRemainder = pence % 100;

  let result = "";

  if (pounds === 0) {
    result = "zero pounds";
  } else if (pounds < 100) {
    // Under £100: just say the number
    result = `${numberToWords(pounds)} pounds`;
  } else if (pounds < 10000) {
    // £100-£9,999: use hundreds form ("twelve hundred"), except for round thousands
    const hundreds = Math.floor(pounds / 100);
    const remainder = pounds % 100;

    // Round thousands (£1000, £2000, etc.) use "one thousand" not "ten hundred"
    if (remainder === 0 && hundreds % 10 === 0) {
      const thousands = hundreds / 10;
      result = `${numberToWords(thousands)} thousand pounds`;
    } else if (remainder === 0) {
      result = `${numberToWords(hundreds)} hundred pounds`;
    } else {
      result = `${numberToWords(hundreds)} hundred and ${numberToWords(remainder)} pounds`;
    }
  } else {
    // £10,000+: use thousands form
    const thousands = Math.floor(pounds / 1000);
    const remainder = pounds % 1000;

    if (remainder === 0) {
      result = `${numberToWords(thousands)} thousand pounds`;
    } else {
      result = `${numberToWords(thousands)} thousand ${numberToWords(remainder)} pounds`;
    }
  }

  // Add pence if non-zero
  if (penceRemainder > 0) {
    result = result.replace(" pounds", ` pounds ${numberToWords(penceRemainder)}`);
  }

  return result;
}

/**
 * Converts a number (0-9999) to words for British English.
 */
function numberToWords(n: number): string {
  if (n === 0) return "zero";
  if (n < 0) return `minus ${numberToWords(-n)}`;

  const ones = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ];
  const teens = [
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];

  if (n < 10) return ones[n] || "";
  if (n < 20) return teens[n - 10] || "";
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return one === 0 ? tens[ten] || "" : `${tens[ten]}-${ones[one]}`;
  }
  if (n < 1000) {
    const hundred = Math.floor(n / 100);
    const remainder = n % 100;
    if (remainder === 0) {
      return `${ones[hundred]} hundred`;
    }
    return `${ones[hundred]} hundred and ${numberToWords(remainder)}`;
  }

  // 1000-9999
  const thousand = Math.floor(n / 1000);
  const remainder = n % 1000;
  if (remainder === 0) {
    return `${ones[thousand]} thousand`;
  }
  return `${ones[thousand]} thousand ${numberToWords(remainder)}`;
}

/**
 * Formats the "what am I owed" response with privacy rules applied.
 */
export function formatOwedToYouResponse(
  data: CustomerAggregate[],
  options: {
    customerMentionedInQuery: boolean;
    customerNameFromQuery?: string;
  },
): string {
  if (data.length === 0) {
    return "You're all caught up — no outstanding invoices.";
  }

  // Calculate total owed
  const totalOwed = data.reduce((sum, customer) => sum + customer.totalOwed, 0);

  // Sort by age (oldest first) for mentioning top aged invoices
  const byAge = [...data].sort((a, b) => b.oldestInvoiceAgeDays - a.oldestInvoiceAgeDays);

  let response = `You're owed ${formatAmount(totalOwed)}.`;

  // Mention top 3 by age
  const topThree = byAge.slice(0, 3);
  if (topThree.length > 0) {
    response += ` Your biggest invoice is ${topThree[0]!.oldestInvoiceAgeDays} days old`;

    if (topThree.length > 1) {
      response += `, then ${topThree[1]!.oldestInvoiceAgeDays} days`;
    }
    if (topThree.length > 2) {
      response += `, then ${topThree[2]!.oldestInvoiceAgeDays} days`;
    }
    response += ".";
  }

  // Only speak customer names if mentioned in query
  if (options.customerMentionedInQuery && options.customerNameFromQuery) {
    const matchingCustomer = data.find((c) =>
      c.customerName.toLowerCase().includes(options.customerNameFromQuery!.toLowerCase()),
    );
    if (matchingCustomer) {
      response += ` The ${matchingCustomer.customerName} invoice is ${formatAmount(matchingCustomer.totalOwed)}.`;
    }
  }

  return response;
}

/**
 * Formats the "what do I owe" response.
 * Counterparty names are always spoken (not private like customer names).
 */
export function formatYouOweResponse(data: CounterpartyAggregate[]): string {
  if (data.length === 0) {
    return "All costs are paid.";
  }

  // If single counterparty, give specific answer
  if (data.length === 1) {
    const cp = data[0]!;
    const name = cp.counterpartyName ?? "costs with no supplier specified";
    return `You owe ${name} ${formatAmount(cp.totalOwed)}.`;
  }

  // Multiple counterparties: list them
  const total = data.reduce((sum, cp) => sum + cp.totalOwed, 0);
  let response = `You owe ${formatAmount(total)} across ${data.length} suppliers. `;

  // List top 3 by amount
  const byAmount = [...data].sort((a, b) => b.totalOwed - a.totalOwed).slice(0, 3);

  byAmount.forEach((cp, i) => {
    const name = cp.counterpartyName ?? "unspecified suppliers";
    response += `${name}: ${formatAmount(cp.totalOwed)}`;
    if (i < byAmount.length - 1) response += ", ";
  });

  response += ".";

  return response;
}

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

import type { RealtimeToolDef } from "@/lib/realtime";
import type { CustomerAggregate, CounterpartyAggregate } from "@/lib/money-position-math";

/**
 * Tools the Realtime session can call to fetch ledger data.
 * The voice UI handles these tool calls client-side and calls the server actions.
 */
export const LEDGER_QUERY_TOOLS: RealtimeToolDef[] = [
  {
    type: "function",
    name: "get_owed_to_you",
    description:
      "Get the total amount customers owe the contractor (unpaid invoices). Call this when the contractor asks 'what am I owed' or similar.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "get_you_owe",
    description:
      "Get the total amount the contractor owes to suppliers (unpaid costs). Call this when the contractor asks 'what do I owe' without naming a specific supplier.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "get_you_owe_counterparty",
    description:
      "Get the amount the contractor owes to a specific supplier/counterparty. Call this when the contractor asks 'what do I owe [name]' with a specific supplier name.",
    parameters: {
      type: "object",
      properties: {
        counterparty_name: {
          type: "string",
          description: "The name of the supplier/counterparty the contractor asked about.",
        },
      },
      required: ["counterparty_name"],
    },
  },
  {
    type: "function",
    name: "get_job_profit",
    description:
      "Get the profit and margin for a specific job identified by customer name or job description. Call this when the contractor asks 'what did [job/customer name] make' or similar.",
    parameters: {
      type: "object",
      properties: {
        job_identifier: {
          type: "string",
          description:
            "The customer name, job description, or identifier the contractor used to refer to the job.",
        },
      },
      required: ["job_identifier"],
    },
  },
  {
    type: "function",
    name: "get_whats_left",
    description:
      "Get what's left safe to spend: collected money after deducting costs paid, motko's fees, and VAT to set aside. Call this when the contractor asks 'what's left' or similar.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

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

THE OPENING TURN:
Your FIRST turn is a greeting and nothing else. Say one short line — "What would
you like to know about your money?" or similar — and then STOP and wait.

On that first turn you MUST NOT call any tool, MUST NOT state any figure, and
MUST NOT answer any of the supported queries. The contractor has not asked you
anything yet. Volunteering what they are owed before they ask means speaking a
figure they did not request and cannot see on screen to check.

EVERY TURN AFTER THAT:
1. Listen to the contractor's question about money
2. Match it to one of the five supported queries below
3. Call the matching tool and speak the answer using ONLY the server's figures
4. Wait for the next question

The contractor may ask more than one question. Answer each on its merits. Never
treat a question as unwelcome because you have already answered one, and never
end the conversation yourself — the contractor closes it when they are done.

SUPPORTED QUERIES (exactly five):
1. What am I owed? — outstanding invoices total and top few by age
2. What do I owe? — unpaid costs by supplier
3. What do I owe [counterparty name]? — unpaid costs for a specific supplier
4. What did [job/customer name] make? — job profit and margin
5. What's left? — safe to spend after costs, fees, and VAT

MATCH ON MEANING, NOT ON WORDING:
Those five are descriptions, not phrases to match literally. A contractor asks
in their own words, and every one of these is query 1:
  "What am I owed?" / "How much money am I owed?" / "How much am I owed?"
  "What's outstanding?" / "Who owes me?" / "How much is out there?"
The same latitude applies to all five. If a question plainly means one of the
five, it IS that one — answer it.

OUT-OF-SET QUERIES:
Only genuinely different questions are out of set: trends over time, comparisons
between periods or customers, rankings, or a request to CHANGE something (mark a
cost paid, send an invoice). If it is one of those, say:
"I can't answer that yet. I can tell you: what you're owed, what you owe, what a job made, or what's left. Try one of those."

Never refuse a question that is one of the five reworded. Refusing "how much am I
owed" — which is query 1 in other words — is a failure, not a safe default.

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

Answer each question the contractor asks. Do not close the session yourself.`;
}

/**
 * Classifies a query string into one of the five supported types or out_of_set.
 * This is a simplified synchronous classifier for testing.
 * In production, the OpenAI Realtime model would handle classification.
 */
export async function classifyQuery(query: string): Promise<QueryClassification> {
  const normalized = query.toLowerCase().trim();

  // The five supported queries are matched FIRST, and out-of-set is the
  // fall-through.
  //
  // This used to run the other way round, and one of the out-of-set patterns
  // was /send|create|make|update/i. "What did the Smith job make" contains
  // "make", so query 4 — an advertised query, named in the surface's own
  // explainer — matched an out-of-set pattern before its own branch could be
  // reached. The branch was unreachable by any phrasing containing the word it
  // is named after.
  //
  // Ordering is the fix rather than a narrower regex: a supported query that
  // matches its own branch can no longer be stolen by a broad exclusion, and
  // the exclusions stay broad enough to do their job on everything else.

  // 1. What am I owed?
  //
  // Matched on meaning rather than on one literal phrasing. The device
  // transcript that prompted this fix reads "How much money am I owed?" — query
  // 1 in a contractor's own words — being refused with a list whose first item
  // is "what you're owed".
  if (
    /\b(what|how much)\b.*\bowed\b/.test(normalized) ||
    normalized.includes("what's owed to me") ||
    normalized.includes("whats owed to me") ||
    /\bwho owes me\b/.test(normalized) ||
    /\bwhat(?:'s| is)? outstanding\b/.test(normalized)
  ) {
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

  // Nothing matched one of the five. Anything asking for a trend, a comparison,
  // a ranking, or a CHANGE to the ledger is out of set — as is anything else
  // that reaches here.
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

/**
 * Formats the "what's left" response: safe to spend total and deduction breakdown.
 */
export function formatWhatsLeftResponse(data: {
  total: number;
  costsPaid: number;
  motkoFees: number;
  vatToSetAside: number | null;
}): string {
  // Handle zero specially
  if (data.total === 0) {
    return "You've got nothing left to spend.";
  }

  // Handle negative as shortfall
  if (data.total < 0) {
    return `You're down ${formatAmount(Math.abs(data.total))}.`;
  }

  // Build list of non-zero deductions with amounts
  const deductions: string[] = [];

  if (data.costsPaid > 0) {
    deductions.push(`${formatAmount(data.costsPaid)} in costs`);
  }

  if (data.motkoFees > 0) {
    deductions.push(`${formatAmount(data.motkoFees)} in motko's fees`);
  }

  if (data.vatToSetAside !== null && data.vatToSetAside > 0) {
    deductions.push(`${formatAmount(data.vatToSetAside)} set aside for VAT`);
  }

  // Positive total
  let response = `You've got ${formatAmount(data.total)} safe to spend`;

  // If there are deductions, name them
  if (deductions.length > 0) {
    response += ` — that's after ${deductions.join(", ")}`;
  }

  response += ".";

  return response;
}

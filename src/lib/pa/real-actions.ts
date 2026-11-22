// The production PaActions: the existing server actions, unchanged.
//
// Imported lazily so that merely importing the PA lib (in a test, say) does not
// pull in the "use server" modules and everything they import. Each action
// authenticates from the request's cookies, so these only work inside a
// signed-in request — which is the only place the agent runs.

import type { PaActions } from "./types";

export const realActions: PaActions = {
  createManualJob: async () => (await import("@/app/jobs/actions")).createManualJob(),
  saveSowDelta: async (input) => (await import("@/app/jobs/actions")).saveSowDelta(input),
  redraftJob: async (input) => (await import("@/app/jobs/actions")).redraftJob(input),
  updateQuoteLineItems: async (input) =>
    (await import("@/app/jobs/actions")).updateQuoteLineItems(
      input as Parameters<typeof import("@/app/jobs/actions").updateQuoteLineItems>[0],
    ),
  setQuotePricingMode: async (input) =>
    (await import("@/app/jobs/actions")).setQuotePricingMode({
      ...input,
      fixedAmount: input.fixedAmount ?? null,
    }),
  sendQuote: async (input) => (await import("@/app/jobs/actions")).sendQuote(input),
  createInvoice: async (input) => (await import("@/app/dashboard/actions")).createInvoice(input),
  markInvoicePaid: async (input) =>
    (await import("@/app/jobs/[id]/mark-paid-actions")).markInvoicePaid(input),
  deleteDraftJob: async (input) => (await import("@/app/jobs/actions")).deleteDraftJob(input),
  getMoneyPosition: async () =>
    (await import("@/app/jobs/money-position-actions")).getMoneyPosition(),
};

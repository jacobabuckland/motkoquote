import { generateSowNarrative, draftQuoteLineItems } from "@/lib/claude";
import { compileDraftToLineItems } from "@/lib/compile-draft";
import { applyAgreedDayRate, applyAgreedFixedPrice } from "@/lib/agreed-costs";
import { applyPricingMode } from "@/lib/pricing-mode";
import { buildQuoteScope, type QuoteScope } from "@/lib/pdf/quote-payload";
import { computeQuoteTotals } from "@/lib/quote-math";
import { usedGenericFallback } from "@/lib/question-packs/fallback";
import { sowToExtraction, EMPTY_SOW_STATE, type SowState } from "@/lib/schemas/sow";
import type { LineItem } from "@/lib/schemas/job";

// Drafting a quote for someone with no account.
//
// This is the same computational core the authenticated path runs — extraction,
// narrative, LLM line-item structure, then deterministic pricing in code — with
// every database read and write removed. It imports no Supabase client, by
// design and not by accident: the guest path's "zero writes" property should be
// structural, not a promise about what this file happens not to call.
//
// What a guest does NOT get, because it does not exist for them and must not be
// invented: stored day/overtime/callout/travel rates, markup, team members,
// rate cards, similar past jobs, known material prices, learned tendencies.
// Each is omitted (null / empty), never stubbed with a plausible default.

export type GuestQuote = {
  reference: string;
  createdAt: string;
  jobType?: string;
  // The guest's SoW never reaches a row — it lives in memory for the length of
  // the call — so the scope is projected here rather than loaded, and the
  // guest document gains the same section a stored quote gets.
  scope?: QuoteScope;
  lineItems: LineItem[];
  subtotal: number;
  total: number;
  customer: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
  } | null;
  // Editor-only prompts from the compiler. Never rendered on the document.
  contractorFlags: string[];
  // True when labour could not be priced because no rate was available: a guest
  // has no saved day rate, and none was agreed in the call. The preview says so
  // in plain words rather than presenting £0 as if it were a price.
  unpricedLabour: boolean;
};

// A guest quote has no row and therefore no id to derive a reference from.
// Generated client-side and carried on the artefact so the same reference
// appears on screen and on the PDF.
export const generateGuestReference = (): string => {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) out += alphabet[byte % alphabet.length];
    return out;
  }
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
};

export type DraftGuestQuoteInput = {
  sow: SowState;
  reference: string;
  createdAt: string;
};

export const draftGuestQuote = async ({
  sow,
  reference,
  createdAt,
}: DraftGuestQuoteInput): Promise<GuestQuote> => {
  const completedSow: SowState = {
    ...EMPTY_SOW_STATE,
    ...sow,
    complete: true,
    next_question: undefined,
    used_generic_fallback: usedGenericFallback(sow.job_type),
  };

  // Two LLM calls, no lookups. The authenticated path runs these alongside four
  // database reads that personalise the result; a guest has nothing to
  // personalise from, so the reads are simply absent.
  const overviewNarrative = await generateSowNarrative(completedSow, {
    trade: null,
    // The narrative prompt takes the trading name to write in the contractor's
    // voice. A guest has no trading name and one must never be fabricated, so
    // it is passed empty — the narrative then describes the work without
    // claiming a business.
    companyName: "",
  });

  const extraction = sowToExtraction({ ...completedSow, overview_narrative: overviewNarrative });
  const statedPrices = completedSow.stated_prices ?? [];

  const draft = await draftQuoteLineItems(
    extraction,
    {
      trade: null,
      day_rate: null,
      overtime_rate: null,
      callout_min: null,
      travel_rate: null,
      markup_pct: null,
      team_members: [],
      similar_past_jobs: [],
      known_material_prices: [],
      rate_cards: [],
      contractor_tendencies: [],
    },
    statedPrices,
  );

  // The pricing contract is unchanged: the model proposes structure, code
  // computes every amount. The only rate a guest can have is one they stated in
  // the call themselves (agreed_costs), which is their own number, not a
  // default we chose for them.
  const agreedDayRate = completedSow.agreed_costs?.day_rate ?? null;

  const { lineItems: compiledItems, contractorFlags } = compileDraftToLineItems(
    draft.line_items,
    {
      day_rate: agreedDayRate,
      overtime_rate: null,
      markup_pct: null,
      team_members: [],
      rate_cards: [],
      known_material_prices: [],
      owner_label: "Owner",
      has_pricing_history: false,
    },
    draft.contractor_flags,
    statedPrices,
  );

  const dayRated = applyAgreedDayRate(compiledItems, agreedDayRate);
  const calculated = applyAgreedFixedPrice(dayRated, completedSow.agreed_costs?.fixed_price);
  // Derived before pricing, because the fixed-mode works line's wording
  // depends on whether the document will carry a scope section.
  const scope = buildQuoteScope(completedSow, calculated) ?? undefined;
  const lineItems = applyPricingMode(calculated, completedSow, Boolean(scope));

  // Whether any line's amount is absent rather than zero. The compiler marks
  // the line itself (`unpriced`), and the document renders an explicit
  // not-priced state from that mark — this flag only drives the preview screen's
  // plain-words explanation of why.
  const unpricedLabour = lineItems.some((item) => item.unpriced);

  const { subtotal, total } = computeQuoteTotals(lineItems, false);

  return {
    reference,
    createdAt,
    jobType: extraction.job_type,
    scope,
    lineItems,
    subtotal,
    total,
    customer: completedSow.customer_name ||
      completedSow.customer_phone ||
      completedSow.customer_email ||
      completedSow.site_address
      ? {
          name: completedSow.customer_name ?? undefined,
          email: completedSow.customer_email ?? undefined,
          phone: completedSow.customer_phone ?? undefined,
          address: completedSow.site_address ?? undefined,
        }
      : null,
    contractorFlags,
    unpricedLabour,
  };
};

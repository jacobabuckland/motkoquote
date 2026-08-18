"use server";

import { sowStateSchema } from "@/lib/schemas/sow";
import { draftGuestQuote, type GuestQuote } from "@/lib/guest/quote";
import { z } from "zod";

// The one server action the guest flow calls. It runs the same computational
// core as the authenticated draft — extraction, narrative, LLM line-item
// structure, deterministic pricing in code — and touches no database: no
// Supabase client is imported here or by @/lib/guest/quote, so "zero writes"
// is a property of the module graph rather than a promise about behaviour.
//
// It is unauthenticated by necessity (a guest has no session) but it creates
// nothing, references no row, and returns the quote to the caller to hold
// client-side.

const draftGuestQuoteSchema = z.object({
  sow: sowStateSchema,
  reference: z.string().min(1).max(32),
  createdAt: z.string().min(1),
});

export const draftGuestQuoteAction = async (
  input: z.infer<typeof draftGuestQuoteSchema>,
): Promise<GuestQuote> => {
  const { sow, reference, createdAt } = draftGuestQuoteSchema.parse(input);
  return draftGuestQuote({ sow, reference, createdAt });
};

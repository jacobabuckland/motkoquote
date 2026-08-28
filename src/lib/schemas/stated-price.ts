import { z } from "zod";

/**
 * Qualifiers that change how a stated price is interpreted.
 */
export const statedPriceQualifiersSchema = z.object({
  // Unit price (e.g., "£85 each")
  each: z.boolean(),
  // Labour included (e.g., "£85 fitted")
  fitted: z.boolean(),
  // Already settled with customer (e.g., "they've already paid that")
  already_paid: z.boolean(),
  // Explicitly out of scope (e.g., "but that's not included")
  excluded: z.boolean(),
});

export type StatedPriceQualifiers = z.infer<typeof statedPriceQualifiersSchema>;

/**
 * A single monetary amount stated during the conversation.
 */
export const statedPriceSchema = z.object({
  // Amount in integer pence, parsed via parseSpokenMoney
  amount: z.number().int(),
  // What the amount attaches to, as stated. Nullable when no clear attachment.
  item: z.string().nullable(),
  // Where in the transcript this came from
  transcript_span: z.string(),
  // Semantic flags that affect interpretation
  qualifiers: statedPriceQualifiersSchema,
  // Set when this value was later replaced by the contractor.
  // Points to the amount that superseded it (for audit trail).
  superseded_by: z.number().int().nullable(),
});

export type StatedPrice = z.infer<typeof statedPriceSchema>;

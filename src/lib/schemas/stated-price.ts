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
  // Set when the extractor refuses to lock this amount because it's ambiguous
  // (ranges, hedges, rate units). Refused prices never become chargeable.
  refused: z.boolean().optional(),
  // HOW MANY, where the contractor said a count beside a per-unit price.
  //
  // A stated price carried no quantity, so an `each` price had to take the
  // count from the drafting model's line — and the model writes the count into
  // the DESCRIPTION and leaves `quantity` at 1. "Eight bags at eleven pounds a
  // bag" came out as one bag at £11: £11 charged against £88 stated, on a
  // quote the contractor sends. Measured on four of five voice runs on 16 Sep,
  // and it undercharges every time.
  //
  // The extractor already finds these numbers — `followedByUnit` exists to
  // recognise "28 bags" and step over it so it is not mistaken for money. It
  // simply threw the count away instead of recording it.
  //
  // OPTIONAL and nullish: absent means nobody stated a count, which is the
  // behaviour every existing caller and frozen fixture already has.
  quantity: z.number().positive().nullable().optional(),
});

export type StatedPrice = z.infer<typeof statedPriceSchema>;

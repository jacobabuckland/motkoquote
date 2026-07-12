import { z } from "zod";

// A single address captured anywhere in the app (business, client, site).
// `formatted` is the human-readable one-line address that contracts/quotes
// render — it is always present, even when the contractor ignored the Google
// dropdown and just typed free text. The remaining fields are the structured
// components Google Places gives us on selection; they ride alongside the
// formatted string so future features (mapping, dedupe, prefill) can reuse
// them without re-parsing prose. Everything except `formatted` is optional so
// a raw typed address is still a valid AddressValue.
export const structuredAddressSchema = z.object({
  formatted: z.string(),
  line1: z.string().optional(),
  line2: z.string().optional(),
  town: z.string().optional(),
  county: z.string().optional(),
  postcode: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  place_id: z.string().optional(),
});

export type StructuredAddress = z.infer<typeof structuredAddressSchema>;

// A plain typed address with no structured components resolved yet — the
// fallback shape produced on every keystroke and whenever Places is
// unavailable.
export const rawAddress = (formatted: string): StructuredAddress => ({ formatted });

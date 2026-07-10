import { z } from "zod";

export const brandingSchema = z.object({
  logo_url: z.string().url().optional(),
  brand_color: z.string().optional(),
  footer_terms: z.string().optional(),
});

export const teamMemberInputSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  day_rate: z.coerce.number().nonnegative().optional(),
});

export const merchantAccountInputSchema = z.object({
  merchant_id: z.string().uuid(),
  trade_discount_pct: z.coerce.number().min(0).max(100).default(0),
});

export const rateCardInputSchema = z.object({
  work_type: z.string().min(1),
  unit: z.string().min(1),
  rate_per_unit: z.coerce.number().nonnegative(),
  complexity_notes: z.string().optional(),
});

export const contractorSetupSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  company_number: z.string().optional(),
  trade: z.string().optional(),
  vat_registered: z.boolean().default(false),
  vat_number: z.string().optional(),
  day_rate: z.coerce.number().nonnegative().optional(),
  overtime_rate: z.coerce.number().nonnegative().optional(),
  callout_min: z.coerce.number().nonnegative().optional(),
  travel_rate: z.coerce.number().nonnegative().optional(),
  markup_pct: z.coerce.number().min(0).max(100).optional(),
  branding: brandingSchema.default({}),
  team_members: z.array(teamMemberInputSchema).default([]),
  merchant_accounts: z.array(merchantAccountInputSchema).default([]),
  rate_cards: z.array(rateCardInputSchema).default([]),
});

export type ContractorSetupInput = z.infer<typeof contractorSetupSchema>;

import { z } from "zod";
import { nullishString } from "@/lib/schemas/job";

export const CONTRACT_TEMPLATE_KEYS = [
  "small_works",
  "standard_project",
  "large_staged_project",
  "regulated_certified_works",
  "maintenance_recurring",
] as const;

export const contractTemplateKeySchema = z.enum(CONTRACT_TEMPLATE_KEYS);
export type ContractTemplateKey = z.infer<typeof contractTemplateKeySchema>;

// Set once per contractor, reused on every contract they send.
export const businessProfileSchema = z.object({
  trading_name: nullishString,
  business_structure: nullishString,
  registered_address: nullishString,
  business_phone: nullishString,
  business_email: nullishString,
  certifications: nullishString,
  insurer_name: nullishString,
  public_liability_cover: nullishString,
  default_payment_terms: nullishString,
  payment_methods: nullishString,
  bank_details: nullishString,
  default_warranty_period: nullishString,
  governing_law: nullishString,
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;

// Set per contract — the fields not already derivable from the job, quote,
// customer or business profile.
export const contractJobInputSchema = z.object({
  client_address: nullishString,
  client_phone: nullishString,
  site_address: nullishString,
  scope_of_work: nullishString,
  exclusions: nullishString,
  materials_by: nullishString,
  materials_notes: nullishString,
  payment_schedule: nullishString,
  start_date: nullishString,
  estimated_duration: nullishString,
  completion_date: nullishString,
  access_arrangements: nullishString,
  warranty_period: nullishString,
  building_regs_responsibility: nullishString,
  cancellation_start: nullishString,
  special_terms: nullishString,
});

export type ContractJobInput = z.infer<typeof contractJobInputSchema>;

// Fully-resolved {{variable}} -> value map passed to the template renderer.
export type ContractVariables = Record<string, string>;

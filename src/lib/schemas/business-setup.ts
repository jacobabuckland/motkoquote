import { z } from "zod";
import { nullishString } from "@/lib/schemas/job";
import { businessProfileSchema, type BusinessProfile } from "@/lib/schemas/contract";

// The voice equivalent of the manual "Set up your business" form — a flat
// set of scalar fields (no arrays like the SoW's rooms) so merging a turn's
// delta into the running state is just "new value wins, else keep the old
// one" per field. Deliberately covers only what a spoken interview can
// realistically capture: team members, merchant discounts and rate cards
// stay manual-form-only for now. `notes` is the one list field — freeform
// context the contractor mentions that doesn't map to a structured column
// (working preferences, subcontractors they use, jobs they won't take on),
// captured verbatim and appended turn-by-turn so it survives into the
// semantic knowledge layer (see completeSetupConversation /
// syncBusinessSetupKnowledge) rather than being discarded.
export const businessSetupStateSchema = z.object({
  company_name: nullishString,
  trade: nullishString,
  vat_registered: z.boolean().nullable().default(null),
  vat_number: nullishString,
  day_rate: z.number().nullable().default(null),
  overtime_rate: z.number().nullable().default(null),
  callout_min: z.number().nullable().default(null),
  travel_rate: z.number().nullable().default(null),
  markup_pct: z.number().nullable().default(null),
  business_profile: businessProfileSchema.default({}),
  notes: z.array(z.string()).default([]),
});

export type BusinessSetupState = z.infer<typeof businessSetupStateSchema>;

export const EMPTY_BUSINESS_SETUP_STATE: BusinessSetupState = {
  company_name: undefined,
  trade: undefined,
  vat_registered: null,
  vat_number: undefined,
  day_rate: null,
  overtime_rate: null,
  callout_min: null,
  travel_rate: null,
  markup_pct: null,
  business_profile: {},
  notes: [],
};

// What the model reports per turn — every field optional, since a turn
// usually only touches one or two things the contractor just said.
export const businessSetupDeltaSchema = z.object({
  company_name: nullishString,
  trade: nullishString,
  vat_registered: z.boolean().optional(),
  vat_number: nullishString,
  day_rate: z.number().optional(),
  overtime_rate: z.number().optional(),
  callout_min: z.number().optional(),
  travel_rate: z.number().optional(),
  markup_pct: z.number().optional(),
  business_profile: businessProfileSchema.partial().default({}),
  notes: z.array(z.string()).default([]),
});

export type BusinessSetupDelta = z.infer<typeof businessSetupDeltaSchema>;

// JSON-schema parameters for the Realtime API's `update_business_setup`
// tool. Kept in sync with businessSetupDeltaSchema by hand, same convention
// as SOW_DELTA_TOOL_PARAMETERS in schemas/sow.ts.
export const BUSINESS_SETUP_DELTA_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    trade: { type: "string", description: "e.g. 'Electrician', 'Plasterer'." },
    vat_registered: { type: "boolean" },
    vat_number: { type: "string" },
    day_rate: { type: "number", description: "Standard day rate in GBP." },
    overtime_rate: { type: "number", description: "Overtime/weekend day rate in GBP." },
    callout_min: { type: "number", description: "Minimum call-out charge in GBP." },
    travel_rate: { type: "number", description: "Travel charge in GBP." },
    markup_pct: { type: "number", description: "Materials markup percentage." },
    business_profile: {
      type: "object",
      properties: {
        trading_name: { type: "string" },
        business_structure: {
          type: "string",
          description: "e.g. 'Sole trader', 'Limited company'.",
        },
        registered_address: { type: "string" },
        business_phone: { type: "string" },
        business_email: { type: "string" },
        certifications: { type: "string", description: "e.g. 'Gas Safe 123456'." },
        insurer_name: { type: "string" },
        public_liability_cover: { type: "string", description: "e.g. '£2,000,000'." },
        default_payment_terms: { type: "string" },
        payment_methods: { type: "string" },
        bank_details: { type: "string" },
        default_warranty_period: { type: "string", description: "e.g. '12 months'." },
        governing_law: { type: "string", description: "e.g. 'England & Wales'." },
      },
      required: [],
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description:
        "Freeform context that doesn't fit another field — working preferences, jobs they won't " +
        "take on, subcontractors they use, anything worth remembering for future conversations.",
    },
  },
  required: [],
} as const;

const mergeBusinessProfile = (
  base: BusinessProfile,
  delta: Partial<BusinessProfile>,
): BusinessProfile => {
  const merged: BusinessProfile = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
};

// Deterministically folds a turn's delta into the running BusinessSetupState.
// Every scalar field is "new value wins if present, else keep what we had";
// `notes` is the one exception — appended, not overwritten, so context from
// earlier turns isn't lost.
export const mergeBusinessSetupDelta = (
  current: BusinessSetupState | null,
  delta: BusinessSetupDelta,
): BusinessSetupState => {
  const base = current ?? EMPTY_BUSINESS_SETUP_STATE;

  return {
    company_name: delta.company_name ?? base.company_name,
    trade: delta.trade ?? base.trade,
    vat_registered: delta.vat_registered ?? base.vat_registered,
    vat_number: delta.vat_number ?? base.vat_number,
    day_rate: delta.day_rate ?? base.day_rate,
    overtime_rate: delta.overtime_rate ?? base.overtime_rate,
    callout_min: delta.callout_min ?? base.callout_min,
    travel_rate: delta.travel_rate ?? base.travel_rate,
    markup_pct: delta.markup_pct ?? base.markup_pct,
    business_profile: mergeBusinessProfile(base.business_profile, delta.business_profile),
    notes: delta.notes.length > 0 ? [...base.notes, ...delta.notes] : base.notes,
  };
};

// Wraps an `update_business_setup` tool-call payload into the shape
// mergeBusinessSetupDelta expects, then folds it into state.
export const mergeBusinessSetupToolDelta = (
  current: BusinessSetupState | null,
  raw: unknown,
): BusinessSetupState => {
  const delta = businessSetupDeltaSchema.parse(raw);
  return mergeBusinessSetupDelta(current, delta);
};

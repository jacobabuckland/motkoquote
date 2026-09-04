import type { SowState } from "@/lib/schemas/sow";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { LineItem } from "@/lib/schemas/job";
import type { CompileContext } from "@/lib/compile-draft";

/**
 * Scenario 1: Bathroom refit with superseded price
 *
 * Coverage:
 * - Superseded stated price (tiling area corrected from 8m² to 14m²)
 * - Mixed pricing (day-rate labour + stated materials)
 * - Customer-supplied materials (tiles)
 */

export const transcript = `
Hi, I need a quote for a small bathroom refit. It's an upstairs bathroom, pretty straightforward.
The customer wants a full strip-out, new bath with shower over it, basin and pedestal, and a toilet.
The suite is being supplied by the customer, they've already bought that.
Tiling labour is eight hundred pounds.
Actually, let me check my notes... sorry, tiling labour is one thousand four hundred pounds, not eight hundred.
The tiles themselves are fourteen square metres and customer-supplied.
There's one radiator swap needed, a heated towel rail going in. I normally charge one hundred and forty pounds for a radiator swap.
The soil stack condition is unknown until we open it up, so that might need some work.
Making good is included but decorating is excluded.
It's me and my apprentice for about five days.
The customer needs it done before the tenth of August.
We're VAT registered and I mark up materials by twenty-five percent.
`;

export const sowState: SowState = {
  job_type: "bathroom",
  rooms: [
    {
      name: "Upstairs bathroom",
      dimensions: undefined,
      work_items: [
        "Full strip-out",
        "Install new bath with shower over",
        "Install basin and pedestal",
        "Install toilet",
        "Wall tiling — 14m²",
        "One radiator swap (heated towel rail)",
      ],
    },
  ],
  materials_mentioned: ["bathroom suite", "wall tiles", "heated towel rail"],
  access_issues: undefined,
  existing_conditions: undefined,
  timeline: undefined,
  labour_plan: {
    people_count: 2,
    duration_days: 5,
    crew_description: "me and my apprentice",
    working_dates: undefined,
  },
  deadline: {
    quote_by: undefined,
    job_by: "10th of August",
  },
  materials_supply: {
    contractor_supplied: [],
    customer_supplied: ["bathroom suite", "wall tiles"],
  },
  agreed_costs: null,
  pricing: {
    mode: "days",
    fixed_amount: null,
  },
  inclusions: ["Making good"],
  exclusions: ["Decorating"],
  additional_items: [],
  assumptions_and_unknowns: [
    {
      description: "Soil stack condition unknown until opened",
      treatment: "provisional_sum",
    },
  ],
  customer_name: "[REDACTED]",
  site_address: "[REDACTED]",
  customer_phone: undefined,
  customer_email: undefined,
  complete: true,
  next_question: undefined,
  overview_narrative: undefined,
  reclassification_count: 0,
  used_generic_fallback: false,
  wrap_incomplete: false,
  unasked_required: [],
  stated_prices: [],
  declined_slots: [],
};

/**
 * The contractor's own configuration, which is INPUT to the pipeline in the
 * same way the transcript is. A real quote prices labour from the contractor's
 * stored rates, not from anything said on the call, so a fixture that omits
 * them cannot produce a priced labour line at all — `day_rate: null` makes
 * every labour line `unpriced`, and that is precisely how this fixture's
 * expected values came to be nonsense in the first place.
 *
 * The numbers are declared here, once, so the expected line items below are
 * arithmetic anyone can check by hand rather than whatever the compiler
 * happened to emit.
 */
export const contractorContext: CompileContext = {
  day_rate: 320,
  overtime_rate: 480,
  markup_pct: 25,
  team_members: [
    { id: "apprentice-1", name: "Apprentice", role: "apprentice", day_rate: 120 },
  ],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
};

export const expectedStatedPrices: StatedPrice[] = [
  {
    amount: 80000,
    item: "Tiling labour",
    transcript_span:
      "Tiling labour is eight hundred pounds",
    qualifiers: {
      each: false,
      fitted: false,
      already_paid: false,
      excluded: false,
    },
    superseded_by: 140000,
    refused: false,
  },
  {
    amount: 140000,
    item: "tiling labour",
    transcript_span: "sorry, tiling labour is one thousand four hundred pounds, not eight hundred",
    qualifiers: {
      each: false,
      fitted: false,
      already_paid: false,
      excluded: false,
    },
    superseded_by: null,
    refused: false,
  },
  {
    amount: 14000,
    item: "a radiator swap",
    transcript_span:
      "I normally charge one hundred and forty pounds for a radiator swap",
    qualifiers: {
      each: false,
      fitted: false,
      already_paid: false,
      excluded: false,
    },
    superseded_by: null,
    refused: false,
  },
];

/**
 * THE EXPECTED QUOTE, DERIVED FROM THE TRANSCRIPT AND THE RATES ABOVE.
 *
 * Every figure here is arithmetic on something stated, and each line says which
 * one. Nothing in this array came from running the pipeline — that is the whole
 * point of the file, and the version it replaces failed it completely: it
 * carried `unit_price: 140` (the radiator swap) on the labour line, the
 * customer-supplied suite, the tile adhesive, the tile trim AND the soil stack,
 * while £1,400 — the stated tiling price this scenario exists to protect —
 * appeared nowhere at all.
 *
 * That array was written by running the compiler and recording what came out.
 * A fixture built that way cannot fail when the code is wrong, only when it
 * changes: it had faithfully recorded a live over-matching defect as the
 * correct answer.
 *
 * If the pipeline disagrees with anything below, that is a finding about the
 * pipeline. Do not edit this array to make a test pass.
 */
export const expectedLineItems: LineItem[] = [
  // "It's me and my apprentice for about five days" — 5 x £320 owner
  // + 5 x £120 apprentice = £2,200. Priced from the crew breakdown, which is
  // why `people` is present and unit_price is not the source of truth.
  {
    description: "Bathroom refit labour — owner and apprentice, 5 days",
    category: "labour",
    quantity: 5,
    unit: "day",
    unit_price: 440,
    multiplier: 1,
    people_count: 2,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    people: [
      { label: "Owner", days: 5, day_rate: 320 },
      { label: "Apprentice", days: 5, day_rate: 120 },
    ],
    includes_tasks: [
      "Full strip-out",
      "Install new bath with shower over",
      "Install basin and pedestal",
      "Install toilet",
      "Making good",
    ],
  },
  // "tiling labour is one thousand four hundred pounds, not eight hundred".
  // The superseded £800 must appear on NO line in this quote.
  {
    description: "Wall tiling labour — 14m²",
    category: "labour",
    quantity: 1,
    unit: "job",
    unit_price: 1400,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
  // "I normally charge one hundred and forty pounds for a radiator swap."
  // One swap, so £140 — and £140 belongs on this line and nowhere else.
  {
    description: "Radiator swap — heated towel rail",
    category: "labour",
    quantity: 1,
    unit: "job",
    unit_price: 140,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
  // "The suite is being supplied by the customer, they've already bought that."
  // Customer-supplied lines price at £0 and appear for scope only.
  {
    description: "Bathroom suite (bath with shower over, basin and pedestal, toilet)",
    category: "materials",
    quantity: 1,
    unit: "lot",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    supplied_by: "customer",
  },
  // "The tiles themselves are fourteen square metres and customer-supplied."
  {
    description: "Wall tiles — 14m²",
    category: "materials",
    quantity: 14,
    unit: "m²",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    supplied_by: "customer",
  },
  // "The soil stack condition is unknown until we open it up." A provisional
  // sum, not a priced line — editable, and flagged as an estimate rather than
  // presented as a real figure.
  {
    description: "Soil stack — condition unknown until opened up",
    category: "other",
    quantity: 1,
    unit: "sum",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    provisional: true,
  },
];

/**
 * Amounts that must appear on NO line of the compiled quote.
 *
 * £800 is the superseded tiling price. A quote carrying it has taken a figure
 * the contractor explicitly retracted mid-call and put it in front of a
 * customer, which is the single worst thing this pipeline can do.
 */
export const forbiddenAmounts: number[] = [800];

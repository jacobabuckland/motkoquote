import type { SowState } from "@/lib/schemas/sow";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { LineItem } from "@/lib/schemas/job";

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
  },
];

export const expectedLineItems: LineItem[] = [
  {
    description: "Two-person team (contractor + apprentice) for full bathroom refurbishment over 5 working days",
    category: "labour",
    quantity: 1,
    unit: "day",
    unit_price: 140,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
  {
    description: "Bathroom suite (bath, basin and pedestal, toilet) — customer supplied",
    category: "materials",
    quantity: 1,
    unit: "lot",
    unit_price: 140,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    supplied_by: "customer",
  },
  {
    description: "Wall tiles — customer supplied (14m² coverage)",
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
  {
    description: "Heated towel rail — customer supplied",
    category: "materials",
    quantity: 1,
    unit: "item",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    supplied_by: "customer",
  },
  {
    description: "Tile adhesive and grout",
    category: "materials",
    quantity: 1,
    unit: "m²",
    unit_price: 140,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
  {
    description: "Tile trim and edge profiles",
    category: "materials",
    quantity: 1,
    unit: "m",
    unit_price: 140,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
  {
    description: "Silicone sealant (bathroom-grade)",
    category: "materials",
    quantity: 4,
    unit: "tube",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: true,
    assumption_note: undefined,
  },
  {
    description: "Plumbing consumables (pipe fittings, flexible hoses, waste fittings, isolation valves)",
    category: "materials",
    quantity: 1,
    unit: "lot",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: true,
    assumption_note: undefined,
  },
  {
    description: "Making good materials (plasterboard, screws, filler, tape)",
    category: "materials",
    quantity: 1,
    unit: "lot",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: true,
    assumption_note: undefined,
  },
  {
    description: "Soil stack inspection and remedial works",
    category: "other",
    quantity: 1,
    unit: "sum",
    unit_price: 140,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
];

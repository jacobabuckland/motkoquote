import type { SowState } from "@/lib/schemas/sow";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { LineItem } from "@/lib/schemas/job";

/**
 * Scenario 3: Downlights installation with customer-supplied materials
 *
 * Coverage:
 * - Customer-supplied materials priced at £0
 * - Day-rate labour calculation
 * - Multiple rooms
 */

export const transcript = `
Hi, I need to quote for a downlights installation. The customer wants LED downlights throughout.
It's the living room, dining room, and hallway.
Living room needs eight downlights, dining room needs six, and the hallway needs four.
That's eighteen downlights in total.
The customer has already bought all the lights themselves, so we're just doing the installation and wiring.
They've paid for the lights already, so that's sorted.
The existing wiring is in good condition, so we can work with that.
We'll need to make good the ceiling afterwards, patch and fill the holes.
It's me and my mate, should take us one day to complete.
I charge three hundred and forty pounds a day.
My mate is one hundred and twenty pounds a day.
The customer wants it done before the fifteenth of October.
`;

export const sowState: SowState = {
  job_type: "downlights",
  rooms: [
    {
      name: "Living room",
      dimensions: undefined,
      work_items: ["Install 8 LED downlights"],
    },
    {
      name: "Dining room",
      dimensions: undefined,
      work_items: ["Install 6 LED downlights"],
    },
    {
      name: "Hallway",
      dimensions: undefined,
      work_items: ["Install 4 LED downlights"],
    },
  ],
  materials_mentioned: ["LED downlights"],
  access_issues: undefined,
  existing_conditions: "Existing wiring in good condition",
  timeline: undefined,
  labour_plan: {
    people_count: 2,
    duration_days: 1,
    crew_description: "me and my mate",
    working_dates: undefined,
  },
  deadline: {
    quote_by: undefined,
    job_by: "15th of October",
  },
  materials_supply: {
    contractor_supplied: [],
    customer_supplied: ["LED downlights"],
  },
  agreed_costs: {
    day_rate: 340,
    fixed_price: null,
    deposit_amount: null,
    notes: "Owner £340/day, mate £120/day",
  },
  pricing: {
    mode: "days",
    fixed_amount: null,
  },
  inclusions: ["Making good the ceiling", "Patch and fill holes"],
  exclusions: [],
  additional_items: [],
  assumptions_and_unknowns: [],
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
    amount: 34000,
    item: "I charge",
    transcript_span: "I charge three hundred and forty pounds a day",
    qualifiers: {
      each: false,
      fitted: false,
      already_paid: false,
      excluded: false,
    },
    superseded_by: null,
  },
  {
    amount: 12000,
    item: "My mate",
    transcript_span: "My mate is one hundred and twenty pounds a day",
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
    description: "Downlights installation — 18 lights across living room, dining room, and hallway",
    category: "labour",
    quantity: 1,
    unit: "day",
    unit_price: 46000, // £340 + £120 = £460 per day in pence
    multiplier: 1,
    people_count: 2,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
  {
    description: "LED downlights — 18 units",
    category: "materials",
    quantity: 18,
    unit: "units",
    unit_price: 0, // Customer-supplied, so £0
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    supplied_by: "customer",
  },
];

import type { SowState } from "@/lib/schemas/sow";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { LineItem } from "@/lib/schemas/job";

/**
 * Scenario 2: Kitchen rewire with fixed-price quote
 *
 * Coverage:
 * - Fixed-price quote (contractor states a total)
 * - Rate-card items (sockets, consumer unit)
 * - Mixed materials supply
 */

export const transcript = `
Right, I've got a kitchen rewire to quote. It's a medium-sized kitchen, about four metres by three.
The customer wants twelve new double sockets, all new wiring throughout the kitchen.
Consumer unit needs upgrading as well, it's an old fuse box.
We'll supply the consumer unit, that's five hundred and twenty pounds for the unit and labour.
The sockets are eighty five each fitted, so that's twelve sockets.
Cooker circuit as well, needs a new hob point installing.
The customer is supplying the cooker itself, we're just doing the wiring and connection point.
Testing and certification included, making good the walls included.
I'll do the whole job for two thousand pounds all in. That's my fixed price.
It's just me working, should take about three days.
The customer needs it done by the end of September.
`;

export const sowState: SowState = {
  job_type: "kitchen",
  rooms: [
    {
      name: "Kitchen",
      dimensions: "4m × 3m",
      work_items: [
        "Full rewire",
        "Install 12 new double sockets",
        "Consumer unit upgrade",
        "Install new hob connection point",
      ],
    },
  ],
  materials_mentioned: ["double sockets", "consumer unit", "cooker", "hob"],
  access_issues: undefined,
  existing_conditions: "Old fuse box",
  timeline: undefined,
  labour_plan: {
    people_count: 1,
    duration_days: 3,
    crew_description: "just me",
    working_dates: undefined,
  },
  deadline: {
    quote_by: undefined,
    job_by: "end of September",
  },
  materials_supply: {
    contractor_supplied: ["consumer unit", "double sockets", "wiring"],
    customer_supplied: ["cooker"],
  },
  agreed_costs: null,
  pricing: {
    mode: "fixed",
    fixed_amount: 2000,
  },
  inclusions: ["Testing and certification", "Making good the walls"],
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
    amount: 52000,
    item: "unit and labour",
    transcript_span:
      "We'll supply the consumer unit, that's five hundred and twenty pounds for the unit and labour",
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
    amount: 8500,
    item: "sockets",
    transcript_span: "The sockets are eighty five each fitted, so that's twelve sockets",
    qualifiers: {
      each: true,
      fitted: true,
      already_paid: false,
      excluded: false,
    },
    superseded_by: null,
    refused: false,
  },
  {
    amount: 200000,
    item: "whole job for",
    transcript_span: "I'll do the whole job for two thousand pounds all in",
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

export const expectedLineItems: LineItem[] = [
  {
    description: "Kitchen rewire — complete works",
    category: "labour",
    quantity: 1,
    unit: "job",
    unit_price: 200000, // Fixed price in pence
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
  },
];

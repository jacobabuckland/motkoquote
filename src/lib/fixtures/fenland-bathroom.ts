import type { CompileContext } from "@/lib/compile-draft";
import type { DraftLineItem } from "@/lib/schemas/job";

// Structured form of fixtures/fenland-bathroom.md — the regression case for
// the pricing contract. A drafting output (the LLM's proposed STRUCTURE, no
// prices) plus the contractor's confirmed numbers, so compileDraftToLineItems
// can be asserted end-to-end: mixed-rate crew on one line, a task-split line
// that must NOT re-count days, customer-supplied £0 lines, contractor markup,
// a rate-card price, and a provisional sum.

export const fenlandContext: CompileContext = {
  day_rate: 340,
  overtime_rate: null,
  markup_pct: 25,
  team_members: [
    { id: "tm-liam", name: "Liam", role: "Apprentice", day_rate: 120 },
  ],
  rate_cards: [
    { id: "rc-radiator", work_type: "Radiator swap", unit: "radiator", rate_per_unit: 140 },
  ],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  // Mixed-rate crew, duration captured — the labour line's days are stated.
  // Five days, matching the crew line below (owner 5 + Liam 5). It said four,
  // which is fewer person-days than the fixture itself bills — the crew-day
  // ceiling caught the disagreement.
  labour_plan: { people_count: 2, duration_days: 5, crew_description: "me and Liam" },
};

export const fenlandDraft: DraftLineItem[] = [
  {
    kind: "labour",
    description: "Bathroom refit — strip-out, install, first & second fix",
    people: [
      { ref: "owner", days: 5 },
      { ref: "tm-liam", days: 5 },
    ],
    overtime: false,
    includes_tasks: ["Full strip-out", "Making good"],
  },
  // Task-split re-count of days already in the crew's 5-day pool — must fold
  // into includes_tasks, NOT add an owner-day. poolDays takes MAX(5, 1) = 5.
  {
    kind: "labour",
    description: "Tiling — 14m²",
    people: [{ ref: "owner", days: 1 }],
    overtime: false,
    includes_tasks: [],
  },
  {
    kind: "material",
    description: "Bathroom suite (bath, basin + pedestal, toilet)",
    quantity: 1,
    unit: "set",
    supplied_by: "customer",
  },
  {
    kind: "material",
    description: "Wall tiles — 14m²",
    quantity: 14,
    unit: "m2",
    supplied_by: "customer",
  },
  {
    kind: "material",
    description: "Tile adhesive, grout & sundries",
    quantity: 1,
    unit: "job",
    estimated_unit_cost_pence: 8000,
    supplied_by: "contractor",
  },
  {
    kind: "rate_card",
    rate_card_id: "rc-radiator",
    quantity: 1,
    description: "Heated towel rail swap",
  },
  {
    kind: "provisional",
    description: "Soil stack — condition unknown until opened",
    suggested_amount_pence: 25000,
    reason: "Condition unknown until opened up",
  },
];

// The priced outcome the compiler must produce from the draft + context above.
export const fenlandExpected = {
  labourLineTotal: 2300,
  // The adhesive and grout stay on the quote and carry NO figure — the same
  // move the soil stack made below, arriving from the other direction. £80 was
  // the model's guess at what a job's worth of sundries costs; this contractor
  // has never confirmed a price for it (`known_material_prices` above is
  // empty), so there was nothing grounding the number and a 25% markup on an
  // invention is not a margin. The subtotal is £100 lighter for that reason,
  // and deliberately so.
  contractorMaterialUnitPrice: 0,
  radiatorUnitPrice: 140,
  // The soil stack stays on the quote and carries NO figure. Its £250 was the
  // model's own suggestion, and a provisional sum no longer charges one —
  // "provisional" is a label, and what a customer reads is the number. The
  // subtotal below is £250 lighter for that reason, and deliberately so.
  provisionalUnitPrice: 0,
  subtotal: 2440,
  vat: 488,
  total: 2928,
} as const;

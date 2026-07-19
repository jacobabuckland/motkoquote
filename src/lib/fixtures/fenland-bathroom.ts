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
  contractorMaterialUnitPrice: 100, // £80 estimate × 1.25 markup
  radiatorUnitPrice: 140,
  provisionalUnitPrice: 250,
  subtotal: 2790,
  vat: 558,
  total: 3348,
} as const;

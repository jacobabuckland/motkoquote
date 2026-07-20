# Fixture — Fenland bathroom refit

Regression fixture for the pricing-contract refactor. Facts captured from a
real end-to-end voice intake test (a bathroom refit) that surfaced structurally
wrong labour maths, a dropped rate-card item, internal notes on customer
documents, and a voice session that could not conclude.

Used by the pipeline tests in `src/lib/compile-draft.test.ts` (and the wider
Task 7 regression suite). The structured form the tests consume lives in
`src/lib/fixtures/fenland-bathroom.ts`.

## Spoken facts

- Upstairs bathroom refit for **Margaret Doyle**, 17 Chapel Loke, Wymondham
  NR18 0QT, 07700 900112.
- Full strip-out; new bath with shower over, basin + pedestal, toilet.
  **Suite supplied by the customer.**
- Tiling corrected mid-call from 8m² to **14m²**. **Tiles supplied by the
  customer.**
- **One radiator swap** (heated towel rail). Contractor has a rate card
  "Radiator swap, per radiator, £140".
- Soil stack condition unknown until opened — a provisional sum.
- Making good included; decorating excluded.
- Crew = owner (£340/day) + **Liam (apprentice, £120/day)** × 5 days.
- Needed before 10 August.
- Contractor is VAT-registered; materials markup 25%.

## Expected priced outcome

- Labour: owner + apprentice × 5 days on **one line** = £2,300
  (owner 5 × £340 = £1,700, Liam 5 × £120 = £600). Liam labelled from
  `team_members` as "Liam (Apprentice)", never "Lead Plumber". No task-split
  line adds days — tiling appears as a task sub-bullet, not a second day.
- Radiator swap: **£140** line, priced from the rate card.
- Customer-supplied suite and tiles: **£0** lines with a supplied-by note.
- Contractor-supplied materials: 25% markup applied in code.
- Soil-stack: a provisional sum, clearly editable.
- VAT: 20% on the subtotal, then the gross total.

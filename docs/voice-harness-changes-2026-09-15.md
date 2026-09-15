# Voice harness — what changed, 15 Sep 2026

Paste this into the harness driver. It covers three changes merged to `main`
today, and says what each should now do to a quote.

## Which build you are testing

| Change | Commit |
|---|---|
| Extraction: decimals, sub-£100 prices, quantity guard | `5a8a295` (#761) |
| Labour: an unstated day count is labelled | `3fbd6ed` (#762) |
| Qualifiers, item names, `unpriced` after a stated price | `bca27d1` (#763) |

All three are on `main` and CI is green on each. **The production deploy was not
verified from the session that wrote this** — confirm it with the canary below
before trusting any expectation here.

### Canary — do this first

Start a quote and say, in one breath:

> "We supply 26 bags of finishing plaster at £10.80 each and 8 bags of backing
> plaster at £14.50 each."

- Quote shows **£10.80/bag** and **£14.50/bag** → the extraction fix is live.
- Quote shows **£80**, **£50**, or a price near **£148** → it is not live. Stop
  and say so; nothing below applies.

---

## 1. Written prices survive extraction (live)

Four separate faults each destroyed a written price. All are fixed.

**What you should now see**

- `£10.80` reads as £10.80, not as £10 and a stray £80.
- **Prices under £100 work at all.** `£26`, `£95`, `£65` were silently dropped
  before — a written amount with no "pounds" after it fell through a
  `value >= 100` test. `£140` worked and `£26` did not, purely on that.
- A sentence that opens with a quantity ("26 bags of…") is no longer abandoned
  at its first number, so every later price in it is read.

**What should have disappeared**

- Phantom prices made from the pence half of a decimal (£80 from £10.80).
- **A quantity read as money.** "We're skimming 148 square metres of walls" used
  to extract £148.00 and could attach to a materials line as "1 bag @ £148.00".
  A bare number followed by a unit of measure or packaging (square metres,
  linear metres, bags, sheets, tubs, rolls, coats…) is now ignored entirely.

**Deliberately unchanged:** a *rate* is still refused and recorded as refused —
"two fifty a day" does not become a locked price. That is correct, not a miss.

## 2. An unstated day count is labelled (live)

The labour line is priced from the contractor's stored day rates, so the money
was always theirs. The **number of days** is the drafting model's, and nothing
distinguished days the contractor gave from days the model invented.

**What you should now see:** where intake captured no duration — and no crew,
on a line with more than one person — the labour line carries an **"Est."** chip
in the editor, "Estimated" on the customer PDF, and an editor flag:

> "Check the days on the labour line: how long the job takes wasn't captured in
> the call, so these days are an assumption. Confirm them before sending."

**The amount is unchanged.** The line keeps its figure — a £0.00 would read as
"included at no charge", which is a worse claim than a number worth checking.

**Known limit, please do not report as new:** the check asks whether a duration
and a crew were captured at all. It does **not** verify the per-person split. On
a job where intake records a duration but the model mis-splits days across the
crew, the line will still read as the contractor's. Run 01 is exactly this case.

## 3. A stated price reaches the line it names (live)

Extraction was only the first link. Three more were dropping the price after it
had been read correctly. All three are fixed.

- **A one-off sum was billed per-unit.** In "…£10.80 each, …£14.50 each, …and
  one protection and consumables allowance of **£95**", the £95 was marked
  per-unit because "each" appeared elsewhere in the same sentence. On a 4-unit
  line that bills **£380 for a £95 allowance**. `each` is now read from the
  words that follow an amount, so it attaches to the amount it trails.
- **Materials arrived at £0.00 "Not priced".** The item name kept the
  preposition joining it to its price, so "finishing plaster at" did not match
  a line called "Finishing plaster"; the price then attached to nothing and the
  line was zeroed as unsourced. Names are trimmed at both ends now — though
  "tape and protection" keeps its middle "and".
- **"To be confirmed" printed over a price the contractor stated.** On a first
  quote, a material line refused for having no supplier price kept that refusal
  even after a stated price landed on it. The refusal is now cleared by the
  price that answers it.

---

## Re-running runs 01, 03 and 05

Every material price in all three scripts now extracts, and every one should
reach its line. Expected values below.

**Run 01** — 26 bags finishing plaster @ £10.80 = **£280.80**; 8 bags backing
plaster @ £14.50 = **£116.00**; 4 tubs primer @ £26 = **£104.00**; protection
and consumables allowance **£95.00** (once, not per-unit); waste removal
**£180.00**. No £148 anywhere. Materials are **not** marked up — a stated price
replaces the estimate the markup would have applied to.

Labour: the script says Owen 4 days, Daniel 5, Liam 3 = **12 person-days**. The
last run billed 13. Intake captures a duration here, so the "Est." label will
**not** fire — if the split is wrong again, report it as a capture/drafting
defect, not a labelling one.

**Run 03** — 18 bags plaster @ £11.20 = **£201.60**; 11 beads @ £4.50 =
**£49.50**; tape and protection **£65.00** (once); access tower hire
**£320.00** fixed.

**Run 05** — 25 bags plaster @ £11 = **£275.00**; 3 tubs primer @ £28 =
**£84.00**; protection materials **£160.00** (once); waste removal **£220.00**
(once); parking **£18.00**. Intake captured **no labour plan at all** on the
last run, so this is the case where the "Est." chip and the days flag **should**
appear.

---

## Known open — please do not spend time re-reporting

- **The pricing-mode question does not reliably land.** Two of the three runs
  above recorded `pricing: null` — the call never established fixed vs
  day-rate. This is a standing invariant and it is being missed.
- **The drafting prompt still tells the model to fill an unstated crew or
  duration "silently".** The compiler now labels the result, but the
  instruction that produces it is unchanged; changing it needs the pipeline
  fixtures re-recorded against the live model.
- **An address dropdown can reopen after you click away.** A late suggestion
  response re-opens a list the user already dismissed.
- Everything on the pass-7 known-open list.

## Where to push next, runs 06–10

The extraction path has had three fixes today and is the best-covered part of
this pipeline. These have had none:

1. **Say a price once and change it.** "The board is £180 — actually make that
   £210." Does the superseded price stay superseded everywhere?
2. **Say a price the draft has no line for.** It should surface as "Not on any
   line: you said £X" rather than vanish or attach to something unrelated.
3. **Mix a fixed price with itemised materials.** "The whole job is £2,000 all
   in, and I'm supplying 20 bags at £11." Which wins, and does anything
   double-count?
4. **Hedge and range handling.** "Somewhere between £400 and £500", "about
   £450", "call it £450" — the first two should be refused, the third locked.
5. **Per-unit versus one-off in the same breath** — the #763 case above, fixed
   today and worth a script built specifically to stress it: several per-unit
   materials and one flat allowance in a single sentence, in both orders.
6. **A crew nobody described.** State a duration but never say who is on the
   job, then check whether the quote invents a crew and whether it says so.

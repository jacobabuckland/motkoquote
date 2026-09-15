# Voice harness — what changed, 15 Sep 2026

Paste this into the harness driver. It covers four changes merged to `main`
today, says what each should now do to a quote, and corrects three findings
from the runs 06–10 report that turned out not to be defects.

## Before you start — two settings, please

1. **Turn VAT registration back ON** (number `GB123456789`). It was toggled off
   mid-run at some point between 09:17 and 09:21, which is what produced the
   "missing VAT" findings on runs 09 and 10. See the correction below. Check it
   is still on when you finish.
2. **Keep the browser console.** One line matters: if
   `[realtime] turn_detection eagerness rejected` appears, the turn-taking fix
   below did **not** take, and any speech lost mid-sentence is expected rather
   than new.

## Which build you are testing

| Change | Commit |
|---|---|
| Extraction: decimals, sub-£100 prices, quantity guard | `5a8a295` (#761) |
| Labour: an unstated day count is labelled | `3fbd6ed` (#762) |
| Qualifiers, item names, `unpriced` after a stated price | `bca27d1` (#763) |
| Bad field, clause boundary, turn-taking | `c9932c8` (#766) |

All four are on `main` and CI is green on each. **Production deploy is not
verified from the session that wrote this** — confirm with the canary before
trusting any expectation here.

### Canary — do this first

Start a quote and say, in one breath:

> "We supply 26 bags of finishing plaster at £10.80 each and 8 bags of backing
> plaster at £14.50 each, and one skip at £340, one material delivery at £65."

Four things to check, and they test four different fixes:

| You should see | If you see this instead |
|---|---|
| £10.80/bag and £14.50/bag | £80 or £50 → #761 not live. **Stop.** |
| £340 and £65 as separate amounts | £341 → #766 not live |
| No price near £148 anywhere | a £148 → #761 not live |
| Materials priced, not "£0.00 Not priced" | £0.00 → #763 not live |

If the first row fails, stop and say so — nothing below applies.

---

## 1. Written prices survive extraction (`5a8a295`)

- `£10.80` reads as £10.80, not as £10 and a stray £80.
- **Prices under £100 work at all.** `£26`, `£95`, `£65` were silently dropped —
  a written amount with no "pounds" after it fell through a `value >= 100` test.
- A sentence opening with a quantity ("26 bags of…") is no longer abandoned at
  its first number.
- **A quantity is no longer read as money.** "148 square metres of walls" used
  to extract £148.00 and attach to a materials line as "1 bag @ £148.00".

**Deliberately unchanged:** a *rate* is still refused and recorded as refused —
"two fifty a day" does not become a locked price. Correct, not a miss.

## 2. An unstated day count is labelled (`3fbd6ed`)

Where intake captured no duration — and no crew, on a line with more than one
person — the labour line carries an **"Est."** chip, "Estimated" on the customer
PDF, and an editor flag telling the contractor to confirm the days. The amount
is unchanged: a £0.00 would read as "included at no charge".

**Known limit, please do not report as new:** the check asks whether a duration
and a crew were captured at all. It does **not** verify the per-person split. A
job where intake records a duration but the model mis-splits days across the
crew will still read as the contractor's.

## 3. A stated price reaches the line it names (`bca27d1`)

- **A one-off sum is no longer billed per-unit.** "…£10.80 each, …£14.50 each,
  and one allowance of £95" marked the £95 per-unit off a neighbour's "each".
  On a 4-unit line that bills £380 for a £95 allowance.
- **Materials no longer arrive at £0.00** because the item name kept the
  preposition joining it to its price ("finishing plaster at" did not match a
  line called "Finishing plaster").
- **"To be confirmed" no longer prints over a price the contractor stated.**

## 4. Bad field, clause boundary, turn-taking (`c9932c8`)

- **One rejected field no longer discards a whole turn.** `pricing.fixed_amount`
  rejected the `0` the model sends for "no fixed price", 500'd `POST /jobs/new`
  and threw away the entire `update_sow` delta. That is what lost run 07's deep
  levelling and run 08's working constraints — one rejected parse, reported as
  three separate drafting defects. Any field the schema now dislikes costs that
  field, not the turn.
- **A digit amount no longer runs into the next clause.** "one skip at £340, one
  material delivery at £65" parsed as £341, inventing one price and destroying
  two. This is run 06's missing skip and delivery.
- **The contractor is allowed to finish a sentence.** `semantic_vad` treated a
  breath between clauses as the end of a turn; the assistant then spoke, and the
  half-duplex mic gate closes the mic while it does — so the next sentence was
  never captured. Runs 08 and 09 lost 12.1s and 27.1s that way.

  **This one is unverified.** The `eagerness: "low"` option could not be checked
  against the Realtime API from the session that shipped it, so it is sent with
  a fallback. Watch the console line named at the top of this document.

---

## Corrections to the runs 06–10 report

Please do not re-file these.

**VAT (findings 09-04, 10-04) is not a defect.** `contractors.vat_registered`
was `false` on production, toggled off mid-run between 09:17:27 and 09:20:59.
The three quotes written before it recorded VAT (£1,242.00, £885.20, £554.00);
the two after recorded £0.00. That is the quote recording what was true when it
was written, which is correct. Run 10's own captured snapshot says
`vatRegistered: false`, contradicting the card.

**Options and discounts are not data loss (10-01, 10-02).** There is no concept
of mutually-exclusive quote options or of a discount in the model at all. Those
are feature requests, not defects.

**Run 06 ran against the older build.** It started 09:00:24; `bca27d1` merged at
09:03:50. Its findings predate fix 3 above.

---

## Known open — please do not spend time re-reporting

- **A stated lump sum is still lost when the model itemises it.** "Base
  materials are £620, access equipment is £240" becomes invented component lines
  that match neither name, so both prices attach to nothing and the components
  are zeroed. Run 10 loses £620 and £240 this way. Recovering the price as its
  own line was tried and reverted — it double-charged, adding £3,200 on top of a
  labour line that already billed those days. The real fix is in the drafting
  prompt and needs the pipeline recordings re-made against the live model.
- **The pricing-mode question does not reliably land.** Several runs recorded
  `pricing: null` — the call never established fixed vs day-rate.
- **The drafting prompt still tells the model to fill an unstated crew or
  duration "silently".** The compiler labels the result now; the instruction
  that produces it is unchanged, and changing it needs the same re-recording.
- **An address dropdown can reopen after you click away.** A late suggestion
  response re-opens a list the user already dismissed.
- Everything on the pass-7 known-open list.

## Where to push next

Runs 06–10 covered the awkward-arithmetic ground well. These are still untested:

1. **Say a price once and change it.** "The board is £180 — actually make that
   £210." Does the superseded price stay superseded everywhere?
2. **Hedge and range handling.** "Somewhere between £400 and £500", "about
   £450", "call it £450" — the first two should be refused, the third locked.
3. **Per-unit versus one-off in the same breath**, in both orders: several
   per-unit materials then a flat allowance, and a flat allowance then per-unit
   materials. Fix 3 above is exactly this and deserves a script built for it.
4. **A long uninterrupted dictation.** Two minutes without pausing for the
   assistant, to exercise the turn-taking fix directly. Compare what the
   transcript captured against the script, word for word.
5. **A crew nobody described.** State a duration but never say who is on the
   job, then check whether the quote invents a crew and whether it says so.
6. **A deliberately malformed answer**, to exercise fix 4's field-level
   recovery: answer a pricing question with something nonsensical and check that
   the rest of the same turn still reaches the quote.

# Voice harness — what changed, 15 Sep 2026

Paste this into the harness driver (`harness/GPT_HARNESS.md`). After scoring,
the required last step is `npm run harness:run-and-write -- /path/to/scored.json`
(always calls `write-result.ts`). It covers eight changes merged to `main`
today, says what each should now do to a quote, and corrects the findings from
the runs 06–10, 11–15 and 16–20 reports that turned out not to be defects.

**Read the runs 16–20 corrections before scoring anything.** That round's
biggest reported theme — options appearing as "£0 lines" — was real but was
not what it looked like, and the customer never saw a £0.

## Before you start — two settings, please

1. **Turn VAT registration back ON** (number `GB123456789`). It was toggled off
   mid-run at some point between 09:17 and 09:21, which is what produced the
   "missing VAT" findings on runs 09 and 10. See the correction below. Check it
   is still on when you finish.
2. **Keep the browser console.** One line matters: if
   `[realtime] turn_detection eagerness rejected` appears, the turn-taking fix
   below did **not** take, and any speech lost mid-sentence is expected rather
   than new. Runs 16–20 recorded **no mic mute across five long openings and
   zero console errors**, which is the best evidence yet that it took — but it
   is still indirect, and this line is the only direct answer. Nobody has
   looked at it yet.

## Which build you are testing

| Change | Commit |
|---|---|
| Extraction: decimals, sub-£100 prices, quantity guard | `5a8a295` (#761) |
| Labour: an unstated day count is labelled | `3fbd6ed` (#762) |
| Qualifiers, item names, `unpriced` after a stated price | `bca27d1` (#763) |
| Bad field, clause boundary, turn-taking | `c9932c8` (#766) |
| One bad line, and a crew-day ceiling | `4b7e292` (#768) |
| A price belongs to one item, and stops where the amount stops | `ad54011` (#771) |
| The crew bills the days you gave them, per person | `07c3c1f` (#772) |
| Out-of-scope work is not a line; no promised discounts | `66c6627` (#773) |

All eight are on `main` and CI is green on each. **Production deploy is not
verified from the session that wrote this** — confirm with the canary before
trusting any expectation here.

### Canary — do this first

Start a quote. Give the customer's name and site address first, then say, in
one breath:

> "We supply 26 bags of finishing plaster at £10.80 each and 8 bags of backing
> plaster at £14.50 each, and one skip at £340, one material delivery at £65.
> Delivery is £60. Actually, no, £48."

Seven things to check, each testing a different fix:

| You should see | If you see this instead |
|---|---|
| £10.80/bag and £14.50/bag | £80 or £50 → #761 not live. **Stop.** |
| £340 and £65 as separate amounts | £341 → #766 not live |
| No price near £148 anywhere | a £148 → #761 not live |
| Materials priced, not "£0.00 Not priced" | £0.00 → #763 not live |
| Delivery at **£48** | £60 → #771 not live |
| Plaster still at £10.80 | plaster at £48, or £0 → #771 not live |
| No price anywhere matching the house number | a price equal to the street number → #771 not live |

If the first row fails, stop and say so — nothing below applies. Rows 5 and 6
are one test, not two: the correction has to land on delivery **and** leave the
plaster alone. Getting one without the other is the bug, not half a fix.

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

## 5. One bad line, and a crew-day ceiling (`4b7e292`)

Two things here change what you will SEE, so read this before filing against it.

- **A line the model gets wrong no longer kills the quote.** Run 14 produced no
  draft at all because the model returned a negative amount for the discount
  that script asks for, and the whole response was rejected. The unusable line
  is now dropped and reported:

  > Not on this quote: Motko proposed "5% discount on base labour" but could not
  > price it (it was a reduction, and a quote can't carry one yet). Add it by
  > hand if the job needs it.

  **That flag is the expected outcome for any script mentioning a discount.**
  It is not a new defect — it is the discount failing visibly instead of taking
  the quote with it.

- **A crew cannot bill more days than the plan allows.** Run 11 stated owner
  3.5, Daniel 5, Liam 2 and the quote billed ten days each — £6,200 against
  £2,275, with nothing flagged. Where intake captured both a duration and a head
  count, the labour line may now bill at most `duration × people`, and a draft
  exceeding that by more than 5% is scaled back proportionally, marked **Est.**
  with "Days reduced to the plan you gave", and flagged with both figures.

  **This caveat is now superseded — see section 7.** When this shipped, the
  ceiling was a BOUND rather than a correction, because `labour_plan` had
  nowhere to record the per-person split; the guidance written then said to
  expect roughly £3,100 from a re-run of run 11 rather than the £2,275 the
  script asks for. `07c3c1f` gave the split somewhere to go, so where the call
  captures it the days are now SET rather than capped, and run 11 should reach
  **£2,275**. Where it is not captured, the bound below still applies and
  £3,100 is still the expected answer. A quote coming in UNDER the plan is left
  completely alone either way.

---

## 6. A price belongs to one item (`ad54011`)

Three defects, and **two of them destroyed prices that had been captured
correctly**. That is why runs 19 and 20 read from outside as "prices attach
incorrectly" — the extractor was right and the grouping overwrote it.

- **A correction now lands on the price it corrects.** An amount with no item
  of its own ("Actually, no, £48") was adopted by whichever priced item had
  been recorded *first* within range, not the nearest one. Run 20 said finish
  at £11.20, then delivery at £60, then the correction — and the £48 landed on
  the finish, which reached the quote at **£0**, while delivery was charged at
  the £60 that had just been corrected.

- **One item no longer swallows another.** Item names were matched by bare
  substring, so a one-letter name matched almost anything — and "The
  equipment's £45" produced the item name `"s"`, which matches "waste". On run
  19 the £45 hire, £12 parking and £165 waste collapsed into one item and
  overwrote each other. That is the "several distinct prices become £12"
  finding, root-caused.

- **A decimal price no longer swallows the next item's quantity.** "£11.50, 2
  tubs of primer" produced a phantom **£1,152**; "£11.20, 7 bonding" produced
  **£1,127**. Both were on production. The pence of a real price were paying
  for the phantom's hundreds.

- **A house number is no longer a price.** The site address in run 20's opening
  produced a stated price equal to the street number, attributed to an item
  named out of the customer's own name.

## 7. The crew bills the days you gave them (`07c3c1f`)

**This is the one that supersedes section 5's caveat.** `labour_plan` recorded
how many people and how long, never the split across them — so "me four days,
Daniel five, Liam three" had nowhere to go, and the ceiling could only ever be
a bound.

It now has somewhere to go, and where the plan names the same people as the
line, **those days set the line** rather than merely capping it.

- Run 16 is the case no ceiling could have caught: 2 / 3 / 1 was stated, two
  days each was billed. Six person-days either way — but the owner and the
  labourer are on different rates, so it was £1,240 against £1,310.
- Runs 18 and 20 recorded `people_count` as null (18 stored the *sum* of the
  person-days as the duration; 20 stored the owner's own days). The #768
  ceiling needs both fields, so **it was inert in both runs that overbilled.**
  Its sum is now the ceiling, which needs neither field.

Re-running run 20 should now bound at 12 person-days rather than billing 13.
Re-running run 16 should produce £1,310 with a flag saying the days were set
from the crew you described — the total may not move, so **read the flag, not
just the number**.

## 8. Out-of-scope work, and no promised discounts (`66c6627`)

- **An option you kept out of the price is no longer a line.** Where the call
  recorded something as excluded or to-be-quoted-separately, a line describing
  it is dropped from the price table and named in a contractor flag. The scope
  narrative still carries it, so the customer sees it was discussed.

  This is the fix for what runs 16, 17 and 20 reported as "£0 lines" — see the
  correction below for why those were worse than £0, not better.

- **Motko no longer promises to subtract.** Run 18's assistant said it would
  take £80 off and the quote came out undiscounted with no mention of it. It
  now says plainly that it cannot apply a reduction, records it in the
  contractor's own words, and tells them it is a note for them to apply.

  **Expect to hear this in any script offering a discount.** It is the fix, not
  a refusal to engage.

---

## Corrections to the runs 16–20 report

**The "£0 lines" were never £0 to the customer — and the real problem was
worse.** Every one of those lines carries `unpriced: true`. The customer-facing
quote never renders £0.00 for such a line: it shows "To be confirmed", labels
the total "Priced so far", and **refuses the accept outright**. The £0 in the
report is the contractor-side layout.

So nobody could have accepted an option at £0. What actually happened is that
run 16's quote **could not be accepted at all**, because of three items the
contractor had explicitly kept out of the price (Option A, Option B, the
curtain track), and run 20's for the cornice. Fixed in `66c6627`.

**Customer identity loss is real, and it is disclosed.** Confirmed on
production: runs 16, 17, 18 and 20 lost the name; run 19 kept it — matching the
report exactly. But it is not silent. All five calls recorded
`wrap_incomplete: true`, the job page shows an incomplete-capture card naming
what is missing, and **the send is already blocked** until the name and a
contact channel are filled in. It cannot produce a quote sent to nobody.

Two specifics worth having: runs 16 and 20 ended on the question-budget cap,
which ended the call before the safety-net ask — even though customer details
are exempt from that budget. And the one run that kept the name had an explicit
customer/address confirmation exchange. **Whether to force the question is an
open product decision, not a bug to re-file.**

**Run 20's 13 worker-days against a stated 12 is now attributable.** The report
was right to withhold: `people_count` was null, so the #768 ceiling never ran
at all. Section 7 fixes the cause.

**Runs 19 and 20's "labour calculations still fail" and "three unrelated £12
lines" are root-caused**, to sections 6 and 7 respectively. Both were grouping
and capture defects, not arithmetic.

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

## Corrections to the runs 11–15 report

**Persistence is not a blocker (12-07, 13-04, 15-06).** Checked on production:
all five jobs exist with their statement of work, their quote, their line items
and their VAT recorded — `d8333333`, `85a1a5da`, `a15cec7e`, `006007ba` and
`cddad1e1`, totals £7,978.20, £4,377.90, £3,433.20, £555.00 and £1,037.40.
Nothing was lost. The drafts are not appearing in the dashboard listing, which
is a separate and much smaller bug. The report was right to hedge; this settles
it.

**Run 14's HTTP 500 was one rejected line, not a drafting failure.** Sentry has
it: a negative `suggested_amount_pence` on line 2, which is the discount. Fixed
in `4b7e292` — see section 5.

---

## Known open — please do not spend time re-reporting

- **A stated lump sum is still lost when the model itemises it.** "Base
  materials are £620, access equipment is £240" becomes invented component lines
  that match neither name, so both prices attach to nothing and the components
  are zeroed. Run 10 loses £620 and £240 this way. Recovering the price as its
  own line was tried and reverted — it double-charged, adding £3,200 on top of a
  labour line that already billed those days. The real fix is in the drafting
  prompt and needs the pipeline recordings re-made against the live model.
- **Discounts and quote options do not exist as features.** Not data loss — the
  model has no shape for either, which is why it keeps improvising them. A
  discount now fails visibly and is said out loud to be un-appliable (sections 5
  and 8); an option is kept off the price table and left in the scope narrative
  (section 8). Neither is yet a feature. The discount is `PRICE-D1` and is
  blocked on a decision about where a discount may come FROM.
- **The customer's name is often not captured from a natural opening.** Four of
  the five runs 16–20 lost it. It is flagged and the send is blocked, so it is
  visible rather than dangerous — but forcing the question contradicts a
  recorded "infer rather than interrogate" decision and is awaiting a call.
  Please report *whether* it was captured, and don't file it as new.
- **Customer-supplied materials can still become a blocking unpriced line.** Run
  20's client-supplied boards. Same shape as the options in section 8, different
  cause; `materials_supply` already records the answer, so it is a small
  follow-up.
- **The pricing-mode question does not reliably land.** Several runs recorded
  `pricing: null` — the call never established fixed vs day-rate.
- **The drafting prompt still tells the model to fill an unstated crew or
  duration "silently".** The compiler labels the result now; the instruction
  that produces it is unchanged, and changing it needs the same re-recording.
- **An address dropdown can reopen after you click away.** A late suggestion
  response re-opens a list the user already dismissed.
- Everything on the pass-7 known-open list.

## Where to push next

Runs 06–10 covered awkward arithmetic; 11–15 corrections and conditional
charges; 16–20 natural van-style delivery. Ranked by what would tell us most:

1. **Re-run 16 and 20 exactly.** These are the two the crew-days fix is aimed
   at, and both have a known right answer: run 16 should reach **£1,310** (not
   £1,240) with a flag saying the days came from the crew you described, and
   run 20 should bound at **12 person-days** (not 13). Run 16's total moves by
   £70 on a six-day job — small, and entirely the point, because the error was
   in *who* worked the days rather than how many.
2. **Re-run 19 exactly.** The £12 collapse, the phantom £1,152 and the £0
   finish were all one round's worth of grouping bugs. This is the single run
   that exercises all of section 6 at once.
3. **A quote that comes in UNDER its plan.** State five days for three people
   and use eight person-days. Nothing should change and nothing should flag.
   A guard that fires on an honest quote is worse than no guard, and nothing
   has tested this yet — it was top of the last list and did not get run.
4. **A long uninterrupted dictation.** Two minutes without pausing, compared
   word for word. Runs 16–20 suggest turn-taking is fine, but no run has been
   *designed* to break it.
5. **Shorter, natural conversations.** Every script so far is a deliberate
   stress test read from a page. Nothing yet tells us how the ordinary case
   behaves, and that is what a pilot would actually meet. This has been on the
   list twice and has still not been run.

Lower priority, and only if there is room: a price stated once and changed
("the board is £180 — actually make that £210"), hedges and ranges
("somewhere between £400 and £500" should be refused, "call it £450" locked),
and a deliberately malformed answer to exercise field- and line-level recovery.

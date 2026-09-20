# Voice tranche — pre-launch, 18 Sep 2026

Twenty quote runs. Paste everything below the line into the harness driver
(`harness/GPT_HARNESS.md`). After scoring, the required last step is
`npm run harness:run-and-write -- /path/to/scored.json` (always calls
`write-result.ts`) — do not drop a device-local file.

Written against `main` @ `bbd49c2`. **Last tranche before launch**: earlier rounds
asked "is it better than last time", this one asks **"what would stop you
launching"**. A regression losing £5 and a gap losing £600 are not the same
finding. And **the money parser changed three times this week with no live call**
— passes 14 and 15 both used a browser with no microphone, so this week's pricing
work rests on unit tests alone.

---

You are running a voice QA tranche on **motko.app** — twenty quotes spoken aloud,
as a UK trade would. Follow the script where given, improvise where it says to.

## Before you start

1. **VAT registration ON**, number `GB123456789`. Confirm it is still on when you
   finish.
2. **Keep the browser console open.** If `[realtime] turn_detection eagerness
   rejected` appears, turn-taking is not live and speech lost mid-sentence is
   expected, not new.
3. Open **`https://motko.app/api/build`** and **put the SHA it returns on the
   first line of your report, whatever it says.**

## Canary — do this first, and stop if it fails

Start a quote. Give the customer's name and address, then say in one breath:

> "We supply 26 bags of finishing plaster at 11.50 each and 8 bags of backing
> plaster at £14.50 each, one skip at £340, and a material delivery at £65.
> Delivery is £60. Actually, no, £48."

The **missing pound sign on 11.50** is deliberate — it is row one.

| You should see | If you see this instead |
|---|---|
| finishing plaster at **£11.50** a bag | **£1,150** a bag → #811 not live. **Stop and report.** |
| **26** bags, not 6 | 6 bags → #804 not live. **Stop.** |
| £340 and £65 as separate amounts | £341 → boundary fix not live |
| delivery at **£48** | £60 → correction fix not live |
| plaster still at £11.50 | plaster at £48 → grouping fix not live |
| materials priced, not "£0.00 Not priced" | £0.00 → stated-price fix not live |

Plaster line total: **26 × £11.50 = £299.00**.

## The twenty runs

### A. The money parser, six runs (1–6)

None of this has had a live call. Do these first.

**Run 1 — prices without a pound sign.** "at 11.50 each", "at 12.5 each", "£11.50
each", "at 27" — all pounds and pence. Then the other direction in the same call:
**"twenty-six bags"** and **"27 bags"** must stay counts.

**Run 2 — a list of small charges**, exactly this shape:

> "Add mixer hire, £45; parking, £12; and waste removal, £165."

All three named and priced, net £222, no "said and not on any line" flags. Repeat
with the semicolons replaced by "and"; report if they differ.

**Run 3 — a price joined by "at".** "One tub of primer at 27." "Six bags of
finish at 16." Both price. Then the cases that must NOT: "I'll start at 8",
"knock off at 4", "it's at 27 Green Lane", "at 30 square metres a day". Any of
those four becoming money is a false charge and is CRITICAL.

**Run 4 — compound counts.** "Twenty-six bags at £10.80 each", then thirty-four,
forty-two, sixty-five. Check the count on the line, not just the total.

**Run 5 — a correction inside one sentence.** "The boards are £180 and the trim
is £90 — make that ninety-five." The ninety-five lands on the **trim**; the
boards stay £180.

**Run 6 — a rate and a cap on one item.** "Forty-five pounds a shift, capped at
£120 for the job", over three shifts. Expected **£120** — not £135, not £45.

### B. The ordinary case, five runs (7–11)

**Top of the "push next" list three times and never run.** Every script so far is
a stress test read off a page; nothing tells us how a normal call behaves, which
is all a pilot will meet. Five short, natural conversations, no edge cases: a
bathroom, a re-skim, a fence, a consumer unit change, a splashback. Hesitate,
backtrack, let the assistant lead.

For each: **could you send the quote without editing it?** The headline number
here. If you opened the editor, say what for.

### C. Cost capture, three runs (12–14)

**Run 12 — an amount that qualifies itself.** "Sixty pounds including VAT."
"Thirty-six total." "Fifty plus VAT." Each previously parsed to nothing and two
runs ended with **no cost saved at all**. Record one each way, confirm a sensible
net/VAT split, then reopen and check it reads back the same.

**Run 13 — a cost dated twice.** "I paid him yesterday, the 17th." Must be
yesterday — a wrong date lands in the wrong VAT quarter.

**Run 14 — a cost paid in cash.** "Gave him £160 cash on the day." Known: may
save as unpaid — payment cannot be inferred from a transcript. Report it, don't
file it as new.

### D. The standing list, three runs (15–17)

**Run 15 — a quote that comes in UNDER its plan.** Five days for three people,
then use eight person-days. **Nothing should change and nothing should flag.**

**Run 16 — a long uninterrupted dictation.** Two minutes without pausing; compare
the transcript word for word against what you said.

**Run 17 — a price changed later in the call.** "The board is £180" … [three
sentences of other work] … "actually make that £210." The later figure wins and
the earlier appears nowhere.

### E. All the way through, three runs (18–20)

Each: quote by voice → send → accept as the customer → send a contract → sign →
deposit invoice → mark it paid → mark the work complete → final invoice.

- **Run 18** — straightforward, partial deposit.
- **Run 19** — withdraw the contract after sending, edit the price, send a
  replacement, sign that one.
- **Run 20** — decline the contract as the customer, then recover: edit the
  quote, accept again, send a replacement, sign it.

**Read the Activity panel at the end of each**: *if this were read in a dispute
six months from now, what would it say happened?*

## Known open — do not re-report

- A stated lump sum is lost when the model itemises it ("base materials are £620"
  becomes invented component lines).
- Discounts and quote options are not features. `PRICE-D1` blocked on a decision.
- The customer's name is often missed from a natural opening. Flagged and the
  send blocked — report *whether* it was captured.
- The pricing-mode question does not reliably land (`pricing: null`).
- Hours and shifts are not a pricing unit — days only. Decided 16 Sep.
- A bare "1.5" may raise an unattached-price advisory. A flag, never a charge.
- A price after a semicolon with no pound sign is missed: "mixer hire at 45;
  parking at 12" keeps only the £12. Found 18 Sep, unfixed.
- The drafting prompt still fills an unstated crew or duration silently; the
  compiler labels the result.

## What I want back

- **Build** — the SHA from `/api/build`, first line.
- **Canary** — passed or stopped, with the six rows.
- **Per run** — what you said, what it came out at, what it should have been.
- **Section B headline** — how many of the five were sendable unedited.
- **Findings** — graded by what a contractor or customer would suffer:
  - **CRITICAL** — a wrong number on a document a customer signs, or money
    silently lost or invented.
  - **SERIOUS** — a record that is missing, misleading, or unrecoverable.
  - **COSMETIC** — everything else.
- **Launch verdict** — *would you put this in front of a paying trade tomorrow?*
  Yes or no, and the one thing that most makes it a no.
- **Change log** — records created, settings toggled, messages sent. VAT
  confirmed back ON.
- **Harness JSON** — one object matching `harness/harness-result.schema.json`,
  written with `npm run harness:run-and-write -- /path/to/scored.json` so
  `NEXT_FIX` / `BACKLOG` / archive / `LESSONS` update in this repo. The wrapper
  always calls `write-result.ts`. A dump in chat is not a finished run.

Every run is on **production** with real send rails. Use your own address and
number. **Do not leave an invoice unpaid at the end** — the 08:00 UTC cron chases
by email and SMS with no dry-run guard.

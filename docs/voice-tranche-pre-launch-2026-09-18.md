# Voice tranche — pre-launch, 18 Sep 2026

Twenty quote runs. Paste everything below the line into the harness driver.

Written against `main` @ `53ca05f`. **This is the last tranche before launch**,
which changes what the report is for: previous rounds asked "is it better than
last time". This one asks **"what would stop you launching"**. A regression that
loses £5 and a known gap that loses £600 are not the same finding, and the
score should say so.

**The money parser changed three times this week and has had no live call.**
Pass 14 and pass 15 both reached the app through a browser with no microphone,
so sections of both went untested and the whole of this week's pricing work is
covered by unit tests alone. That is the single biggest reason this tranche
exists.

---

You are running a voice QA tranche on **motko.app** — twenty quotes, spoken
aloud, as a UK trade would. Work as a sceptical tester: follow the script where
one is given, improvise naturally where it says to, and report what the
contractor and their customer would actually suffer.

## Before you start — two settings

1. **VAT registration ON**, number `GB123456789`. It has been toggled off
   mid-tranche before and produced four false "missing VAT" findings. Check it
   is still on when you finish, and say so in the report.
2. **Keep the browser console open.** One line matters: if
   `[realtime] turn_detection eagerness rejected` appears, turn-taking is not
   live and any speech lost mid-sentence is expected rather than new.

## Which build you are testing

Open **`https://motko.app/api/build`**. It returns `{ "sha": "..." }`.

**Put that SHA on the first line of your report, whatever it says.** Don't judge
whether it's right — this prompt was written against `53ca05f`, and naming it is
what lets a finding be attributed to a build.

## Canary — do this first, and stop if it fails

Start a quote. Give the customer's name and site address first, then say, in one
breath:

> "We supply 26 bags of finishing plaster at 11.50 each and 8 bags of backing
> plaster at £14.50 each, one skip at £340, and a material delivery at £65.
> Delivery is £60. Actually, no, £48."

Note the **missing pound sign on 11.50** — that is deliberate and it is the
whole point of the first row.

| You should see | If you see this instead |
|---|---|
| finishing plaster at **£11.50** a bag | **£1,150** a bag → #811 not live. **Stop and report.** |
| **26** bags, not 6 | 6 bags → #804 not live. **Stop.** |
| £340 and £65 as separate amounts | £341 → boundary fix not live |
| delivery at **£48** | £60 → correction fix not live |
| plaster still at £11.50 | plaster at £48 → grouping fix not live |
| materials priced, not "£0.00 Not priced" | £0.00 → stated-price fix not live |

Expected line total for the plaster alone: **26 × £11.50 = £299.00**.

## The twenty runs

### A. The money parser, six runs (1–6)

Nothing here has been through a live call. These are the highest-value runs in
the tranche and should be done first.

**Run 1 — prices without a pound sign.** Say several: "at 11.50 each", "at 12.5
each", "£11.50 each", "at 27". Each should read as pounds and pence. Then check
the other direction in the same call: **"twenty-six bags"** and **"27 bags"**
must stay counts and never become money.

**Run 2 — a list of small charges.** Exactly this shape:

> "Add mixer hire, £45; parking, £12; and waste removal, £165."

All three should reach the quote **named and priced** — net £222 for those three
lines, no "said and not on any line" flags. Then repeat the same sentence with
semicolons replaced by "and". Report if the two differ.

**Run 3 — a price joined by "at".** "One tub of primer at 27." "Six bags of
finish at 16." Both should price. Then the cases that must NOT price: "I'll
start at 8", "knock off at 4", "it's at 27 Green Lane", "at 30 square metres a
day". Report any of those four that becomes money — that is a false charge and
it is CRITICAL.

**Run 4 — compound counts.** "Twenty-six bags at £10.80 each." Then thirty-four,
forty-two, sixty-five. Every one previously lost its tens digit — twenty-six
read as six. Check the count on the line, not just the total.

**Run 5 — a correction inside one sentence.** Price two items in one breath,
then correct the second: "the boards are £180 and the trim is £90 — make that
ninety-five." The ninety-five must land on the **trim**, and the boards must
stay £180.

**Run 6 — a rate and a cap on one item.** "Forty-five pounds a shift, capped at
£120 for the job", over three shifts. Expected **£120** — the lesser of rate ×
count and the cap. Not £135, not £45.

### B. The ordinary case, five runs (7–11)

**This has been top of the "push next" list three times and has never been run.**
Every script to date is a deliberate stress test read from a page, and nothing
tells us how a normal call behaves — which is the only thing a pilot will meet.

Five short, natural conversations. No stress phrasing, no deliberate edge cases.
A real job you'd quote in ninety seconds: a bathroom, a re-skim, a fence, a
consumer unit change, a kitchen splashback. Talk the way you'd talk to a
customer, hesitate, backtrack once or twice, and let the assistant lead.

For each, report: **could you send the quote without editing it?** That is the
headline number for this section. If you had to open the editor, say what for.

### C. Cost capture, three runs (12–14)

**Run 12 — an amount that qualifies itself.** "Sixty pounds including VAT."
"Thirty-six total." "Fifty plus VAT." Each previously parsed to nothing and the
assistant asked again, and again — two runs ended after four and five follow-ups
with **no cost saved at all**. Record one each way and confirm each saves with a
sensible net/VAT split. Then reopen each and confirm it reads back the same.

**Run 13 — a cost dated twice.** "I paid him yesterday, the 17th." The date must
be yesterday, not today — a wrong date lands in the wrong VAT quarter.

**Run 14 — a cost paid in cash.** "Gave him £160 cash on the day." Known: this
may save as unpaid, because the assistant is not permitted to infer payment from
the transcript. Report what happened; do not file it as new.

### D. The standing list, three runs (15–17)

**Run 15 — a quote that comes in UNDER its plan.** State five days for three
people, then use eight person-days. **Nothing should change and nothing should
flag.** A guard that fires on an honest quote is worse than no guard, and this
has been top of the push-next list twice without being run.

**Run 16 — a long uninterrupted dictation.** Two minutes without pausing.
Compare the transcript word for word against what you said. No run has been
*designed* to break turn-taking.

**Run 17 — a price stated once and changed later in the call.** "The board is
£180" … [three sentences of other work] … "actually make that £210." The later
figure wins, and the earlier one appears nowhere.

### E. All the way through, three runs (18–20)

Three complete journeys, voice intake to money in the bank. These are the only
runs that test the parts pass 15 could reach joined to the parts it could not.

For each: quote by voice → send it → accept as the customer → send a contract →
sign it → deposit invoice → mark it paid → mark the work complete → final
invoice.

- **Run 18** — straightforward, partial deposit.
- **Run 19** — withdraw the contract after sending, edit the price, send a
  replacement, then sign that one.
- **Run 20** — decline the contract as the customer, then recover: edit the
  quote, have the customer accept again, send a replacement, sign it.

Runs 19 and 20 are where four passes of findings lived and where this week's
contract work landed. **Read the Activity panel at the end of each** and ask:
*if this were read in a dispute six months from now, what would it say
happened?* That question found more than any individual check in pass 14.

## Known open — do not re-report

- **A stated lump sum is lost when the model itemises it.** "Base materials are
  £620, access equipment is £240" becomes invented component lines matching
  neither name. The fix is in the drafting prompt and needs the pipeline
  recordings re-made.
- **Discounts and quote options are not features.** The model has no shape for
  either. A discount now fails visibly and says so out loud; an option stays out
  of the price table. `PRICE-D1` is blocked on a decision.
- **The customer's name is often not captured from a natural opening.** It is
  flagged and the send is blocked, so it is visible rather than dangerous.
  Report *whether* it was captured; don't file it as new.
- **The pricing-mode question does not reliably land.** Several runs recorded
  `pricing: null`.
- **Hours and shifts are not a pricing unit.** Days are the only one; a
  contractor describing shifts is asked to convert. Decided 16 Sep.
- **A bare "1.5" may raise an unattached-price advisory.** A flag, never a
  charge. Parked 17 Sep.
- **A price stated mid-sentence after a semicolon, with no pound sign, is
  missed.** "mixer hire at 45; parking at 12" keeps only the £12. A miss, not a
  wrong figure. Found 18 Sep, not yet fixed — confirm the shape, don't grade it
  as new.
- **The drafting prompt still tells the model to fill an unstated crew or
  duration silently.** The compiler labels the result; the instruction is
  unchanged.

## What I want back

- **Build** — the SHA from `/api/build`, first line.
- **Canary** — passed or stopped, with the six rows.
- **Per run** — what you said, what the quote came out at, what it should have
  been, and whether you could have sent it unedited.
- **Section B headline** — how many of the five ordinary calls were sendable
  without opening the editor.
- **Findings** — graded by what a contractor or customer would suffer:
  - **CRITICAL** — a wrong number on a document a customer signs, or money
    silently lost or invented.
  - **SERIOUS** — a record that is missing, misleading, or unrecoverable.
  - **COSMETIC** — everything else.
- **Launch verdict** — *would you put this in front of a paying trade tomorrow?*
  Yes or no, and the one thing that most makes it a no.
- **Change log** — every record created, setting toggled, and message sent. VAT
  registration confirmed back ON.

Every run is on **production** with real send rails. Use your own address and
number. **Do not leave an invoice unpaid at the end** — the 08:00 UTC cron
chases by email and SMS with no dry-run guard.

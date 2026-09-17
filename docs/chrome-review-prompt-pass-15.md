# Claude Chrome — pass 15 prompt

Paste everything below the line into Claude Chrome. Written 17 Sep 2026 against
`main` @ `1046bc9`, with migration 85 applied to production and its table
confirmed present (57 backfilled rows).

Six PRs landed between pass 14's base (`2a0a735`) and this one. **All four of
pass 14's findings are fixed** — one CRITICAL and three SERIOUS — plus a
separate batch of money-parsing P1s from the 17 Sep voice tranche.

The standing gap is voice: pass 14 could not test three of its eight
confirmations because it had no microphone, and the money parser has changed
again since. That is called out explicitly below rather than left to be
rediscovered.

---

You are doing an independent review pass on **motko.app**, a quoting and
invoicing app for UK trades. Work as a sceptical tester: follow real journeys,
read what a contractor or a customer would actually read, and report what is
wrong rather than what is missing.

Pass 14 scored this 6/10 and would not ship it. All four of its findings are
claimed fixed. Your job is to find out whether that is true, and what the fixes
broke.

## Read this first — you are on PRODUCTION

This is the live app with real data, real money records, and real send rails.

- **Email and SMS actually send.** Sending a quote, a contract or an invoice
  reaches a real inbox or handset. Do not send to any address or number you did
  not create yourself.
- **A cron at 08:00 UTC chases unpaid invoices by email and SMS**, with no
  dry-run guard. **Do not leave an invoice unpaid at the end of your run** —
  mark it paid, or void it, or don't raise it. Before you finish, check the
  unpaid list and confirm nothing you created is still on it. Any unpaid
  invoice you did not create is not yours; leave it alone.
- Voice intake spends model credit per session. Use it where it is the thing
  under test, not as a way to create fixtures.
- Prefer creating your own customers with your own contact details over
  touching existing records.

**Keep a running log of everything you change**, and end your report with it —
every record created, every setting toggled, every send. If you toggle VAT
registration, put it back the way you found it.

**One piece of tooling advice, from pass 14's own retraction.** Setting a form
field programmatically (`form_input` and equivalents) writes the DOM value but
does not reach React's state, so the form submits *empty*, fails validation and
re-renders blank — which looks exactly like a silent-send bug and is not. Fill
fields with real keystrokes. Pass 14 nearly filed two false CRITICALs on this.

## Start here: which build are you testing?

Open **`https://motko.app/api/build`**. It returns one field: `{ "sha": "..." }`.

**Put that SHA on the first line of your report, whatever it says.** Do not try
to judge whether it is the right one. This prompt was written against
`1046bc9`; anything merged since moves it, and naming it is what lets a finding
be attributed to a build.

Stop only on `"unknown"`, a 404, or an error — those mean there is no deployment
to name.

Then one belt-and-braces check: create a quote with a deposit, send a contract,
and open the payment clause. If any rendered contract page or PDF contains a
literal `{{` or `}}`, a template has regressed — stop and report it.

## Voice: read this before you plan your run

Three of pass 14's eight confirmations went untested because the browser had no
microphone, and `/jobs/new` → "Start talking" sits on "Connecting…" for ever
without one.

**Decide this first and say so in your report.** If you cannot produce speech,
do not spend any of the run on voice intake — there is no typed path into the
drafter, so it is not a matter of finding the right route. Say plainly that
voice was out of reach, and spend the time on sections 1–5 instead, which are
where pass 14's findings were.

If you *can* produce speech, section 6 is the highest-value part of this pass,
because the money parser changed twice this week and nobody has exercised it
through a real call.

## What changed since pass 14 — confirm, don't re-discover

### 1. CRITICAL — a declined contract no longer holds the job

Pass 14's worst finding, and it had teeth because the recovery path *looked*
like it worked. Declining left the job on "Nothing needs you here" with no
contract form. The quote was editable, so the contractor edited the price, the
job said "Waiting on X to accept", the customer accepted a **second** time — and
the job landed back on "Nothing needs you here". £1,320 of accepted work with no
way to contract or invoice it, and invisible in every dashboard section.

Do the whole journey:

- send a contract, decline it as the customer;
- confirm the contractor's job page **offers a contract form immediately** —
  the quote is still accepted, so a replacement should not require anything
  first;
- confirm the job appears under **"Accepted quotes awaiting contract"** on the
  dashboard and is counted in "your move";
- send the replacement, and **sign it**, and confirm the job reaches an invoice.
  A replacement that cannot be signed is the same bug wearing a hat.

The job should still say, in red, that the contract was declined. Report it if
that has gone — the fix was supposed to keep the bad news and add the form.

### 2. SERIOUS — every contract stays in the log

Sending a replacement used to erase the original send and the withdrawal from
the Activity panel. By the end of a job with three contracts and two
withdrawals, the log showed one "Contract sent" and no withdrawals at all —
asserting that a single contract was sent after the re-issue and signed.

Take one quote round the loop three times — send, withdraw, replace, withdraw,
replace, sign — and then read the whole Activity panel. Every send, every
withdrawal and the signature should each be their own dated row, newest first,
with each withdrawal reading above the send it ended.

### 3. SERIOUS — every acceptance is recorded, with its own figure

The customer accepted three times (£1,440, £1,800, £1,800) and the log recorded
only the first, on a job whose signed and invoiced contract was the £1,800 one.

Accept a quote, edit it as the contractor to a different price, have the
customer accept again, and read the Activity panel. **Both acceptances should
appear, each naming its own figure.** Accept a third time at the same price as
the second and confirm that is a third entry too — two acceptances at one figure
are two events.

An acceptance with no recorded figure should read plainly as "Quote accepted"
rather than borrowing the current total. If you can find a job accepted before
today, check it reads that way.

### 4. SERIOUS — a contract's summary agrees with its own clauses

The summary box at the top of a `/c/` page was computed live from the quote
while the clauses below it are frozen, so a withdrawn contract emailed at £1,440
showed **£1,800** in bold above a price clause saying £1,440.

Send a contract, withdraw it, change the quote's price *and* its deposit, then
open the **old** contract link. The header, clause 2 and clause 3 must all agree
on the figures it was issued with. Same for a declined contract.

Two more things on that page:

- the withdrawn/declined notice should now be at the **top**, above the figures,
  not after Schedule A at the very bottom;
- a **declined** contract should carry such a notice at all — it had none.

### 5. MINOR — withdraw asks first, and reads correctly

The confirmation dialog's headline was rendering as "QAwon't be able to sign
it". Check the customer's name and the following word are separated. Confirm the
dialog still asks, that backing out withdraws nothing, and that confirming works.

### 6. Voice — the money parser, changed twice this week

**Only if you can produce speech.** Nothing here has been exercised through a
real call; all of it is covered by unit tests alone.

- **A price said without a pound sign.** *"Six bags of finish at 11.50 each"*
  billed **£6,900** — the parser read £1,150 a bag. Say prices both with and
  without the sign, and with a decimal: "11.50", "12.5", "£11.50". Also confirm
  a bare count is still a count: *"twenty-six bags"* must not become money.
- **A price in a list keeps its name.** *"Add, mixer hire, £45; parking, £12;
  and waste removal, £165"* — all three amounts were extracted, all three lost
  their item, and three lines came out at £0.00. That should now net £472 with
  no unattached-price flags.
- **A corrected price lands on the right line.** Say two priced items in one
  breath, then correct the second — *"make that ninety"*. The ninety must land
  on the second item.
- **Compound counts keep their tens.** *"Twenty-six bags at £10.80 each"* was
  read as **six**. Test twenty-six, thirty-four, forty-two, sixty-five.
- **A cost can say "including VAT".** *"£60 including VAT"*, *"£36 total"* and
  *"£50 plus VAT"* all parsed to nothing, so the assistant asked again, and
  again — two runs ended after four and five follow-ups with **no cost saved at
  all**. Record a cost each way and confirm one is saved, with a sensible net
  and VAT split.
- **"Yesterday, the 16th" is yesterday.** A cost dated twice used to file as
  today. A wrong date can land in the wrong VAT quarter.
- **Nothing invented carries a price.** Say explicitly that there are no other
  charges, and confirm the quote gains no "waste removal", "scrim tape and
  consumables" or "protective sheeting". If a provisional line does appear it
  must carry **no figure**, only its reason.

## Known and deliberate — do not report these

- **Two contract templates have unresolved payment copy.** At a **no-deposit**
  price, `maintenance_recurring` states no payment timing at all, and three
  other templates say "the remainder" with nothing before it to be the remainder
  *of*. This is with the owner as a copy decision. Do not re-report it; **do**
  report any *other* template stating a figure it does not then bill.
- **A cost described as paid in cash may save as unpaid.** The assistant is not
  permitted to infer payment from the transcript; absent means "they did not
  say". Guessing wrong tells a contractor a bill is settled.
- **"£45 a shift" with no count prices as one unit.** Where a per-shift quantity
  should come from is an open money decision, not a parser bug.
- **A bare "1.5" may raise an unattached-price advisory.** It is a flag, never a
  charge.
- **Invoice numbers are unique and stable but NOT sequential.** Separate tracked
  item.
- **A quote's re-issue history keeps only the most recent re-issue.** Deliberate.
  Note this is *not* true of acceptances any more — see section 3.
- **Days are the only pricing unit.** A contractor describing hours or shifts is
  asked to convert. Known and decided.
- **Motko does not email the customer when a contract is withdrawn.** The
  confirmation says so, and tells the contractor to say something themselves.
- **The knowledge layer does not yet surface suggestions in the editor.** That
  work is queued and unmerged.
- Anything you can only observe outside the app — the App Store listing, the
  marketing site — is not in scope.

## What to probe hardest

- **The contract lifecycle after the first send**, again. Four of pass 14's
  findings lived there and all four fixes are new. Withdraw, decline, re-issue,
  replace, re-accept, sign. Take it round more times than feels reasonable, and
  mix withdrawals with declines on one quote rather than testing them separately.
- **The Activity panel as a document.** Two of pass 14's findings were logs that
  had not merely forgotten an event but asserted a false one. After any sequence
  of actions, read the whole panel top to bottom and ask: *if this were read in
  a dispute six months from now, what would it say happened?* That question
  found more than any individual check.
- **Any place two surfaces show the same money.** The quote, the customer's
  `/q/` link, the PDF, the contract, the invoice, the job page. If two disagree
  about one figure, that is the most serious class of bug this product has.
- **Every completing action should navigate somewhere deliberate** and never
  leave you on a spent form or a button stuck mid-spin.
- **VAT.** Switch registration on and off and confirm no already-written
  document silently restates its own VAT.
- **Stray drafts.** Pass 14 watched the draft count move 21 → 24 during its run
  without deliberately creating any. If that happens again, say what you were
  doing when it did.

## What I want back

- **Build** — the SHA from `/api/build`, first line.
- **Voice** — whether you could produce speech, stated early.
- **Scope** — what you actually exercised, and what you did not.
- **Confirmations** — which of the six above hold, briefly.
- **Findings** — graded CRITICAL / SERIOUS / COSMETIC, each with the exact
  journey that produced it, what you saw, and what you expected. Quote the real
  figures and the record ids.
- **Retractions** — anything you reported before that you now think was wrong.
- **Verdict** — would you ship it, and a score out of 10.
- **Remaining gates** — what still has to be true before launch.
- **Change log** — every record you created, setting you toggled, and message
  you sent.

Grade on what a contractor or their customer would actually suffer. A wrong
number on a document a customer signs is CRITICAL. A missing nicety is not.

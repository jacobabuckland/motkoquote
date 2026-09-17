# Claude Chrome — pass 14 prompt

Paste everything below the line into Claude Chrome. Written 17 Sep 2026 against
`main` @ `022d67e`, with migrations 83 and 84 applied to production and their
index and columns confirmed present.

Ten commits landed between pass 13's base (`a427094`) and this one. Every
CRITICAL and SERIOUS finding from pass 13 is fixed. Two MINOR ones are not, and
are listed as known below rather than left for the tester to re-find.

---

You are doing an independent review pass on **motko.app**, a quoting and
invoicing app for UK trades. Work as a sceptical tester: follow real journeys,
read what a contractor or a customer would actually read, and report what is
wrong rather than what is missing.

Pass 13 scored this 7/10 and would not ship it. It raised one CRITICAL and four
SERIOUS findings. All five are claimed fixed and deployed. Your job is to find
out whether that is true, and what the fixes broke.

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
every record created, every setting toggled, every send. This has been the most
useful section in the last several passes. If you toggle VAT registration, put
it back the way you found it.

## Start here: which build are you testing?

Do this first. Everything below assumes code that may not be running, and three
of the last four passes wasted findings on a stale deploy.

Open **`https://motko.app/api/build`**. It returns one field:

```json
{ "sha": "022d67e14214929759db420c0254e5935c5ba931" }
```

- **That exact SHA** — you are on the build this prompt describes. Carry on.
- **A different SHA** — say so at the top of your report and name it. Findings
  are still useful; I just need to know what they are against.
- **`"unknown"`, a 404, or an error** — stop and say so.

Then one belt-and-braces check, because a live build can still ship a broken
template: create a quote with a deposit, send a contract, and open the payment
clause. If any rendered contract page or PDF contains a literal `{{` or `}}`, a
template has regressed — stop and report it.

## What changed since pass 13 — confirm, don't re-discover

Each of these was your finding last pass. Verify the fix holds. Report only if
it does not, or if it broke something adjacent.

### 1. CRITICAL — withdraw a contract, then send a replacement

The worst one. Withdrawing a sent contract and sending a new one used to fail
**silently**: the button reported "Sent ✓" having created nothing, because a
database constraint allowed only one contract per quote and the withdrawn one
still held the slot. The contractor then waited for a signature on a contract
that did not exist.

The constraint was replaced (migration 83) so it only counts contracts that are
still alive. Do the whole journey:

- send a contract, withdraw it, edit the quote, send a **new** contract;
- confirm the customer's link opens the **new** contract, with the new figures;
- confirm the old link says the contract was withdrawn and offers no signing;
- then **sign the new one as the customer** and confirm the contractor's job
  page moves on. A replacement that cannot be signed is the same bug wearing a
  different hat.

Do it twice in a row on one quote — withdraw, replace, withdraw, replace — and
confirm the third contract is as real as the first.

### 2. SERIOUS — the quote unfreezes after a withdrawal

Withdrawing left the quote frozen: "this quote can't be edited because a
contract exists". The guard was reading a status field the page never fetched,
so it assumed the worst and blocked. Withdraw a sent contract and confirm the
quote is immediately editable, with no refresh needed, and that the editor does
not warn about a contract that is gone.

Then the money half, which is the part worth pushing on: after a withdrawal and
a replacement at a **different deposit**, raise the deposit invoice and confirm
it uses the **live** contract's deposit — not the withdrawn one's.

### 3. SERIOUS — a re-issued contract keeps what you typed

Re-issuing threw away everything the contractor had written: scope of works,
exclusions, materials notes, access arrangements, additional terms. Only the
addresses and the warranty period survived, because those are re-derived from
the job.

Fill **every** free-text field on a contract with distinctive text, send it,
withdraw it, and start a replacement. Every one of those fields should come
back carrying your words. Two specific cases:

- **the dates should NOT carry across** — start date, completion date and
  duration are deliberately blank on a replacement;
- an **empty** field on the old contract must not blank out a field the job
  can derive. Leave "access arrangements" empty, re-issue, and confirm the
  replacement is no worse than a first issue.

### 4. SERIOUS — the Activity log says what was accepted

This was the subtlest one you found. After editing an accepted quote, the log
read "Quote accepted 18:02" on a job whose quote now said £840 — when £600 is
what the customer actually agreed to. Read months later in a dispute, that log
asserts they agreed to £840.

Accept a quote as the customer at one price, then edit it as the contractor to
a different price, and read the Activity panel:

- the acceptance entry should name **the figure that was accepted**, not the
  one the quote shows now;
- there should be a dated **"Quote re-issued"** entry, reading *after* the
  acceptance it withdrew;
- a quote accepted before today has no figure recorded, and should read plainly
  as "Quote accepted" rather than guessing one. If you find an old job, check
  it — inventing a figure there would be worse than omitting it.

You also asked for proof the customer is actually told. They are emailed a
"quote re-issued" notice carrying the figure they were originally sent. **Check
the inbox**, and check the number in it is the old one, not the new one.

### 5. MINOR — withdraw now asks first

"Withdraw contract" was a single tap sitting between two harmless buttons. It
now opens a confirmation naming the customer. Confirm it asks, that backing out
withdraws nothing, and that confirming still works.

### 6. Voice: a correction lands on the line it was said about

Two pricing defects, both about a stated price reaching the wrong line:

- **a correction inside one sentence** used to attach to the *first* item
  priced rather than the last. Say two priced items in one breath and then
  correct the second — "make that ninety" — and confirm the ninety lands on the
  second item and not the first.
- **compound counts lost their tens.** "Twenty-six bags at £10.80 each" was
  read as **six** bags — £64.80 against £280.80 — with the count in front of
  the contractor the whole time. Test several: twenty-six, thirty-four,
  forty-two, sixty-five. Every compound from twenty-one to ninety-nine was
  affected.

### 7. Voice: a cap and a rate are both real

"£45 a shift, capped at £120 for the job" over three shifts should charge
**£120** — the lesser of rate × count and the cap. Not £135, and not £45.

### 8. Voice: nothing the model invented carries a price

Provisional sums and any line the contractor did not mention are now unpriced
or absent. A quote should not gain "waste removal", "scrim tape and
consumables" or "protective sheeting" from nowhere — and if a provisional line
does appear, it must carry **no figure**, only its reason. Say explicitly on a
call that there are no other charges, and confirm nothing is added.

## Known and deliberate — do not report these

- **Two contract templates have unresolved payment copy.** At a **no-deposit**
  price, `maintenance_recurring` states no payment timing at all, and three
  other templates say "the remainder" with nothing before it to be the
  remainder *of*. This is with the owner as a copy decision and is the one
  remaining pass-13 item. Do not re-report it; **do** report any *other*
  template stating a figure it does not then bill.
- **Invoice numbers are unique and stable but NOT sequential.** HMRC asks for
  sequential. That needs a per-contractor counter, a migration, and a decision
  about numbers already issued. Separate tracked item.
- **A quote's re-issue history keeps only the most recent re-issue.** Re-issue
  three times and the log dates the last one. Deliberate — a full event history
  is a different piece of work.
- **The assistant will not price work described in hours or shifts.** Days are
  the only pricing unit; a contractor describing shifts is asked to convert.
  Known, decided, and the gap is measured.
- **Motko does not email the customer when a contract is withdrawn.** The
  confirmation says so, and tells the contractor to say something themselves.
- Anything you can only observe outside the app — the App Store listing, the
  marketing site — is not in scope.

## What to probe hardest

Pass 13's findings clustered in two places, so push there:

- **The contract lifecycle after the first send.** Withdraw, decline, re-issue,
  replace, sign. Every pass-13 CRITICAL and SERIOUS lived in the window *after*
  a contract had already gone out, and that window has just been substantially
  rewritten — four of the ten commits touch it. Take it round the loop more
  times than feels reasonable.
- **Anything that happened but left no record, or left a misleading one.** Do
  an action, then ask whether the Activity panel and the job page can still
  tell you it happened, and whether what they say is *true*. A log that has
  forgotten an event is bad; a log that asserts a false one is worse, and
  pass 13 found both.
- **Any place two surfaces show the same money.** The quote, the customer's
  `/q/` link, the PDF, the contract, the invoice, the job page. If two of them
  disagree about one figure, that is the most serious class of bug this product
  has.
- **Every completing action should navigate somewhere deliberate** and never
  leave you on a spent form or a button stuck mid-spin.
- **VAT.** Switch registration on and off and confirm no already-written
  document silently restates its own VAT.

## What I want back

- **Build** — the SHA from `/api/build`, first line.
- **Scope** — what you actually exercised, and what you did not.
- **Confirmations** — which of the eight above hold, briefly.
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

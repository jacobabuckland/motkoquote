# Claude Chrome — pass 13 prompt

Paste everything below the line into Claude Chrome. Written 16 Sep 2026 against
`main` @ `a427094`, with migration 82 applied to production and both new columns
confirmed present.

---

You are doing an independent review pass on **motko.app**, a quoting and
invoicing app for UK trades. Work as a sceptical tester: follow real journeys,
read what a contractor or a customer would actually read, and report what is
wrong rather than what is missing.

Pass 12 scored this 7/10 and said "not yet". Every finding it raised has since
been fixed and deployed. Your job is to find out whether that is true.

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

## Start here: is the deploy live?

Do this before anything else — everything below assumes code that may not be
running.

Create a quote with a deposit, send a contract, and open the payment clause.

- If any rendered contract page or PDF contains a literal `{{` or `}}`, **the
  deploy is not live, or a template regressed. Stop and say so.**
- If the payment clause states the deposit amount and the balance consistently
  with what the contract then bills, the deploy is live. Carry on.

## What changed since pass 12 — confirm, don't re-discover

Each of these was reported in pass 12 and is claimed fixed. Verify the fix
holds; report only if it does not, or if the fix broke something adjacent.

1. **Four of the five contract templates hid the deposit they then billed.**
   The payment schedule stated terms that omitted the deposit the contract went
   on to invoice — so a customer signed a document promising one thing and got
   billed another. This is the most important one to check, because it is the
   document a customer signs.

   Check **every template** against **three deposit shapes**: no deposit at all,
   a partial deposit, and a deposit equal to the whole price. In all fifteen
   combinations the payment clause must agree with what is actually billed, and
   must not promise a balance that will never be raised or omit one that will.

2. **A deposit covering the whole job now closes the job.** Marking a 100%
   deposit paid used to offer to raise a balance invoice — for £0.00. Raise a
   quote whose deposit equals the total, mark it paid, and confirm the job
   finishes rather than offering a zero invoice.

3. **Editing an accepted quote now warns before it withdraws the acceptance.**
   Previously: no warning at all, and on save just "Saved" — while the job
   silently reverted to awaiting acceptance, the customer's link showed a new
   price with fresh Accept/Decline buttons, and their "You accepted this quote."
   confirmation vanished. Accept a quote as the customer, then edit it as the
   contractor, and check you are told what you are about to undo **before** it
   happens. Check it warns even when the total does not move.

4. **A re-issue no longer erases the acceptance from the audit trail.** The
   Activity panel is built from current row state, so clearing `accepted_at` on
   re-issue used to make the acceptance stop *ever having happened*. After the
   edit above, confirm "Quote accepted" is **still in the Activity panel**, and
   that it carries the time of the FIRST acceptance, not the latest.

   Same shape for contract withdrawal: withdraw a sent, unsigned contract and
   confirm the Activity panel says it was withdrawn and when.

5. **A declined contract no longer ends the job.** Declining used to leave the
   job permanently stuck — the quote could not be edited and no new contract
   could be issued. Decline a contract as the customer, then confirm the
   contractor can edit the quote and issue a new contract. The Activity panel
   should also say when it was declined.

6. **The count in front is the count charged.** A spoken quantity must reach the
   quote as that quantity.

7. **"Eleven pounds per bag" is a price per bag, not a price for one bag.**
   Say a per-unit price in voice intake — "eleven pounds a bag", "£11.50/bag",
   "£140 each" — and confirm the quote multiplies it by the count rather than
   charging for one. Also confirm the opposite still holds: "£140 for a radiator
   swap" is a line total, not a per-unit rate.

8. **A staged contract promises only the invoices Motko can actually raise.**
   The large/staged template used to promise milestone billing the product
   cannot do.

## Known and deliberate — do not report these

- **Invoice numbers are unique and stable but NOT sequential.** HMRC asks for
  sequential. That needs a per-contractor counter, a migration, and a decision
  about numbers already issued. It is a separate tracked item, not an oversight.
- **Learned pricing tendencies can still nudge a draft.** Today, a contractor
  with a couple of past quote edits may see the drafter apply a learned pattern
  — a material priced higher, or a line added — with nothing on the quote saying
  a tendency moved it. This is known, is the current top item in the queue, and
  is being changed so tendencies become suggestions the contractor must accept.
  Report it only if you find it doing something *worse* than that description.
- Anything you can only observe outside the app — the App Store listing, the
  marketing site — is not in scope.

## What to probe hardest

Pass 12's worst findings were all documents that stated one number and billed
another, and events that left no trace. So push on:

- **Any place two surfaces show the same money.** The quote, the customer's
  `/q/` link, the PDF, the contract, the invoice, the job page. If two of them
  disagree about one figure, that is the most serious class of bug this product
  has.
- **Anything that happened but left no record.** Do an action, then ask whether
  the Activity panel and the job page can still tell you it happened. Withdraw,
  decline, re-issue, edit after acceptance.
- **Every completing action should navigate somewhere deliberate** and never
  leave you on a spent form or a button stuck mid-spin. Send a quote, send a
  contract, raise an invoice, mark one paid — and watch where you land and what
  the button says at the end.
- **VAT.** Switch registration on and off and confirm no already-written
  document silently restates its own VAT.

## What I want back

Same structure as pass 12:

- **Deploy gate** — live or not, settled first.
- **Scope** — what you actually exercised, and what you did not.
- **Confirmations** — which of the eight fixes above hold, briefly.
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

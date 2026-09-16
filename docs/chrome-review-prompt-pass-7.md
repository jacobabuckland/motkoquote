# Claude Chrome — pass 7 prompt

Paste everything below the line into Claude Chrome. Written 14 Sep 2026 against
`main` @ `0d338a7`, with the legacy VAT backfill applied and Harriet's penny
corrected.

---

You are doing an independent review pass on **motko.app**, a quoting and
invoicing app for UK trades. Work as a sceptical tester: follow real journeys,
read what a contractor or a customer would actually read, and report what is
wrong rather than what is missing.

## Read this first — you are on PRODUCTION

This is the live app with real data, real money records, and real send rails.

- **Email and SMS actually send.** Sending a quote, a contract or an invoice
  reaches a real inbox or handset. Do not send to any address or number you did
  not create yourself.
- **A cron at 08:00 UTC chases unpaid invoices by email and SMS**, with no
  dry-run guard. Anything you leave unpaid overnight gets chased for real in the
  morning. **So: do not leave an invoice unpaid at the end of your run** — mark
  it paid, or void it, or don't raise it.
- Two invoices are already unpaid and are NOT yours: `eefc6da3` (£99.25) and
  `f3e5cc9b` (£547.20), both from July. Leave them alone.
- Voice intake spends OpenAI credit per session. Use it where it's the thing
  under test, not as a way to create fixtures.
- Prefer creating your own customers with your own contact details over
  touching existing records.

**Keep a running log of everything you change**, and end your report with it —
every record created, every setting toggled, every send. The previous pass did
this and it was the most useful section in the report. If you toggle VAT
registration, put it back (it should end ON, with number `GB123456789`).

## Start here: is the deploy live?

Two fixes merged today but **no contract has been generated since**, so nobody
has confirmed the deployed build. Settle it before anything else.

Create a quote for a VAT-registered trade, send a contract, and open clause 2
("Price"). Then:

- If the VAT row reads `VAT{{#vat_registered}} (VAT no. …){{/vat_registered}}`
  — literal double braces on the page — **the deploy is not live. Stop and say
  so.** Everything below assumes code that isn't running, and the rest of the
  pass is wasted.
- If it reads `VAT (VAT no. GB123456789)`, the deploy is live. Carry on.

## What changed today — confirm, don't re-discover

Each of these was reported in pass 6 and fixed. Verify the fix holds; report
only if it doesn't, or if the fix broke something adjacent.

1. **Clause 2 asserts only what it knows.** The Labour/Materials split renders
   only where a line was actually categorised as materials. Where nobody made
   the distinction, clause 2 should show Subtotal and Total and say nothing
   about composition — no `Labour £740.00 / Materials £0.00` on a quote where
   every line was left on the default Kind. The VAT row appears only where VAT
   was charged: no `VAT £0.00` on an unregistered trade's contract. Check both
   contract templates (standard project, and the large/staged one).

2. **No template source on any rendered contract.** Nothing on a contract page
   or PDF should contain `{{` — check a registered trade with VAT, an
   unregistered trade, a materials-heavy job and an all-labour one.

3. **Legacy quotes now reconcile.** Quotes written before the VAT columns
   existed used to show line items that didn't sum to the total with nothing
   explaining the gap. Quote `b3112196` is the reported case: it should now read
   **Subtotal £450.00 · VAT £90.00 · Total £540.00**, on `/q/`, the job page and
   the PDF, with the line items summing to the subtotal. Spot-check two or three
   other older quotes the same way — items should sum to subtotal, and
   subtotal + VAT should equal total, everywhere the quote appears.

4. **VAT on a split quote sums to the quote's VAT.** On any job with a deposit
   and a balance, the two receipts' VAT figures must add up to the quote's VAT
   exactly. Job with quote `3e6de1ad` is the reported case: £150.85 + £452.53 =
   £603.38, matching the contract, with the P&L reading **Invoiced (net)
   £3,016.90** — not £3,016.89.

5. **The tracker doesn't claim things that didn't happen.** A part-paid job
   should not show a "Paid" row carrying a date under an unticked "Invoiced".

## Known-open — do not spend the night on these

Already found, already understood, fix not yet written. Confirming they're still
there is fine; a paragraph each is not needed.

- **"Owed (net)" still recomputes VAT from the registration flag** instead of
  reading what the invoice recorded. Toggle registration and the figure moves on
  an invoice that carries no VAT.
- **A job paid in full by a 100% deposit can never be closed.** It stays under
  "Accepted quotes awaiting invoice" with "Mark the work complete, then invoice",
  and both invoice routes correctly refuse because there's nothing left to
  invoice. The refusals are right; the missing end state is the bug.
- **Quote `0bece51a` carries £10,140 of paid invoices against a £7,800 total.**
  Known, predates the guard that would refuse it today, and it's the last ~£1,690
  of guessed VAT in "VAT collected (all time)".
- **Cosmetics already logged**: the literal `OTHER` category heading on quote
  PDFs; the quote PDF carrying no supplier address; two VAT numbers in
  circulation across older contracts; pre-12-Sep contracts naming a different
  company under the current letterhead; `/i/[id]/paid` telling a visitor
  "We're waiting for confirmation from your bank" before they've started paying;
  clause 3's "due on completion. 7 days." fragment; Schedule A's address running
  into the signature line; clause 11's £2,000,000 cap against £1,000,000 of
  cover; invoice numbers being the first eight hex characters of the id.

## Where to spend the time instead

The contract and VAT surfaces have had four passes. These have had fewer:

- **The quote editor**, especially the Kind field. Its default is "Other", which
  is what drove the clause 2 defect. What does a hand-built quote look like end
  to end — editor, `/q/`, PDF, contract, invoice, P&L — when a contractor never
  touches Kind?
- **A whole job, start to finish, as one story**: voice intake → quote → send →
  accept → contract → sign → deposit → work complete → final invoice → paid →
  P&L. Does every surface agree about the same job at every step?
- **The customer's side.** `/q/`, `/c/`, `/i/` and the paid receipt, read as
  someone with no account and no context. Is anything unexplained, contradictory,
  or alarming?
- **Money arithmetic under awkward inputs**: a fixed price, a provisional sum, a
  crew line with mixed day rates, a materials markup, a 0% deposit, a 100%
  deposit.
- **What happens when something fails** — a declined card, a bad address, a
  denied microphone, a page reloaded mid-flow.

## How to report

Rank by what it does to a real person, not by how hard it was to find:

- **CRITICAL** — a customer or contractor is shown a wrong number, a wrong
  claim, or a document that contradicts itself or another document. Money that
  disagrees across surfaces. Anything on a page someone signs.
- **SERIOUS** — a journey that can't be completed, a state a job can't leave, a
  figure that is right only by luck.
- **COSMETIC** — one line each, no detail needed.

For each finding give: what you did, what you saw (quote the exact figures and
wording), and what the person on the other end would conclude. **Read anything
surprising twice** — once, then again after a hard reload — and say whether the
two reads agreed. If a number looks wrong, check whether it's stored or
recomputed by changing an unrelated setting and reloading.

Say plainly at the end whether you would ship it, and why.

# Motko — decision record

Standing decisions. Agents read this before any judgement call and write
resolved decisions back to it. Newest first.

It exists because the same questions were being asked repeatedly. #300 was
declared ambiguous three times by three PM runs; the third one recommended
exactly what had already been decided and blocked anyway, twenty minutes after
the ruling was posted on the issue. A decision that lives only in an issue
comment is a decision the next agent cannot find.

**A decision recorded here is binding.** An agent that finds its question
answered here acts on it and cites it — it does not re-open it, and it does not
ask for confirmation. An agent that believes a recorded decision is wrong
raises `CONTRACT CONFLICT` and reports it; it does not resolve the conflict
itself. The protocol these rules belong to is in `AGENTS.md`, under "Blocking
is the exception, not the fallback".

Entries are appended in the same commit as the work that acted on them, newest
first, in this shape:

```
## YYYY-MM-DD — <the question, one line>
Decision: <what was chosen>
Rationale: <why, two lines maximum>
Ticket: #NNN
Reversible: yes/no
Precedent: yes/no
```

`Reversible: no` means a revert does not undo it — a migration that has run, an
email that has been sent, a build that has been submitted. `Precedent: yes`
means later tickets will copy the pattern, so the cost of reversing it grows
with each one that does.

## Decisions

## 2026-08-21 — Does #306 implement auto-expand of a section on validation failure?
Decision: No. The spec's own "Explicitly out of scope" section excludes any
change to the behaviour of a Settings section, and auto-expanding on submit
failure requires PayoutDetailsSection to report its validation state to its
wrapper. The frozen contract has no test for it.
Rationale: The spec contradicts itself — derived criterion 6 asks for it and the
out-of-scope section forbids it — and the out-of-scope section is the one the
acceptance tests agree with. Wiring form validation to a wrapper is application
behaviour that wants a real form in front of it, not the primitive ticket.
Ticket: #306
Reversible: yes
Precedent: yes

## 2026-08-21 — How does a roadmap card opt out of the factory explicitly?
Decision: A line reading `NOT FACTORY READY` or `FACTORY: no`, on its own line
in the card body. Admission stops the item, creates it, and leaves it unlabelled.
Rationale: The prose matchers only catch phrasings someone thought to write
down, so a card author needs one marker that always works rather than having to
guess which sentence the regex knows.
Ticket: #277 follow-up
Reversible: yes
Precedent: yes

## 2026-08-21 — Which sort order does the active jobs list use?
Decision: Money-urgency tiers — overdue invoices, unpaid invoices, sent quotes,
sent contracts, drafts — oldest first within each tier, then job id as a final
tie-break. Tiers shown as labelled sections. The dashboard is unchanged.
Rationale: Outstanding money is what a contractor needs to see first, and age
within a tier is the only rule that is explainable without arguing value
against age. The job-id tie-break stops the list reshuffling between renders.
Ticket: #300
Reversible: yes
Precedent: yes

## 2026-08-21 — Can the overdue tier be computed when an invoice has no due date?
Decision: Yes. A null `due_date` is not overdue and falls to the unpaid tier.
No new rule is needed.
Rationale: `invoices.due_date` is nullable, but `isInvoiceOverdue` in
`src/lib/job-stages.ts` already guards it and `deriveJobState` already emits the
`invoice_overdue` situation. This was a question about the schema, not a
product decision, and the schema answers it.
Ticket: #300
Reversible: yes
Precedent: no

## 2026-08-21 — Should #309 build against a mock disclosure while #306 is unmerged?
Decision: No. #309 waits for #306 to merge and resumes at `needs-spec` then.
Rationale: The spec says "using the disclosure component unmodified", so a
placeholder is built against an API that does not exist and replaced the moment
the real one lands — two Engineer rounds to reach the same place, and the
intermediate state cannot be reviewed against the contract that matters.
Ticket: #309
Reversible: yes
Precedent: yes

## Seeded 2026-08-21 — decisions already taken before this record existed

These five predate the record. Each is stated as it stands today, with the
place in the tree that implements it, so a later agent can check the decision
against the code rather than against a memory of a conversation.

## Prior — Does the contract print bank details?
Decision: Only when the contractor cannot take a Stripe payment. When the rail
is available, `{{bank_details}}` resolves to empty and every `{{#bank_details}}`
section collapses.
Rationale: Under fee-at-source motko earns only when money moves through the
Stripe rail, and every template renders `{{bank_details}}` on a document the
customer keeps — a fee-free payment route leaked before the invoice exists.
Gated on capability (`canAcceptStripePayment`), not on account existence, so a
contractor mid-verification is still payable.
Where: `src/lib/contracts/build-variables.ts`
Reversible: yes
Precedent: yes

## Prior — Does the active jobs list include drafts by default?
Decision: Yes. A job with no quote yet is a draft and belongs to the
`in_progress` bucket, which is the default view.
Rationale: A draft is unfinished work the contractor still owns; hiding it by
default makes the list disagree with what they think they have on.
Where: `src/lib/job-history.ts`
Ticket: #305
Reversible: yes
Precedent: no

## Prior — Is the contract clause wording settled?
Decision: Yes. The clause wording in the contract templates has been through
legal review and is signed off. Only the `{{variable}}` plumbing around a clause
may be edited; the clause text may not.
Rationale: The wording carries legal meaning that tests cannot check. This is on
the escalation list: a change to customer-facing contractual copy goes to a
human regardless of confidence.
Where: `src/lib/contracts/templates.ts`
Reversible: no
Precedent: yes

## Prior — Does the AASA file keep the `/i/*/paid` path?
Decision: Yes. `/i/*/paid` and `/settings` stay in the applinks paths for
`PLFZC3LK8F.app.motko.ios`.
Rationale: The paid confirmation is a deep link the app must own; removing it
sends a paying customer to the web page instead of the app.
Where: `public/.well-known/apple-app-site-association.json` and
`src/app/.well-known/apple-app-site-association/route.ts`
Reversible: yes
Precedent: no

## Prior — Is in-app notification control being built?
Decision: No. Notification control was dropped from scope.
Rationale: Not recorded in the tree at the time this record was seeded. Stated
here as given by the owner so the question is closed rather than re-asked; the
reasoning behind it should be filled in by whoever has it. The decision stands
either way — an agent meeting this question acts on it and does not re-open it.
Reversible: yes
Precedent: no

## 2026-08-21 — Does the voice question budget cover the three required slots?
Decision: No. MAX_SOW_TURNS now bounds discretionary scope/detail follow-ups
only; crew, pricing mode and materials supply sit outside it, as do the
customer details a quote cannot be sent without. A spent budget does not
excuse an unasked required slot — the agent asks it anyway.
Rationale: Five questions covering three mandatory asks plus scope plus
customer details is zero slack, so any upstream degradation surfaced as a
skipped mandatory question. A cap that can eat a required question is the wrong
shape at any value, so the exemption is the fix rather than a bigger number.
Ticket: V3
Reversible: yes
Precedent: yes

## 2026-08-21 — Does the "infer rather than interrogate" instruction survive?
Decision: Qualified, not cut. The brevity licence is scoped explicitly to
discretionary detail and explicitly withheld from the three required slots.
Rationale: Cutting it makes the call feel like a form, which is what the line
was written to prevent; leaving it unqualified now pushes toward invention
rather than recall, since V1 removed the retrieved context it used to lean on.
Ticket: V3
Reversible: yes
Precedent: yes

## 2026-08-21 — Do agent sessions get read-only DB access covering customer PII?
Decision: Yes, proceeding as specced. The owner was shown exactly what the
listed tables expose — jobs.transcript / conversation_json / sow_json carry
customer name, site address, phone and email; customers.name + customers.contact;
contracts.signer_name + signed_at — and chose to proceed rather than take the
redacted-view alternative.
Rationale: Transcript-vs-payload classification is the fastest diagnostic for
voice defects and was unavailable during the 21 Aug investigation, which
therefore reached a probabilistic answer where a definitive one existed.
Ticket: V4
Reversible: yes
Precedent: yes

## 2026-08-23 — Do the product's fee constants go on a public pricing page?
Decision: Yes. /pricing on motko.co.uk publishes the fee schedule as the code
implements it: first 5 paid jobs free, +5 more when a referred trade gets their
first job PAID, £2 per paid job up to £1,000 and £4 above it as a hard cap, VAT
inside the fee rather than added, and a £10,000 pay-by-bank ceiling above which
the invoice shows the trade's own account details. Owner confirmed the numbers
after being shown they were read from src/lib/motko-fee.ts,
src/lib/stripe-payments.ts and src/lib/paid-job-settlement.ts rather than
chosen for the page.
Rationale: The figures were already what customers are charged; publishing them
described reality rather than committing to something new. Holding them back
left the site unable to answer the question every visitor asks.
Ticket: marketing-site
Reversible: yes — but only until trades sign up on the strength of it.
Precedent: yes — content/pricing.ts mirrors the product constants and names the
files it mirrors, so a fee change has one place to update and a pointer to what
to check it against.

## 2026-08-23 — Do eleven bank trademarks go on the marketing site?
Decision: Yes. The pay-by-bank section on /pricing carries Stripe's own bank
picker, unaltered, showing Lloyds, Barclays, HSBC, NatWest, Halifax,
Nationwide, Santander, Monzo, Revolut, first direct and Bank of Scotland.
Owner confirmed after the implied-endorsement risk was named.
Rationale: It is a genuine capture of a screen the customer actually reaches,
which is the defensible position; a redrawn substitute would have been a
fabricated screenshot of another company's interface. Recreating it was
declined for that reason.
Ticket: marketing-site
Reversible: yes
Precedent: yes — third-party UI ships as an unaltered capture or not at all.

## 2026-08-23 — Does the My work draft swipe delete, or archive?
Decision: It deletes. `deleteDraftJob` hard-deletes the job row (the draft quote
cascades with it) but only once `assessDraftDeletion` has held that the job has
never left draft and carries no contract, invoice or recorded cost. Anything
else stays with `archiveQuote`.
Rationale: Archiving exists because quotes cascade into financial records — a
verified-empty draft has none, so there is nothing the archive is protecting and
an archive would just move clutter into the Archived filter. The guard, not the
caller, is what makes the delete safe.
Ticket: draft-swipe-delete
Reversible: no — a deleted draft is gone. Mitigated by the guard, by the pull
only revealing the control rather than firing it, and by a confirm on the tap.
Precedent: yes — a destructive action is permitted only behind a server-side
check that proves nothing of record is being destroyed.

## 2026-08-23 — May the intake prompt carry the contractor's saved team?
Decision: Yes, and only that. buildJobIntakeInstructions takes a teamMembers
roster — names, roles, day rates from the contractor's own Settings — and names
them in the instructions. It does not reopen retrieval: no past job, no priced
line item, and a regression test asserts the removed retrieval marker stays
absent from the assembled prompt.
Rationale: peopleLine already told the agent to record anyone "you don't already
know from their team", and nothing was ever passed for that clause to consult —
so every named helper read as new. A saved Liam was asked about again mid-call
and entered a second time. This supplies the fact the instruction was already
written against, rather than adding context of its own.
Ticket: team-duplicate
Reversible: yes
Precedent: yes — the intake prompt may carry the trade's own account settings;
it may not carry anything retrieved from past jobs. That line, not "context in
the prompt", is what the 2026-08-21 removal was about.

## 2026-08-23 — What identifies a team member reported by voice?
Decision: Their name, normalised (trimmed, case-folded, inner whitespace
collapsed). recordTeamMember updates the matching saved member rather than
inserting, and last value wins on role and rate. The saved spelling of the name
is never overwritten from a call.
Rationale: The agent hears a name down a phone line and has no id to offer, so a
name is the only key available. Matching is exact-after-normalising rather than
fuzzy: "Liam Jr" must stay a different person from "Liam", and a wrong merge is
worse than a duplicate.
Ticket: team-duplicate
Reversible: yes
Precedent: yes — findTeamMemberByName in src/lib/team-roster.ts is the one place
a heard name resolves to a saved person.

## 2026-08-24 — Does FEE-2 get to change what #215's frozen test asserts?
Decision: Yes. `tests/acceptance/215.test.ts` asserted a free credit waives the
whole fee (`feeAmountPennies` 0 on a £1,200 job). FEE-2 caps the waiver at the
base band, so that job is now £2 waived and £2 payable. The assertion was
updated, in factory/331's spec commit, to 200 payable / 200 waived.
Rationale: The freeze protects a ticket's own contract from the agent being
judged against it. #215 is not that ticket, and its assertion is not wrong so
much as superseded by a later owner-authored decision — the one #331 exists to
implement. Leaving it would mean FEE-2 can never ship. The test's actual
subject, the job_consumed ledger burn, is untouched.
Ticket: #331
Reversible: yes
Precedent: yes — a prior ticket's acceptance test may be updated where a later
ticket deliberately supersedes the behaviour it pinned, in the first commit of
the branch doing the superseding, and never to make a finding go away.

## 2026-08-24 — Which of FEE-1 and FEE-2 keeps migration version 045?
Decision: #330 keeps `00000000000045_activated_referral_count.sql`; #331's
becomes `00000000000046_fee_waived_amount.sql`.
Rationale: Both branches claimed 045 and collided. FEE-1 grants the credits
FEE-2 then caps, and the ticket says FEE-1 ships first with FEE-2 close behind,
so the numbering follows the merge order rather than the other way round.
Ticket: #330, #331
Reversible: yes

## 2026-08-24 — #222's migration selector picks the wrong file once any later migration says "referral"
Decision: Pin it. `findMigrationFile`/`readMigration` in
`tests/acceptance/222.test.ts` now select on "referral_unlock" rather than
"referral", naming the one migration (040) that issue added.
Rationale: The helper sorted every migration containing "referral" and took the
last. #330's `045_activated_referral_count` is the first later migration to
carry the word, so it was silently selected in 040's place and eight assertions
about an index it never claimed to create failed. Narrowing the pattern is a
tightening — every assertion still runs, against the file it was written for.
Ticket: #330
Reversible: yes
Precedent: yes — a test that locates a migration by substring names it exactly;
"newest file containing X" is only correct until someone else says X.

## 2026-08-24 — The deleted-module collision check cannot be satisfied
Decision: Scope it to each sibling branch's own diff.
`scripts/ci/cross-branch-collisions.ts` grepped the whole tree of every other
open factory branch; every branch is cut from main, so main's importers are in
all of them. #334 raised ten collisions across five branches, none of which
touches the deleted files or anything importing them.
Rationale: The old verdict was unreachable by construction — any branch
deleting a module main still uses collides with every open branch at once, so
it could not go green while one existed and the only way to satisfy it was to
stop deleting. A sibling breaks only if its own work imports the module;
otherwise the deletion lands first, rewriting the importers with it. The
resolution moved into a pure `resolveImporters()` so the rule is tested.
Ticket: #334
Reversible: yes
Precedent: yes — a cross-branch check asks about a sibling's diff, never its
inherited tree.

## 2026-08-24 — Is /.well-known/ a public route?
Decision: Yes. `/.well-known/` is registered in `isPublicRoute` in
`src/lib/supabase/middleware.ts`, and deliberately NOT excluded in the
`src/proxy.ts` matcher.
Rationale: Apple's AASA fetcher is unauthenticated and Apple forbids a
redirect, so the /login fallthrough meant no universal link worked on any path
— including `/i/*/paid`, which a prior decision on this page says the app must
own. Registering it keeps the surface visible where public exposure is
reviewed; a matcher exclusion would stop the 307 while hiding the route from
the list. These files read no table and carry no PII.
Ticket: Notion Bugs — "AASA file is served behind the auth redirect"
Reversible: yes
Precedent: yes — unauthenticated platform metadata is registered as public,
never hidden from the proxy.

## 2026-08-24 — Which password recovery route does Motko build?
Decision: Complete the reset that was already half-built — "Forgot your
password?" on /login, resetPasswordForEmail, a recovery code path via
verifyOtp({ type: "recovery" }), and a /reset-password screen that calls
updateUser. Passkeys and a settings-based change-password control are both out
of scope for now.
Rationale: /signup has always REQUIRED a password and recovery.html already
shipped registered in config.toml with nothing able to send it, so this closes
a half-built feature rather than adding credential storage. Smallest gap
between recorded intent and shipped state, and what the locked-out user asked
for.
Ticket: Notion Bugs — "Password reset does not exist, though signup requires a
password"
Reversible: yes
Precedent: yes — a verified recovery credential buys a session and nothing
more; it must always land on a screen that asks for the new password, never on
the dashboard.

## 2026-08-24 — How does the guest quote screen get the PDF out on iOS?
Decision: A full-screen viewer rendered in the same document, opened by a
button. Not an anchor at the blob URL, with or without target="_blank".
Rationale: Capacitor's decidePolicyFor cancels any top-level navigation whose
URL does not start with the server origin, and a blob: URL never does, so the
tap was handed to UIApplication.shared.open — which has no handler for the
blob: scheme and fails silently. Dropping target="_blank" is a no-op; a
main-frame blob navigation dies identically. An <object> is a subresource
rather than a navigation and is allowed through, which is why the inline
preview renders at all. No capacitor.config.ts change: allowNavigation is
gated behind a non-nil URL host, which a blob URL does not have.
Ticket: Notion Bugs — "Guest quote Open the PDF is inert in the iOS app"
Reversible: yes
Precedent: yes — a blob: URL is never the target of a navigation in this app;
it is rendered as a subresource or handed to the share sheet as bytes.

## 2026-08-25 — What does "paid" mean for a bank-rail job?
Decision: Money landed, not "the customer paid". A job settles when the funds
are actually the contractor's, not on `payment_intent.succeeded`.
Rationale: The trade reads "paid" as "the money is mine" and acts on it —
stops chasing, starts the next job. Settling on intent success books the motko
fee and burns a free job against money they cannot spend.
Ticket: Notion Bugs — "A job is marked paid on payment_intent.succeeded"
Reversible: no — `paid_at` semantics change for every row written after it.
Precedent: yes — a money state means the money moved, never that a request
succeeded.

## 2026-08-25 — Where does stripe_payouts_enabled get its value?
Decision: `account.payouts_enabled`, the top-level boolean on the Stripe
Account object. Not `capabilities.transfers`. The sibling line moves to
`account.charges_enabled` at the same time.
Rationale: `capabilities.transfers === "active"` means the account may RECEIVE
transfers into its Stripe balance; `payouts_enabled` means Stripe will pay that
balance out to their bank. They diverge whenever no external account is
attached or payouts are paused — and in that state the column said true and
Settings told the trade their payout setup was complete.
Ticket: Notion Bugs — "stripe_payouts_enabled is populated from
capabilities.transfers"
Reversible: yes
Precedent: yes — a column named for a fact is populated from that fact, never
from a proxy for it.

## 2026-08-25 — What does the trade see for an uncollectable motko fee?
Decision: Stop showing it as outstanding. The ledger rows stay exactly as they
are; only the presentation changes.
Rationale: Nothing collects them and nothing is intended to while the
early-access promise stands, so "Outstanding" is a bill for a debt that does
not exist. Changing the presentation leaves the accounting record intact;
waiving the rows would be an irreversible write to money records for a display
problem.
Ticket: Notion Bugs — "Fee statement shows the trade an outstanding balance
nothing will ever collect"
Reversible: yes
Precedent: yes — a ledger row and what a user is told about it are separate
decisions.

## 2026-08-25 — Do we validate the VAT number on customer documents?
Decision: No, not for now. VAT numbers stay unvalidated.
Rationale: Owner's call, taken with the exposure known: a malformed number
prints on quotes and on signed contracts, and a customer's accountant cannot
reclaim against it. Revisit before the product is sold to trades outside the
early-access group.
Ticket: Notion Bugs — "Customer-facing documents print an unnormalised postcode
and an unvalidated VAT number"
Reversible: yes
Precedent: no

## 2026-08-25 — Does the voice transcript panel get more of the screen?
Decision: No. Leave it as it is.
Rationale: The assistant speaks its questions aloud, so the transcript is a
diagnostic rather than the interface. Recorded explicitly so the question is
closed rather than re-asked.
Ticket: Notion Bugs — "Voice transcript is a short scroll region"
Reversible: yes
Precedent: no

## 2026-08-25 — SUPERSEDES the "paid means money landed" entry above
Decision: "Paid" keeps its current meaning — the customer paid — and settlement
stays on `payment_intent.succeeded`. "Landed" becomes a SECOND, separate state
meaning the money reached the contractor's own bank out of Stripe. Two words,
two states, rather than moving the first one.
Rationale: The owner's clarification on being asked to resolve the
available-vs-paid-out fork. It answers the original complaint ("marked as paid
but no monies received") by ADDING the missing state rather than delaying the
existing one — which also removes everything that made the earlier decision
expensive: no change to `paid_at` semantics, no re-timing of the fee booking or
the free-job burn, and no double-settle risk from two events racing.
Note: this reverses the earlier entry of the same date, which said a job must
NOT settle on `payment_intent.succeeded`. That entry is superseded, not amended
— left in place above so the change of direction is visible rather than edited
out of the record.
Ticket: Notion Bugs — "A job is marked paid on payment_intent.succeeded"
Reversible: yes — nothing is rewritten; the change is additive.
Precedent: yes — where a user-facing word is ambiguous, add the missing state
rather than redefining the existing one.

## 2026-08-25 — What gates whether we can accept a Stripe payment?
Decision: NOT `charges_enabled`. `canAcceptStripePayment` keeps reading
`stripe_payouts_enabled` (which holds the `transfers` capability) and is left
alone.
Rationale: The owner answered "point it at charges_enabled" on my
recommendation, and MY RECOMMENDATION WAS WRONG. I had not read the function's
own comment. These are DESTINATION charges: the platform is merchant of record,
`createConnectedAccount` requests only `transfers`, and `card_payments` is
deliberately never requested — so `charges_enabled` is false for every
contractor and always will be. Pointing the gate at it would shut the pay
button for everyone, which is a mistake this codebase has already made and
already fixed once. The gate is correct as written; only the COLUMN NAME is
wrong, and the real `account.payouts_enabled` is not stored anywhere.
Ticket: Notion Bugs — "stripe_payouts_enabled is populated from
capabilities.transfers"
Reversible: n/a — nothing changed.
Precedent: yes — read the function's own comment before recommending a change
to what it gates on.

## 2026-08-25 — How is the uncollectable motko fee presented?
Decision: Relabel it as recorded-not-charged. Not omitted, and the ledger rows
are untouched. The net/VAT split goes with the "Outstanding" framing.
Rationale: The trade stays informed that a fee exists in principle without
being shown a debt nothing will collect. A VAT breakdown on an amount that is
not being charged is misleading whichever label sits above it.
Ticket: Notion Bugs — "Fee statement shows the trade an outstanding balance"
Reversible: yes
Precedent: no

## 2026-08-25 — Do we normalise the postcode on customer documents?
Decision: No. The site address stays free text as captured.
Rationale: Owner's call. `normalizeUkPostcode` stays where it is and is not
applied to the document path. Revisit if a downstream address lookup is built
that needs a canonical form.
Ticket: Notion Bugs — "Customer-facing documents print an unnormalised postcode
and an unvalidated VAT number" — this closes that ticket entirely, the VAT half
having been declined on the same terms earlier today.
Reversible: yes
Precedent: no

## 2026-08-25 — How is brand colour stopped from being illegible?
Decision: Constrain the DESIGN, not the input — option (d). Brand colour is only
used where contrast cannot fail; it never backs text. No picker validation, no
contrast floor on the value, no live preview. Branding emphasis is the logo, not
the colour.
Rationale: Overruling a trade's own brand colour is the wrong place to spend
the constraint. Removing the failure class from the documents removes the
problem for every colour at once, and the logo is what carries the brand on a
customer's document anyway.
Ticket: Notion Bugs — "Brand colour has no contrast guard and no preview"
Reversible: yes
Precedent: yes — remove a failure class in the design rather than policing the
input that would trigger it.

## 2026-08-25 — Can a quote send when its narrative and its total disagree?
Decision: Yes, with a confirmation — mirroring ZERO_TOTAL_CONFIRM_REQUIRED. Not
a hard block.
Rationale: A narrative may legitimately quote a figure for part of the works,
and a £5 callout is a real quote. The existing zero-total shape already handles
"this looks wrong but may be deliberate" and is the precedent to follow rather
than invent a second one.
Ticket: Notion Bugs — "Quote priced at £5.00 while its own Scope of Work says
£5,000"
Reversible: yes
Precedent: yes — a figure that looks wrong is confirmed, never blocked.

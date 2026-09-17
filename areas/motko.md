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

## 2026-09-16 — Withdrawn contracts excluded from dashboard list
Decision: Withdrawn contracts do not appear in the "Signed & declined contracts" dashboard list.
Rationale: Withdrawn contracts are neither signed nor declined by the customer — they were retracted by the contractor before any customer action. Including them would contaminate a list that shows completed customer decisions with an internal contractor action.
Ticket: #775
Reversible: yes
Precedent: yes

## 2026-09-15 — Job stage after contract withdrawal
Decision: After withdrawal, the job stage returns to "Accepted — need contract" rather than staying stuck at "Awaiting signature".
Rationale: A withdrawn contract is treated as if it never existed for pipeline purposes, putting the contractor back in control to send a corrected contract. Without this, a withdrawn contract leaves the job in an unactionable state.
Ticket: #775
Reversible: yes
Precedent: yes

## 2026-09-15 — Quote editability after contract withdrawal
Decision: After withdrawal, the quote becomes editable again. A withdrawn contract does not block editing, but a sent/signed contract continues to block.
Rationale: The contractor needs to fix the error that led to withdrawal. Keeping the quote locked would force them to abandon the job and start over. This checks contract STATUS, not just presence — the rule is "a live contract blocks editing", not "any contract row blocks editing".
Ticket: #775
Reversible: yes
Precedent: yes

## 2026-09-15 — Signed contracts cannot be withdrawn
Decision: Attempting to withdraw a signed contract is refused at the server action level with a clear error message directing the contractor to raise a variation or new quote instead.
Rationale: A signed contract is a binding agreement. Allowing withdrawal after signature would let the contractor unilaterally void a contract the customer has already committed to. The refusal is at the write level, not just hidden in UI, so a hand-crafted call or race condition cannot bypass it.
Ticket: #775
Reversible: yes
Precedent: yes

## 2026-09-15 — Customer notification on contract withdrawal
Decision: The customer is not notified when a contract is withdrawn (no email, no SMS). The link simply stops working.
Rationale: The contract was withdrawn precisely because it contained an error. Telling the customer "we've withdrawn it" before sending the corrected one creates confusion and undermines confidence. The contractor sends the corrected contract, which is what the customer receives.
Ticket: #775
Reversible: yes
Precedent: yes

## 2026-09-04 — Include fractional multipliers beyond "and a half" in stated-price extraction
Decision: Handle "and a half", "and a quarter", and "and three quarters" as fractional multipliers before scale words (thousand, hundred). All three patterns follow the same speech structure and should be supported together.
Rationale: These are natural variants of the same fractional pattern in spoken amounts. Supporting only "and a half" would leave "one and a quarter thousand" and "one and three quarters thousand" broken, requiring a future PFIX-12 for the identical fix.
Ticket: #563
Reversible: yes
Precedent: yes

## 2026-08-28 — First stored pipeline state: work_completed_at on jobs
Decision: Keep the pipeline derivation pure — read the new work_completed_at column as an input to deriveSituation, exactly as contracts.signed_at is read. Do not move logic into the component. The stored state lives on the job; the derivation reads it and computes the situation from it.
Rationale: job-stages.ts opens with "Pure derivation... no new state storage." Completion breaks that invariant for the first time. The alternative — computing completion from a date, duration, or invoice — produces a guess where a fact exists, so this item adds the first genuinely stored pipeline state.
Why: Nothing in the existing quote/contract/invoice rows implies that work finished. This state gates invoice creation in a future item.
How to apply: Later pipeline state additions follow this pattern — stored on jobs, read by deriveSituation as a parameter, never inferred from something else.
Ticket: #419
Reversible: yes
Precedent: yes

## 2026-08-24 — Marketing assets audit for "free while in early access" wording
Audit performed: All five PNG files in public/marketing/ (accept.png, dashboard.png, job.png, quote.png, sow.png) were examined for "free while in early access", "free during beta", or other open-ended free-access wording per spec criterion 14.
Result: All assets are clean. They contain only product screenshots (quote views, dashboard, job tracking) with no pricing claims or problematic wording. No regeneration or removal required.
Rationale: Spec explicitly requires auditing existing marketing materials and regenerating/removing any carrying old wording. The audit was performed and assets verified clean, satisfying the "must audit" requirement even though no changes were needed.
Ticket: #335
Reversible: yes
Precedent: yes — marketing asset audits for deprecated copy must be documented when performed, even when no changes result

## 2026-08-24 — Where does the motko.co.uk marketing site live?
Decision: Create it as a standalone static site in a new `/site` directory at the repository root, to be deployed separately to motko.co.uk via Vercel or similar.
Rationale: The marketing site needs to exist at motko.co.uk (the old landing page at motko.app was removed in #324). Keeping it in the same repository but in a separate directory maintains code proximity while allowing independent deployment from the app (motko.app).
Ticket: #335
Reversible: yes
Precedent: yes

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

## 2026-08-25 — Was the manual Stripe payout schedule deliberate?
Decision: No. It was not intended, and the payout leg is to be built.
`createConnectedAccount` sets `settings.payouts.schedule.interval: "manual"`
and nothing in the codebase ever calls `stripe.payouts.create`, so money has
been accumulating in every contractor's connected balance and never reaching
their bank.
Rationale: Owner confirmed on being asked directly. Recorded because the
absence of a decision is what let this run: `manual` is a deliberate opt-out
from Stripe's own payout handling, and there are legitimate reasons a platform
takes it — so a future reader finding that line needs to know it was an
accident rather than a policy, and must not "restore" it.
Where: `src/lib/stripe-connect.ts` (account creation), and the absent
`payouts.create` across `src/`.
Ticket: Roadmap PAY-8
Reversible: yes for the schedule change; NO for clearing the balances that have
already accumulated, which is a separate item and a separate approval.
Precedent: yes — an intentional opt-out from a provider's default behaviour is
recorded as a decision at the time, or it becomes indistinguishable from a bug.

## 2026-08-25 — How often should motko pay contractors out of Stripe?
Decision: Daily. The payout schedule set on the connected account moves from
`manual` to an automatic daily interval, and PAY-8 builds against that.
Rationale: Owner's answer on being asked the cadence. Daily is Stripe's own
default for GB Express accounts and the shortest cadence that needs no
per-payout call from us, so it removes the payout leg as a thing motko has to
remember to do rather than adding one. A trade whose money is already late is
best served by the fastest schedule available, not by a batched one.
Ticket: Roadmap PAY-8
Reversible: yes — the schedule is an account setting and can be changed again.
Precedent: yes — prefer the provider's automatic schedule over a
motko-initiated one wherever the provider offers it; a cadence we do not have
to invoke cannot be forgotten.

## 2026-08-25 — Clearing the balances that have already accumulated
Decision: Parked. Not actioned in this pass. PAY-8 fixes the schedule going
forward; what is already sitting in each connected balance is a separate item
needing separate approval.
Rationale: Owner's instruction ("don't worry about that now"). Recorded rather
than dropped because a schedule change alone does not necessarily release a
balance accrued under the old one, so a reader who sees PAY-8 land must not
assume the historical money moved with it.
Ticket: Notion Bugs — "Clear the Stripe balances accumulated under the manual
payout schedule"
Reversible: n/a — nothing is being done.
Precedent: no.

## 2026-08-25 — FEE-2 held back from merge pending its migration
Decision: #332 (FEE-2, cap what one free job waives at the base band) is NOT
merged, despite being named for merge, until migration
`00000000000046_fee_waived_amount.sql` is applied to production. FEE-1, FEE-3
and FEE-4 merged.
Rationale: `settle-paid-job.ts` writes `jobs.fee_waived_amount_pennies` in the
same update as the other fee columns. Migrations do not run on Vercel deploy —
they are pushed by hand — so merging the code first means the settlement write
fails against a column that does not exist, on the money path. This is the
recorded "schema must precede code" rule, applied.
Note: FEE-1 has the same shape and was already merged before this was noticed —
its migration `045` adds the `increment_activated_referral_count` function that
`settle-paid-job.ts:189` calls and THROWS on. It is narrower (only a referred
trade's first paid job reaches it) but it is live. Both migrations need pushing.
Ticket: Factory #331 / #330
Reversible: yes — merging is one click once the schema is in.
Precedent: yes — a factory PR carrying a migration is held until the migration
is applied, whoever named it for merge. The gate does not catch this: every
check on #332 was green.

## 2026-08-25 — Brand colour: which roles the design constraint actually covers
Follows: "How is brand colour stopped from being illegible?" above, which took
the decision. This records what building it settled, since option (d) only
becomes actionable once every role the colour fills is named — and two of them
turned out not to need guarding at all.
Decision: Only the roles that PAINT TEXT decline a failing colour. Fills and
rules keep the raw value. Any colour a trade enters is still accepted and
stored unchanged.
Enumeration this rests on — every use of `brand_color`, and its role:
  - monogram fill (`PdfHeader`, `<Monogram/>`) — a FILL. `getContrastingTextColor`
    picks initials against it, so it cannot fail. Untouched.
  - company name (`PdfHeader`) — TEXT on white paper. Guarded.
  - `<h1>` on `/q/[id]` and `/c/[id]` — TEXT on a near-white surface. Guarded.
  - `PdfAccentBar`, `sectionTitle` underline — RULES. They carry no text, so a
    pale one reads as an unbranded document rather than a broken one. That is a
    degradation, not a failure. Untouched, deliberately.
Floor: WCAG AA 4.5:1 against white, not the softer large-text 3:1 — paper is
stricter than a backlit screen and the printed copy is the one a customer keeps.
Applies to: rendering, so both new and EXISTING stored colours, immediately and
with no migration. Nothing stored is rewritten and no already-sent document
changes — a sent quote is evidence of what was sent. The reported account keeps
`#FEF7B8`; its next document simply sets the company name in ink.
Ticket: Notion Bugs — "Brand colour has no contrast guard and no preview"
Reversible: yes — presentation only.
Precedent: yes — where a user-supplied value can break a document, prefer
removing the role that breaks over validating the value.

## 2026-08-25 — The fee relabel as built, and the surface the ticket missed
Follows: "How is the uncollectable motko fee presented?" above, which took the
decision. This records the wording chosen and one coupled surface that was not
in the ticket's scope and had to move with it.
Wording: "Outstanding — not taken at source" becomes "Recorded, not charged",
and the job-page line becomes "Motko fee £X — recorded, not charged." The figure
stays but drops to secondary weight.
Ledger: rows stay `fee_status = 'accrued'`. No migration, no write, nothing
retroactive. The record of the fee survives, which is what rules out option (b).
Hand-marked-paid jobs KEEP ACCRUING an uncollectable fee — this population grows
every time a trade marks a job paid by hand, so the copy avoids calling it
legacy and the block must keep working for a bucket that is still filling.
VAT: the net/VAT breakdown is removed from this block only. A tax split on an
amount nobody is charged describes a position that does not exist, and it was
the detail that made the figure read as an invoice.
Coupled surfaces: the Settings statement and `paidJobFeeLine` are held
word-for-word in step by `src/lib/fee-copy.test.ts`. Relabelling one alone is
how a trade ends up told two different things about a single fee.
Still open, and NOT resolved by this: whether the free allowance was correctly
spent on those three jobs. That needs the stored rows and remains a CAPABILITY
FAULT — if the allowance was never granted, or was decremented more than once
per job, that is a separate and more serious defect than this one.
Ticket: Notion Bugs — "Fee statement shows the trade an outstanding balance
nothing will ever collect"
Reversible: yes — presentation only.
Precedent: yes — never show a figure under a word that implies an obligation
the product has no mechanism and no intention to enforce.

## 2026-08-25 — CORRECTS the PAY-8 invalidation criterion I wrote
Decision: PAY-8 stands. The Stripe dashboard check it named as potentially
fatal to the ticket does not invalidate it, and the criterion I wrote for that
check was wrong.
What happened: PAY-8 §6 said a populated payout list would mean payouts were
happening by a route invisible to the repo, and that the ticket should then be
rewritten rather than adjusted. The owner ran it. The connected account shows
`Payouts Daily`, recurring transfers on, and an upcoming payout. On my stated
criterion, PAY-8 dies.
Why it doesn't: that account was created 15 Aug 2026.
`src/lib/stripe-connect.ts` — the file containing `createConnectedAccount` and
its `interval: "manual"` — did not exist until 18 Aug 2026 (`2f8f3d7` adds the
file whole). The account never went through the code path, so it took Stripe's
default schedule. It is the one account in the system that cannot exhibit the
bug, and I pointed the check at it.
What the check did establish: a clean cutover. Accounts created before 18 Aug
are on Stripe's default and pay out. Accounts created by
`createConnectedAccount` from 18 Aug carry `manual` and never will. The defect
is prospective, not historical — which also corrects PAY-8 §2's claim that it
affects "every contractor who has ever been paid through the Stripe rail".
Rationale for recording rather than quietly amending: the criterion was stated
in the ticket as decisive, a human acted on it, and the evidence came back
looking like a refutation. A reader who finds the screenshot without the dates
will conclude PAY-8 was built for a bug that does not exist.
Ticket: Roadmap PAY-8
Reversible: n/a — this is a correction to a record.
Precedent: yes — when a check is written to invalidate a ticket, name the
population it must be run against. An observation from an entity that predates
the code proves nothing about the code.

## 2026-08-25 — Migrations 045 and 046 verified on prod, not just ticked
Decision: Closed. Both are genuinely applied; the FEE-2 merge hold recorded
earlier today is discharged.
Evidence: queried prod directly rather than trusting `supabase migration list`.
`increment_activated_referral_count` exists in `pg_proc`;
`contractors.activated_referral_count` and `jobs.fee_waived_amount_pennies`
both exist in `information_schema.columns`. A control count on
`pg_class.contractors` returned 1, so the session was connected to prod and an
empty result would have meant absence rather than a dead connection.
Why it needed checking: 044 and 045 were recorded on remote while the owner's
local clone was 37 commits behind and had neither file, and nothing in CI
applies migrations — `factory-deploy.yml` only labels a migration PR and tells a
human to push it. So the ledger rows were written by hand, and a
`migration repair --status applied` would have produced exactly the same ledger
with no DDL. It did not; the DDL is there.
Method note worth keeping: the first probe returned nothing because the SQL was
pasted into zsh rather than a database client, and an empty terminal is
indistinguishable from an empty result set. Re-running it as `count(*)` rows
with a control row made the difference legible — every row prints, so silence
can only mean the query never ran. Phrase a prod probe so that "no output" and
"no rows" cannot be confused.
Ticket: Factory #330 / #331
Reversible: n/a — a verification, not a change.
Precedent: yes — confirm the object exists on prod, never the ledger tick
alone; and write the probe so an unrun query is distinguishable from a
zero-row result.

## 2026-08-25 — RESOLVES the conflict between the two stripe_payouts_enabled entries
Decision: Rename the column to match what it holds. It stores the `transfers`
capability, so it is named for that; `canAcceptStripePayment` keeps reading it
and is not touched. The real `account.payouts_enabled` is not stored today and
is not added by this decision.
Supersedes: the earlier entry of this date, "Where does stripe_payouts_enabled
get its value?", which said to repopulate the column from
`account.payouts_enabled`. That entry is withdrawn, not amended — left above so
the conflict and its resolution are both visible.
Why the earlier entry was dangerous: `stripe-connect.ts:119` populates the
column from `capabilities.transfers`, and `canAcceptStripePayment` (line 169)
gates the pay button on that column. Repopulating it from
`account.payouts_enabled` would silently change what the pay button gates on —
and `payouts_enabled` is false for a trade with no external account attached,
who can still legitimately receive transfers into their Stripe balance. It
would shut the pay button for exactly the people currently able to take money.
Two entries were live on one ticket for several hours and either could have been
built.
Note: this is the SECOND correction on this ticket in one day. The first was my
recommendation to point `canAcceptStripePayment` at `charges_enabled`, which was
also wrong, and for the same underlying reason — reasoning about these three
flags from their names rather than from what populates them.
Ticket: Notion Bugs — "stripe_payouts_enabled is populated from
capabilities.transfers"
Reversible: yes, but it carries a migration, so schema precedes code.
Precedent: yes — when a column's name and its contents disagree, change the
NAME unless something reads it for the fact the name promises. Renaming moves no
money; repopulating changes every reader at once.

## 2026-08-25 — The second money state is called "deposited", not "landed"
Decision: Two words, two states. **Paid** = the customer paid (unchanged,
`payment_intent.succeeded`). **Deposited** = the money has been sent on to the
contractor, fired from Stripe's `payout.paid`.
Rationale: Owner's wording, chosen after being shown that `payout.paid` means
Stripe SENT the money rather than that it arrived — so "deposited" is defined
here as the sending moment, deliberately, not as confirmed arrival.
Consequence for the copy, which the decision does not remove: "deposited" reads
to a trade as "it is in my account", and on a BACS payout it can be another
working day. The surface must therefore show Stripe's `arrival_date` alongside
the state rather than the state alone — "Deposited 25 Aug, with you by 27 Aug".
The word is settled; pairing it with the date is what keeps it honest, and it is
the same failure mode as the "Connected ✓" tick if it is dropped.
Ticket: Notion Bugs — "Add 'deposited'"
Reversible: yes — no stored state depends on the label.
Precedent: yes — a money state fired on a provider's "sent" event is always
displayed with the provider's own arrival estimate, never on its own.

## 2026-08-25 — Accumulated Stripe balances: handled outside the product
Decision: Closed. The owner cleared the balances that had accumulated under the
manual payout schedule, directly in Stripe. Nothing is stuck.
Rationale: Owner's report. Recorded because the parked ticket would otherwise
keep implying money is sitting somewhere, and because a future reader comparing
Stripe history against this repo will find payouts with no corresponding code
path — they were made by hand, and that is the explanation.
Note: this does NOT make PAY-8's sweep redundant unless the SCHEDULES were also
changed in the dashboard. Clearing a balance is one-off; the sweep sets the
recurring schedule on existing accounts. The sweep is idempotent, so running it
is harmless either way and remains the safe move.
Ticket: Notion Bugs — "Clear the Stripe balances accumulated under the manual
payout schedule"
Reversible: n/a — already done, outside the product.
Precedent: no.

## 2026-08-25 — What counts as "owed to you"
Decision: Sent invoices only. Money owed is the total of invoices actually
issued to a customer and not yet paid. Drafts are excluded, and so is work the
customer has accepted but which has not been invoiced.
Rationale: The figure means "money I have asked for and not received", which is
the number a trade chases. `invoices.status` defaults to `'draft'`, so counting
everything unpaid would count invoices the customer has never seen.
Note: there was no prior behaviour to preserve. The existing filter
(`money-position-actions.ts:90`, `.eq("status", "unpaid")`) matches a value
nothing in the product ever writes, so the query has always returned an empty
set. This decision defines the behaviour rather than changing it.
Ticket: Notion Bugs — "'OWED TO YOU' is always empty"
Reversible: yes — a filter change, no stored state.
Precedent: yes — accepted-but-uninvoiced work is not "owed" anywhere in the
product, on screen or in voice.

## 2026-08-25 — The voice money surface is gated until the ledger query is fixed
Decision: Hide/disable the "Ask about money" entry point until `getMoneyPosition`
returns correct figures, then restore it.
Rationale: The surface speaks "You're all caught up — no outstanding invoices"
out loud, off the same broken query as the screen. A confident spoken all-clear
to a trade who may be owed thousands is materially worse than a blank panel,
because there is no figure on screen to sanity-check it against.
Not in question: the money-integrity design held. Every figure is computed and
worded in code and crosses into the session as finished English — the model
invented nothing. A wrong input was rendered correctly, which is why the gate is
on the input and not on the prompt.
Ticket: Notion Roadmap — "DECISION: gate the voice money surface…"
Reversible: yes — restore the entry point once the query is fixed.
Precedent: yes — a voice surface is gated whenever its underlying figures are
known-wrong, even where the equivalent screen is left live. Spoken numbers carry
more authority than displayed ones and get no second look.

## 2026-08-25 — The referral reward stays referrer-only; the copy is reworded
Decision: The referee gets the standard 3 free jobs every new contractor gets.
No extra grant on redemption. The referrer's copy is reworded to say so.
Rationale: The reward already flows one way in code — `signup_grant` (delta 3)
is unconditional in `provisionNewContractor`, and redeeming a code creates a
`referrals` row and no credit event. The existing copy ("They get 3 free jobs")
is literally true and materially misleading, because they would have had those
3 without the code. Owner chose accuracy over sweetening the offer.
Consequence: the offer is now visibly one-sided, which is a weaker thing to ask
a trade to share. Accepted deliberately.
Ticket: Notion Roadmap — "DECISION: the referral offer is one-sided…"
Reversible: yes — copy only; no credit logic changes.
Precedent: yes — referral copy states what the code actually grants. A benefit
every user receives anyway is never presented as a reward for redeeming.

## 2026-08-26 — "Get the app" is shown to every web signup, not only referrals
Decision: The post-signup app handoff is shown to anyone who creates an account
in a browser, not only to trades who arrived via a referral link.
Rationale: The problem is not referral-specific — a trade who signs up on the
web and never learns there is an app ends up using a different product from the
one they were sold, however they arrived. Referrals only surface it, because a
shared link is the one route that reliably lands a first-time user in a mobile
browser. Scoping to referrals would leave the same gap open on every other web
signup and require a second ticket later.
Ticket: Notion Roadmap — "Get the app: a post-signup step for referred trades"
Reversible: yes — a display condition.
Precedent: no.

## 2026-08-26 — Referral links carry the code in the path, not the query
Decision: /join/<code> — the code is a path segment. `?ref=` keeps working
indefinitely for links already in circulation.
Rationale: A path segment survives share sheets and messaging apps that trim or
mangle query parameters, and it reads as a real destination rather than a
tracking URL. extractReferralCode already parses a bare code, so a path segment
needs no new parser. Retaining ?ref= costs one line and the alternative is
breaking every link a trade has already sent.
Ticket: Notion Roadmap — "A /join/<code> landing route for referral links"
Reversible: yes, but not cheaply once links are in circulation — hence deciding
it before the route is built rather than after.
Precedent: yes — user-shareable links put their identifier in the path.

## 2026-08-26 — The App Store link lives on the marketing site, and only there
Decision: site/index.html carries the App Store listing URL literally
(https://apps.apple.com/gb/app/motko/id6791990099). The motko.app codebase stays
at zero App Store references, as tests/regression/app-store-link.test.ts already
required. Anything in the product that wants to offer the app links to
motko.co.uk rather than to the store.
Rationale: Owner's choice, 26 Aug. One owner for the URL. site/ is static HTML
with no build step, so it cannot read an env var and the literal is unavoidable
there — which is fine, because it is also the only place that needs it. Putting
a caller in src/ would require either an apps.apple.com literal (caught by the
repo-wide scan) or a resolveAppStoreHref caller (caught by the zero-callers
test), both of which exist for good reasons.
Context worth keeping: until this landed there was NO route to the app anywhere
on the internet. The download button was removed from the motko.app landing page
deliberately and was supposed to reappear on motko.co.uk; that half was never
built, and a comment in the test asserting it HAD been is why nobody noticed.
The comment is corrected and now written in the past tense.
Ticket: Notion Bugs — "motko.co.uk has no download button, and a test comment
says it does"
Reversible: yes — one line in site/index.html.
Precedent: yes — a guard's rationale that depends on external state is written
in the conditional or names the ticket tracking it, never asserted as fact.

## 2026-08-26 — A stated fixed price with no mode is a fixed price
Decision: `pricingSchema.mode` loses its `"calculated"` default and becomes
optional; `resolvePricingModeFromDelta` infers `"fixed"` from a positive
`fixed_amount` when the model omits the mode, an explicit mode always wins, and
a delta with neither leaves `pricing` untouched so the slot re-asks. Separately,
every writer of `quotes.line_items_json`/`total` now reconciles a stated
`fixed_amount` against the priced non-provisional lines and raises a
contractor-facing flag on a mismatch.
Rationale: the default manufactured an answer, and it was silent in both
directions — `applyPricingMode` never used the stated amount, and
`isDurationSlotAnswered` treats `"calculated"` as answered, so nothing re-asked.
Naming a number IS choosing a fixed price. The reconciliation is the safety net
that catches this and the two other routes to the same divergence, one of which
is live in production: a quote whose SoW says £5,000 against a £5.00 works line,
accepted at £6.00.
Ticket: #368 / Notion Bugs — "Nothing reconciles a stated fixed price against
the quote, and the mode can default away"
Reversible: yes.
Precedent: yes — money that a user stated is reconciled against what was
persisted, by every writer, and a mismatch reaches a human as a flag rather than
as an analytics event.

## 2026-08-26 — What does an edit to an already-sent quote do?
Decision: Disclose, and offer a re-send. `quotes` gains a `sent_total` stamped at
send; the public quote page renders the current figure plus a notice that an
earlier message quoted a different one, with a "Re-send to customer" button
beside it. Edits to a `sent` quote stay permitted — `EDITABLE_STATUSES` is
unchanged. Rejected: auto-re-send on every change (texts a customer over a typo)
and freeze-on-send (needs real versioning, and removes a workflow trades rely on).
Rationale: the SMS is a frozen artefact and `/q/[id]` is a live projection, so
they diverge silently the moment a sent quote is edited — a customer holding
£114 against a page showing £20 is a dispute, and today nothing anywhere records
that the two disagree. Disclosure makes it legible without removing the ability
to correct a mistake, and is the only option of the three that fits one PR.
Ticket: #370 / Notion Bugs — "A sent quote is rewritten in place with no version,
no re-send and no disclosure"
Reversible: yes — the notice is one render branch; the column is additive.
Precedent: yes — an outbound message that can disagree with its own link
discloses the divergence rather than silently winning or silently losing.

## 2026-08-26 — Does agent_readonly get to read the events table?
Decision: A narrowed view only — `event_name = 'voice_session_completed'` and a
fixed set of property keys, granted `select` with its own `for select to
agent_readonly` policy in a NEW migration. Not the whole table.
Rationale: `events.properties` is free-form JSONB written from ~40 `track()` call
sites, so a full grant authorises whatever any future call site puts there, which
is not something a PII review can bound. The view gets the diagnostic value that
motivated migration 44 — wrap_reason, pricing_mode, required-slot coverage — with
a surface that can actually be enumerated. Withholding it entirely was considered
and rejected: the 21 and 26 Aug voice investigations both reached probabilistic
answers on questions this data settles.
Ticket: #376 / Notion Bugs — "agent_readonly cannot reach the voice telemetry
built to diagnose voice defects"
Reversible: yes — drop the view and the grant.
Precedent: yes — the diagnostic role grows by narrowed view over named events,
never by a table-wide grant on a free-form column.

## 2026-08-26 — Pin the realtime voice model, leave transcription on its alias
Decision: `VOICE_MODEL` is pinned to `gpt-realtime-mini-2025-12-15`.
`TRANSCRIPTION_MODEL` stays the bare alias `gpt-4o-mini-transcribe`, and the file
says so in as many words rather than leaving it looking overlooked.
Rationale: `GET /v1/models` on 2026-08-26 showed exactly one reachable
`gpt-realtime-mini-*` snapshot, so pinning to it is behaviour-neutral today and
freezes what we are already served. Transcription had two reachable snapshots and
the list cannot say which the alias resolves to, so pinning it would have been a
guess that silently changes behaviour on the call where a mis-transcription has
already cost a diagnosis. Half the exposure closed with none of the guesswork.
Ticket: #374 / Notion Bugs — "The realtime voice model is an unpinned alias"
Reversible: yes — one string.
Precedent: yes — this file pins an identifier when the mapping is unambiguous and
records why it has not when it is not; an unpinned identifier must always say
NOT PINNED, which tests/regression/model-pinning.test.ts enforces.

Worth carrying forward: on 2026-08-21 this file named
`gpt-realtime-mini-2025-10-06` as documented. Five days later it was not in the
project's model list. Not proof of a repoint — /v1/models reports reachability,
not alias targets — but the landscape under the alias changed inside the window
in which the intake was reported to have got worse with no diff, which is the
failure mode the whole file exists to make visible.
## 2026-08-27 — The status-bar backdrop was covering the top bars
Decision: StatusBarBackdrop now reads --safe-top, the same token as AppHeader
and PageHeader, rather than env(safe-area-inset-top) directly.
Rationale: d0d871e deliberately kept the divergence, arguing "a content inset is
a SCROLL inset, so page content still scrolls up through it and can reach the
clock". Content scrolls to the top of the WEB VIEW, not the top of the screen,
and with ios.contentInset "always" those are 62 CSS px apart — the same 62 that
commit measured as the visible #004225 band. `fixed top-0` is already screen
y=62 in the shell, so nothing web-side can reach the clock and there was nothing
to protect. Meanwhile the 62px of opaque bg-ground sat exactly over the bars
once their padding correctly collapsed: the company-name home link at y~74-118
and PageHeader's back link at y~78-98.
Ticket: reported from device 27 Aug
Reversible: yes
Precedent: yes — anything sizing a top inset reads --safe-top. Two expressions
that can resolve differently will put one over the other on some device, and it
is invisible off-device: happy-dom does not resolve env() and no simulator
without a notch exercises it.

## 2026-08-27 — A confident comment hid the same class of defect twice
d0d871e was itself found by disbelieving a PageHeader comment that asserted the
double inset could not happen. Its own fix then shipped a comment and a test
asserting the backdrop divergence was safe, and that assertion hid this defect
for a day. Both times the prose was the reason the bug survived review.
Lesson: a comment arguing that two things may differ is a claim about runtime
geometry, and it should be replaced by a test that binds them to one token.
Reversible: n/a
Precedent: yes

## 2026-08-27 — quotes.updated_at is maintained by a trigger, not by its writers
Decision: migration 048 adds a `before update` trigger on `quotes` that stamps
`updated_at`, rather than following this repo's existing convention of setting
it in the action (`cost-actions.ts`, `settings/actions.ts`).
Rationale: four separate actions write `quotes.line_items_json` or
`quotes.total`, and the column's entire value is that it is true for every
write including ones not yet written. A guarantee that depends on each writer
remembering is what produced #370 — a post-send rewrite that the database could
not date at any access level.
Ticket: #370 / Notion Bugs — "A sent quote is rewritten in place with no
version, no re-send and no disclosure"
Reversible: yes — drop the trigger and the column.
Precedent: yes — first trigger in this schema. A later table wanting a
trustworthy `updated_at` should copy this rather than the per-writer
convention, and the two conventions now coexist deliberately.
## 2026-08-26 — Money position spec §2 verification: which of PNL-1/2/3 to write
Decision: Wrote PNL-1 (data) and PNL-2 (ui). Dropped PNL-3 — V2 found
`contractors.vat_registered boolean not null default false` (init_schema:14), so
VAT registration is already explicit and there is nothing to make explicit.
Rationale: The spec made PNL-3 conditional on V2 finding registration inferred.
It is not; the finding is recorded on PNL-1 instead, as the spec directed.
Ticket: PNL-1 / PNL-2 (Roadmap)
Reversible: yes
Precedent: no

## 2026-08-26 — Money position tickets filed Backlog, not Ready for factory
Decision: Both PNL tickets sit in Backlog until the voice-consumer decision on
PNL-1 is answered.
Rationale: `whatsLeft` has a second consumer that speaks the figure aloud
(query-actions.ts:288), which fires the spec's own V1 halt condition; and money
is on the AGENTS.md escalation list, so the factory must not pick this up
unattended.
Ticket: PNL-1 (Roadmap)
Reversible: yes
Precedent: yes — money-surface tickets land in Backlog pending a human, never
straight into the factory queue.

## 2026-08-26 — VAT on paid invoices is extracted at the wrong rate
Decision: Recorded as part of PNL-1 rather than a separate ticket; not fixed in
this session.
Rationale: `money-position-actions.ts:177` does `amount * 0.2` on a figure that
`computeQuoteTotals` makes VAT-inclusive (`total = subtotal + vat`), overstating
the set-aside by 20% for every VAT-registered trade. Migration 035 already does
the correct `/1.2` extraction for fees, so the repo contains both conventions.
It shares PNL-1's file and test fixtures, so splitting it would collide.
Ticket: PNL-1 (Roadmap)
Reversible: yes
Precedent: no

## 2026-08-26 — Money position: both open decisions resolved
Decision: (a) The voice "What's left?" answer changes with the card and the
spoken sentence names what came off — filed as PNL-4 (voice). (b) The card
shows a second, forward-looking total — folded into PNL-1 (compute) and PNL-2
(render).
Rationale: A spoken money figure gets no second look, so it is the worse of the
two surfaces to leave over-stated. The forward-looking total was the spec's own
§7 open question, defaulted to "do not build"; the owner reversed it.
Ticket: PNL-1 / PNL-2 / PNL-4 (Roadmap)
Reversible: yes
Precedent: no

## 2026-08-26 — The spec's forward-looking worked example is wrong; ticket
##              specifies different arithmetic
Decision: The projection is `safeToSpend + owedNet − unpaidCostsNet −
feesOnOwed`, where net means VAT-extracted when registered. On the spec's own
fixture that is £299.20, not the £339.20 the spec shows.
Rationale: £99.20 + £240.00 adds a gross owed figure to a total that has
already had VAT removed — £40 of that £240 is HMRC's. Under cash accounting an
owed invoice landing nets to +net and an unpaid cost being paid nets to −net,
because the VAT on each cancels against the set-aside.
Ticket: PNL-1 (Roadmap)
Reversible: yes
Precedent: yes — every money figure on this card is reckoned net of what is not
the trade's, on a cash basis.

## 2026-08-26 — PNL-2 and PNL-4 held in Backlog behind PNL-1
Decision: Only PNL-1 goes to Ready for factory now. PNL-2 and PNL-4 carry a
wake condition of "PNL-1 merged to main".
Rationale: Both consume types PNL-1 creates, and AGENTS.md forbids building a
placeholder for an unmerged dependency. Queueing all three concurrently is the
same shape as the #351/#356 collision that broke main earlier today — two green
branches, one red trunk.
Ticket: PNL-1 / PNL-2 / PNL-4 (Roadmap)
Reversible: yes
Precedent: yes — dependent tickets wait on the merge, not on the ticket being
written.

## 2026-08-26 — "Get the app" links to motko.co.uk, not the App Store
Decision: The post-signup step is a /get-the-app route whose primary action
links to https://motko.co.uk, which carries the real listing button.
Rationale: tests/regression/app-store-link.test.ts enforces two repo-wide scans
over src/ — no `apps.apple.com` literal, and no caller of resolveAppStoreHref —
so this app cannot link to the App Store by any permitted route. site/index.html
is the single owner of that URL. Reading the env var directly to dodge the
literal scan would be circumvention and is explicitly forbidden on the card.
Ticket: #355
Reversible: yes
Precedent: yes — the App Store URL has exactly one owner, and app-side code
routes through the marketing site rather than acquiring a second copy.

## 2026-08-26 — CAPABILITY FAULT: could not verify motko.co.uk is live
Could not reach https://motko.co.uk from the session — the agent proxy refused
the CONNECT (403, policy denial), and retrying hit the same policy. site/README.md
still describes the deployment in the future tense, so whether it is live is
unknown rather than assumed. Recorded as a blocking precondition at the top of
#355 instead of being treated as satisfied.
Ticket: #355

## 2026-08-26 — Amended two frozen acceptance tests, with owner authorisation
Decision: Amended the frozen contract in each branch's FIRST commit — the only
commit permitted to touch tests/acceptance — rather than re-deriving either item.
Three defects, all in PM-committed acceptance tests:
  1. #364: tests/acceptance/265.test.tsx typed a literal as
     Awaited<ReturnType<typeof getMoneyPosition>>, pinning MoneyPosition's exact
     shape. Required safeToSpend/projection broke it; optional ones would have
     broken 364.test.ts:166, which reads position.safeToSpend.motkoFees with no
     optional chaining. No shape satisfied both. Added both objects to 265's
     literal; nothing it asserts changed.
  2. #365: the signUp mock inferred `session: null` from its default, so every
     mockResolvedValueOnce supplying a session was a type error. Return type now
     declared. This is the trap AGENTS.md already names.
  3. #365: the referral fixture used "TEST123" — seven characters, and a "1"
     that REFERRAL_CODE_ALPHABET excludes. normalizeReferralCode returns null,
     so three assertions were unsatisfiable; the last also required an
     unparseable code to reach signup metadata, which
     signup-referral-field.test.tsx forbids. Two frozen contracts contradicting
     each other. Now "TEST23".
Rationale: Each fix preserves what the test was checking. (1) and (2) are
repairs of form, not substance. (3) changes an asserted value, which is why it
was put to the owner rather than taken.
Ticket: #364 / #365
Reversible: yes
Precedent: yes — a frozen test that no implementation can satisfy is a dead
contract, and the remedy is an amendment to the first commit with the owner's
say-so, not a silent downstream repair and not automatically a re-derivation.

## 2026-08-26 — Setting a blocked item's Notion row to "Ready for factory" duplicates its issue
scripts/factory/resume.sh says plainly: "Notion is not touched here and must
not be. Setting a blocked item's roadmap row back to 'Ready for factory' makes
the poller create a SECOND issue for it, orphaning the original." Moving #355's
row is what produced #365 alongside it. #355 is closed as a duplicate; #365
carries the history. Resume by label or workflow_dispatch, never by the row.
Ticket: #355 / #365
Reversible: n/a — recorded so it is not repeated
Precedent: yes

## 2026-08-26 — PNL-1's own ticket introduced a 100x VAT error; QA caught it
What happened: the ticket told the Engineer to replace the VAT extraction with
`vatAmount: splitFeeVat(Math.round(inv.amount * 100)).vatPennies`. That returns
PENCE into PaidInvoiceForVAT.vatAmount, which money-position-math.ts:28
documents as POUNDS and computeVATPosition:166 multiplies by 100. The ticket was
fixing a 20% overstatement and shipped a 100x one in its place.
Caught by: QA, twice (cycles 1 and 2), on a value no acceptance test asserts.
Fixed in c8c2f56 as `vatPennies / 100`, which round-trips exactly for integer
pence. QA passed on cycle 3.
Lesson: the ticket specified BOTH the helper and the call site, and the call
site crossed a documented unit boundary the ticket never checked. Naming a
helper is not the same as checking what the receiving type expects. The
acceptance criteria I wrote asserted on safeToSpend.vatToSetAside and never on
position.vat, so the full suite passed 2711 against the bug — a local green run
is not evidence for a value nothing asserts.
Ticket: #364
Reversible: yes — already fixed before merge
Precedent: yes — when a ticket hands the Engineer a code snippet, the snippet's
units must be checked against the receiving type's documented units, and the
acceptance criteria must assert on every value the change touches.

## 2026-08-26 — loading.tsx is a registry entry, not scope creep
Decision: Restored src/app/get-the-app/loading.tsx after QA had the Engineer
delete it, and declared it in the spec's Files list.
Rationale: tests/acceptance/200.test.tsx walks every route directory under
src/app/, treats anything off its public-route allowlist as authenticated, and
requires a loading.tsx in each. Deleting it failed that frozen test. Adding one
is the registry's intended registration path — registration, not repair. The
alternative, adding get-the-app to the public-route allowlist, is the move
AGENTS.md forbids by name: a route that stops being seen is worse than one that
fails the check.
Ticket: #365
Reversible: yes
Precedent: yes — a new authenticated route always ships its loading.tsx, and a
reviewer calling that scope creep is wrong.

## 2026-08-26 — mockNativePlatform could not drive isNativeApp
Decision: tests/helpers/capacitor.ts is in scope for #365 and now sets
window.Capacitor.
Rationale: platform.ts reads window.Capacitor directly and never imports
@capacitor/core, while mockNativePlatform only set state feeding the
@capacitor/core mock — the helper had no reference to `window` at all. So the
mandated helper could not drive the app's actual platform check, and any frozen
test using it for native-vs-web branching was unsatisfiable. QA's suggested fix
(set window.Capacitor inside the test) contradicts AGENTS.md, which requires all
Capacitor mocking to go through the shared helper.
Ticket: #365
Reversible: yes
Precedent: yes — when a mandated test helper cannot drive the code path it
names, extending the helper is the fix, not working around it per-test.

## 2026-08-26 — Two of my own tickets specified a seam without checking it
Both PNL-1 and #365 named two correct facts and never verified they met:
PNL-1 gave a snippet returning pence into a field documented as pounds; #365
paired "isNativeApp() checks window.Capacitor" with "use mockNativePlatform"
when the latter does not touch window. Each produced a defect no local green run
caught, because the acceptance criteria I wrote asserted on neither seam.
Lesson: when a ticket hands the Engineer both a producer and a consumer, the
units and the mechanism at the boundary between them are the thing to check,
and an acceptance criterion must assert across it.
Ticket: #364 / #365
Reversible: n/a — recorded so it is not repeated
Precedent: yes

## 2026-08-28 — PNL-4 blocked with no readable evidence: re-run, or fix the blindness first?
Decision: Both, in that order — fix the PM step so the vitest output is
published, then re-run the PM for #403. The step's `::unreadable-log::` path now
tails `/tmp/acceptance.log` into the job log and quotes it in the blocking
comment, and the two verdicts get their own recommendation instead of sharing
one.
Rationale: nothing is pushed on that path by design, so the acceptance file dies
with the runner and the job log is the only evidence that outlives it — and for
the one verdict meaning "I could not read this run", none was published. #403's
root cause is unrecoverable as a result. Re-running first would have gambled the
same cycle blind and, if it recurred, left us exactly as blind the second time.
Ticket: #403
Reversible: yes.
Precedent: yes — a guard that blocks on an outcome it could not classify
publishes the raw evidence, because its verdict is by definition not evidence.

## 2026-08-27 — REVERTS the sent-quote disclosure (#370/#387); migration 048 never landed
Decision: reverted #387 from `main`. The code shipped; the migration did not.
`select sent_total from quotes` on production returns `42703: column
"sent_total" does not exist`, so every `quotes` select naming it was rejected.
Rationale: the job page and the public quote page both destructure only `data`
from that select, so a rejected query became `null` rather than an error — the
job page rendered "Your quote is on its way — refresh in a moment" beside a
"Quote ready" badge, and `/q/[id]` called `notFound()`, 404ing every customer
quote link. Reverting restores both immediately and is entirely in our hands;
re-running `supabase db push` is not, and it silently did not take once already.
Ticket: #370 / #387
Reversible: yes — re-land #387 once the columns are verified ON PRODUCTION, not
in the ledger.
Precedent: yes — "schema precedes code" is not satisfied by someone reporting
that they ran the push. It is satisfied by reading the column back off
production. #390 exists because nothing automated does that, and this is the
first time the gap cost a live outage.

## 2026-08-28 — A static schema check reports pre-existing drift rather than blocking on it
Decision: `schema-in-tree` fails a PR only on drift in files that PR changed;
drift already on `main` is reported as a warning on every run.
Rationale: the check found twelve real drifts on `main` the first time it ran —
`jobs.customer_name`, `jobs.job_reference`, `jobs.quote_id`, `jobs.description`,
`jobs.updated_at`, `invoices.vat_amount`, and `contractors.mandate_id` /
`mandate_status` (which is `fee_mandate_*` everywhere else in the repo, in a
fee-recovery path that throws). Blocking on all twelve means the check never
lands, and a check that never lands catches nothing.
Ticket: #409
Reversible: yes — flip existing findings to errors once the backlog is worked off.
Precedent: yes — a new repo-wide check lands blocking on what a PR introduces
and warning on what it inherits. The same split `schema-drift-probe` already uses.

## 2026-08-28 — The statement of work carries no pricing at all
Decision: The SoW is the scope document and shows no money. The quote is the
priced document. Its "Additional work" section renders the work and never a
figure; where a stated price exists for one of those items it appears on the
quote, as a line, at that figure.
Rationale: the reviewed SoW half-exposed pricing — unit prices with no
quantities, on a document that otherwise carries no totals, so 2 × £85 never
resolved to £170 and the customer saw numbers they could not reconcile to
anything. Of the three options (full reconciled breakdown, none, or the current
half) the half is the worst, and a second priced document is a second place for
the two to disagree, which is the defect class this whole review exists to close.
Ticket: quote-flow defect review §5 S5
Reversible: yes
Precedent: yes — one document owns money. Any later item proposing to put a
figure on the SoW, the contract's scope section, or an emailed summary inherits
this and should be read against it.

## 2026-08-28 — Materials responsibility is derived, never re-asked
Decision: The contract's `materials_by` derives from
`extracted_json.materials_supply`, the same captured field the quote and SoW
render from. It stays editable; it no longer starts empty.
Rationale: one captured answer was producing up to three statements, and on the
reviewed job one of them was inverted — the SoW told the customer they were
supplying materials the tradesperson had already said he would buy. A field the
app holds must never be re-asked as free text next to a document that already
states the answer.
Ticket: quote-flow defect review §4 M1
Reversible: yes
Precedent: yes — the same rule that put the client address and phone into the
contract form (#411). A captured value is prefilled, not re-requested.

## 2026-08-28 — Invoicing before completion is permitted
Decision: Jacob, asked "is invoicing before completion ever permitted?", answered
that it is not a no. So:
  - A **Final** invoice is never available before work is marked complete. Both
    options in the review's D10 agreed on this, and it is the one that matters:
    demanding the full amount before work has started is the pattern consumers
    are warned about.
  - A **Deposit** or **Materials** invoice IS available before completion.
  - Before the contract is signed, that is a warning and a confirmation rather
    than a hard block, and the invoice type is forced away from Final.
Rationale: "not no" rules out the blanket prohibition, and the softer option in
the review is the one that survives it. Some trades genuinely bill up front on
materials-heavy jobs, and a hard block reads as the software telling them how to
run their business. The scam-shaped failure is the FULL amount up front, and
that stays blocked.
Ticket: quote-flow defect review §7 / D10
Reversible: yes
Precedent: yes — the shape is "warn and confirm on the judgement call, block only
the thing that cannot be defended". Later gating items should copy that split
rather than reaching for a block first.
⚠️ If the intent was the review's stricter recommendation — no invoice at all
until the contract is signed — say so and it is a one-line change to the gate.

## 2026-08-28 — agent_readonly gets a table-wide grant on events, superseding the 26 Aug narrow view
Decision: Jacob, 28 Aug: "I'm happy for the broader grant to be made." This
SUPERSEDES the 26 Aug Q2 decision recorded above, which chose a view over
`events` filtered to `event_name = 'voice_session_completed'` with an enumerated
set of property keys. Grant `select` on `events` to `agent_readonly` directly.
Rationale: the narrow view's cost is that every future diagnostic question needs
a new migration to see a new event, and the 21 and 26 Aug investigations both
reached probabilistic answers for want of data that existed. The decision owner
has weighed the wider surface and accepted it.
Ticket: #376
Reversible: yes — `revoke select on events from agent_readonly` in a follow-up.
Precedent: yes, and it reverses one. The 26 Aug entry stays where it is rather
than being edited: a superseded decision with its reasoning intact is worth more
than a tidy record, and anyone reading the two together can see what changed and
why.

⚠️ Two things this does NOT authorise, both because this repository is PUBLIC
(`private: false`, verified 28 Aug — and vitest.config.ts already records that
Actions logs are world-readable):
  1. It is still `select` and nothing else. `agent_readonly` stays a select-only
     role; the broader grant widens WHAT it reads, not what it can do.
  2. It is NOT a licence to hand sessions `SUPABASE_READONLY_KEY`. That pair is
     a service-role credential, which bypasses RLS and is write-capable — a
     different kind of thing from a wider read grant, and the one credential
     this repo's own config says must not be in every pull-request run.
`events.properties` is free-form JSONB written from ~40 `track()` call sites, so
this grant covers whatever any future call site puts there. The PII notice in the
new migration must say so plainly.

## 2026-08-28 — Does schema-in-tree block on a file a PR touched, or a line it wrote?
Decision: On the line. A finding is an error only when the PR wrote a line inside
the select that names the column; anything else is a warning, including drift
elsewhere in a file the PR edited.
Rationale: #409 already set the precedent as "blocking on what a PR introduces
and warning on what it inherits" — file scope was neither, and it made each of
the twelve known drifts a landmine under whichever file carries it. #403 was
blocked by `jobs.description` at query-actions.ts:199 after an edit seventy
lines away, with no fix available inside the item's scope.
Ticket: #403
Reversible: yes
Precedent: yes

Scope is the whole select, not its opening line. `referencesInSource` reports
every column at the line the `.select(` opens on, so testing that one line would
let a column added on line four of a five-line select read as inherited drift —
which is the exact edit this check exists to refuse. The bias is deliberate: a
select the PR partly rewrote is the PR's.

## 2026-08-28 — Does `previewed` satisfy the sequencing gate, or must the predecessor merge?
Decision: Merge. `SATISFIED_LABELS` drops `previewed` and keeps `shipped`, which
factory-ship.yml applies at merge; a closed predecessor still counts, since
merging closes the issue.
Rationale: `previewed` means QA passed and the PR is ready — not that the work
is on `main`, and `main` is the only thing the successor's PM can see. PRICE-2
proved it the same day the gate was extended to PRICE: PRICE-1 hit `previewed`
at 20:49 with its PR open, PRICE-2 was admitted, its PM specced at 20:57 against
a main that got PRICE-1 at 21:03, and its Engineer created
src/lib/voice/stated-prices.ts from scratch — add/add conflict with the file
PRICE-1 had already written. That is LED-1 and LED-2 both creating job_costs,
through a different door.
Ticket: #424
Reversible: yes
Precedent: yes — "satisfied" for any cross-item gate means the dependency is on
main, not that someone has approved it.

The cost is real and accepted: a programme is now serialised on merges rather
than on reviews, so a predecessor sitting in an open PR holds its successor. An
item that is genuinely independent should not carry a sequenced prefix.

## 2026-08-28 — Is a cancelled CI run a red gate?
Decision: No. A cancellation is the ABSENCE of a verdict, not a negative one.
`scripts/factory/gate-verdict.mjs` classifies a run as green / red / pending /
superseded / no-verdict, and the Engineer and QA gates act on that rather than
on "conclusion != success".
Rationale: #283. A concurrency group cancels a superseded run the moment a newer
commit lands — its intended behaviour — so any branch taking two pushes close
together produced a block reading "CI is red" when every check had passed on the
head that mattered. That is intervention cost with no signal behind it, plus a
misleading account for anyone skimming.
Ticket: #283
Reversible: yes
Precedent: yes — the shape is "a guard must distinguish hearing 'no' from not
hearing". #273 and #277 are named in #283 as the same family, and the next guard
reading a status field should copy this split rather than treating every
non-success value as a failure.

Two things it deliberately does NOT do. It never turns an unknown conclusion
into a pass — anything the file does not model is `no-verdict`, which still
stops the item, with a message saying to teach the classifier rather than to go
looking for a bug. And a cancelled run sitting beside a genuine failure is still
a failure: decisive outranks indecisive, in both directions.

A `superseded` verdict (the head moved past the commit under test) exits without
blocking, because no run will ever arrive for that sha and the newer head gets
its own gate. That is the #257 case exactly.

## 2026-08-28 — Should the PM typecheck its acceptance tests, given the lint step deliberately does not?
Decision: Yes, with TS2307 ("Cannot find module") dropped.
`scripts/factory/check-acceptance-types.sh` runs after the lint step and blocks
the item on any other type error.
Rationale: the lint step's reasoning for skipping typecheck is right — a correct
acceptance test imports the module the Engineer is about to create, and #152 was
blocked for exactly that. But its stated remedy, that genuine type errors
"surface at the gate … and are corrected by amending the branch's first commit",
is manual: amending rewrites history and nothing in this pipeline force-pushes.
So each one costs a full re-derivation. #403's acceptance file ran GREEN on 22
tests and still could not merge, on `vi.fn(async () => …)` inferring a
zero-argument function — a trap AGENTS.md names, that eslint cannot see and
vitest does not care about because the extra argument is ignored at runtime.
Ticket: #403
Reversible: yes
Precedent: yes — a spec-time check may drop the diagnostics that the
failing-first contract requires, and only those. Dropping TS2307 loses nothing:
an unresolved specifier that is not a file the spec declares it is creating is
already check-acceptance-run.sh's question.

The script takes an optional tsc-log path, like check-acceptance-run.sh, so the
rule is exercisable by fixture in under a second rather than only by a
twenty-second compile of the whole tree.

## 2026-08-29 — Which type errors may block a PM's acceptance test
Decision: the PM typecheck reports an allowlist of one diagnostic (TS2554 arity
on a mock the test declared), not a denylist of everything bar unresolved imports.
Rationale: a correct failing-first test describes absent code and can produce
almost any diagnostic; the check blocked #403 three times on correct assertions.
Ticket: #403
Reversible: yes
Precedent: yes

## 2026-08-29 — How acceptance-test mock signatures must be written
Decision: every mock parameter is declared optional (`vi.fn((_id?: string) => …)`),
and a stub client is cast once where it is returned, with its mocks returned beside it.
Rationale: a required parameter and a bare vi.fn() are both TS2554 in opposite
directions, invisible to vitest; #403 and #438 each lost a cycle, one to each form.
Ticket: #438
Reversible: yes
Precedent: yes

## 2026-08-30 — Do unsourced lines get different customer-facing copy from unpriced ones?
Decision: no. Reuse UNPRICED_AMOUNT_LABEL / UNPRICED_LINE_NOTE unchanged; the
"(modify)" annotation on src/lib/unpriced-quote-copy.ts in #443's spec is stale.
Rationale: the card puts "showing provenance to the customer" out of scope, so
distinguishing the two in customer copy would leak exactly what it forbids.
Ticket: #443
Reversible: yes
Precedent: yes

## 2026-08-30 — A Notion write-back must survive a card body being edited
Decision: resolve the roadmap page id from the poller's HTML-comment marker OR,
failing that, the visible "**Source:**" link, via scripts/factory/notion-page-id.sh.
Rationale: editing a card body is routine and silently drops the invisible marker,
after which Notion is wrong for ever; #403/#436/#438/#443 all shipped with stale rows.
Ticket: #443
Reversible: yes
Precedent: yes

## 2026-08-30 — Where does the job P&L's VAT figure come from?
Decision: nowhere, for now — drop the VAT section from the per-job P&L entirely.
Rationale: invoices carry no VAT column and nothing derives one, so vatCollected
cannot be computed; job_costs.vat_amount alone would read as reclaimable and mislead.
Ticket: #457
Reversible: yes
Precedent: no

## 2026-08-30 — What should hasCancelledMandate do?
Decision: Delete it. No rename, no replacement in this change.
Rationale: It selected contractors.mandate_id/mandate_status, which do not exist
(the columns are fee_mandate_*), and threw — taking the uncollectable-fees report
down. Renaming would not have helped: 'cancelled' is not in fee_mandate_status's
check constraint, so the flag would be permanently false. TrueLayer mandates went
with PAY-5. A Stripe-era equivalent is its own item.
Ticket: #460
Reversible: yes
Precedent: no
## 2026-08-29 — agent_readonly is provisioned, and verified against production
Not a decision — a fact worth recording, because its absence is what #376 was.
Jacob ran `alter role agent_readonly with login password '…'` on 29 Aug and
confirmed the state directly on production:

  rolcanlogin        true
  has_password       true
  select granted on  contracts, events, invoices, jobs, quotes — and nothing
                     else in `public`
  insert/update/delete on public.jobs   all false

Why this is written down: migration 44 says the login half is "provisioned out
of band by a human … and the value goes into the factory's secret store, never
into this file", and nothing then records whether it happened. #376 spent its
whole life establishing that it had not, by inference from the absence of a
connection string anywhere in the repo. Four investigations — 21 Aug, 26 Aug and
two on 28 Aug — reached probabilistic answers for want of data this role reaches.
The next one should be able to read this instead of re-deriving it.

Two things confirmed here that were previously only asserted by the migrations:
  * Migration 053's DDL genuinely landed. A ticked `supabase migration list` is
    not proof — a ghost apply from `migration repair` records a version whose
    statements never ran — so `events` appearing in the granted set is the real
    confirmation, and it is the check CLAUDE.md asks for.
  * `alter default privileges … revoke all` still holds. contractors, customers,
    team_members, rate_cards, push_subscriptions and knowledge_chunks are all
    absent from the granted set, so the withheld surface is withheld in fact and
    not just by intent.

The credential itself is NOT here and must never be. No password, no connection
string, in this file or any other in this repository — it is public.

## The blocker is the network policy, not the credential — 30 Aug 2026

Written when this entry was: "still outstanding … the connection string
reaching a session". That was wrong, and it is the fifth time this ground has
been re-covered, so the finding is recorded here rather than left to a sixth.

Jacob provisioned a password and supplied a connection string on 30 Aug. It
still could not be used, and the reason is not the secret:

  outbound :443            open
  outbound :5432 / :6543   BLOCKED
  DNS for *.supabase.co    resolves fine
  db.<project-ref>.supabase.co   does not resolve at all — Supabase has
                                 retired direct IPv4; the pooler host is the
                                 only route, and its port is blocked too

So an agent session cannot open a Postgres connection whatever credential it
holds. #376's criterion 1 is unmeetable as the environment stands, and no
amount of secret-store plumbing changes that.

The agent proxy WILL open a CONNECT tunnel to 5432 — verified, it returns
`200 Connection Established` — so a local bridge would technically work. Do not
build one. Tunnelling a database connection past a network policy is
indistinguishable from evading it, the sandbox classifier blocks it correctly,
and the right fix is the environment's network policy, chosen per-environment
at claude.ai/code.

**What works today, and has twice been decisive:** Jacob runs the query and
pastes the result. On 30 Aug one `information_schema` query settled all eight
of #409's schema drifts — the good way, in that nothing had landed outside the
tree — and turned a report nobody could act on into three factory tickets. A
second confirmed `jobs.work_completed_at` on production and cleared #419's
migration gate. That round trip costs a minute and is the standing workaround
until the policy changes.

Note also that `docs/bug-review-2026-08-26.md`'s inference — "nothing in the
repo references a connection string, therefore the role was never provisioned"
— was correct about the role and wrong about the cause of the blockage. The
role was fine. The port was not.

## 2026-08-30 — What should the Deploy Health Check gate?
Decision: Nothing. `promote-to-production` is deleted; the health check becomes a
smoke test on the factory preview, dispatched by the deploy workflow with the URL
it already resolved.
Rationale: The job never ran once — both triggers resolved `heads/main` and asked
for a Preview deployment on it, which does not exist — and the day it ran would
have aliased motko.app to an unmerged factory branch. Production already deploys
from main via Vercel.
Ticket: #462
Reversible: yes
Precedent: yes

## 2026-08-30 — Should a dependency hold count against the admission ceiling?
Decision: No. The admission gate labels it `awaiting-dependency` alongside
`blocked`, and the poller's ceiling subtracts those.
Rationale: The ceiling budgets human attention — its own comment says every
stopped item waits on the same person. A dependency hold waits on a ticket, and
counting it deadlocked FEE-8 against FEE-6/FEE-7: the item was holding the door
shut against its own dependencies.
Ticket: #467
## 2026-08-30 — How should the QA cap identify a criterion?
Decision: It should not try. A key on a fixed catch-all list is counted within
its cycle and never across cycles, so an item keyed entirely in catch-alls stops
at the runaway ceiling instead of the criterion cap.
Rationale: The identity is not in what QA emitted — #258's two findings cite the
same file, so category-plus-path does not part them and matching prose is a
heuristic that fails both ways. A false stop costs a human; stopping five cycles
later still stops.
Ticket: #273
Reversible: yes
Precedent: yes

## 2026-08-31 — How is a frozen assertion retired when a later item supersedes it?
Decision: The superseding item's FIRST commit retires the superseded assertions
and only those, under four conditions: the card names each one, the commit
message names each one and the decision behind it, neighbouring assertions
survive, and a failure the card does not name is a defect rather than a
retirement candidate.
Rationale: 15 assertions across three shipped items pin band-era prices — one is
literally "motkoFeePennies returns correct fee for various inputs" — so no
reprice can pass them. The first commit is the only one the immutability gate
permits near tests/acceptance/, so it is the sole available mechanism.
Ticket: #476
Reversible: yes
Precedent: yes

## 2026-08-31 — Is the money projection's fee-on-gross FEE-6's to fix?
Decision: No. `src/app/jobs/money-position-actions.ts` is out of scope for
FEE-6 and is tracked as FEE-12. The four `tests/acceptance/364.test.ts`
assertions its fix would break are NOT retirement candidates and stay live.
Rationale: `feesOnOwed` is typed "estimated" — a dashboard projection, not a
charge — so the "no call site charges on gross" criterion binds the two paths
that take money, not this one. Extending the retirement list to cover it would
have breached condition 4, and the projection is on gross today either way.
Ticket: #476
Reversible: yes
Precedent: yes

## 2026-08-31 — How does a re-derivation learn from the previous attempt?
Decision: Guidance posted to a factory item states the requirement from
`main`, never as a diff against a branch. An `ANSWER:` comment saying "the
retirements in <sha> were correct, keep them" is wrong by construction.
Rationale: Every derivation starts from `main`, where nothing is retired, and
the PM cannot see the discarded branch. Derivation 6 of #476 retired nothing
because it read that phrasing as "already done" — the guidance caused the
failure it was written to prevent.
Ticket: #476
Reversible: yes
Precedent: yes

## 2026-08-31 — How is a PART payment converted to net for the fee ladder?
Decision: Pro-rata by the quote's own VAT ratio —
`netTaken = round(paymentPennies * (quote.subtotal / quote.total))`.
Rationale: The ratio is read from the quote rather than assumed, so it is
correct for standard-rated, reduced-rate, zero-rated and domestic reverse
charge alike. This is not the forbidden divide-by-1.2, which assumes a rate.
For an unregistered contractor subtotal equals total, so it is a no-op.
Ticket: #476
Reversible: yes
Precedent: yes

## 2026-08-31 — quotes has no subtotal column; the fee base is computed
Decision: The net fee base is `computeQuoteTotals(line_items_json,
vat_registered).subtotal`. Never `quotes.total` or `quotes.sent_total`, which
are VAT-inclusive, and never a select of `quotes.subtotal`, which does not
exist.
Rationale: Verified against production 31 Aug — `public.quotes` holds
`line_items_json`, `total` and `sent_total` only. FEE-6's card said "read it
from the quote's stored subtotal", which would have produced a phantom-column
select, the defect class #464 removed. Card corrected.
Ticket: #476
Reversible: no
Precedent: yes

## 2026-08-31 — Reconciling AGENTS.md with the Supabase MCP's actual reach
Decision: Run the MCP in read-only mode and rewrite the Database access section
to match: all of `public` readable, writes refused at the connector, the
`agent_readonly` role documented separately as the narrower path it still is.
Rationale: The doc claimed four tables and "write access is absent by
construction" while the connector reached 28 and exposed apply_migration —
false in both halves, and every factory agent reads that file as ground truth.
Read-only mode keeps the safety property mechanical rather than voluntary, while
keeping the wider read access that found settle_fee_collection. Handling rules
are tightened, since the PII surface is now larger.
Ticket: Notion Bugs — AGENTS.md database access posture (31 Aug 2026)

## 2026-08-31 — Where does the supervisor read halts, QA rejections and preview status from?
Decision: From GitHub, not from Notion comments. A halt is a stopped label
(`blocked`, `qa-disputed`, `spec-dispute`, `reconciler-escalated`) plus a
`## DECISION NEEDED` comment; a QA rejection is a `qa-changes` label event;
preview status comes from GitHub Deployments. Notion supplies name, status,
module and preview URL only.
Rationale: The supervisor spec hypothesised a Notion convention and its own §4
made that a check. The code says otherwise — Notion's Status is written back
FROM the labels by factory-notion-status.yml, so it is a mirror, and reading a
mirror as an independent signal double-counts a lag as a change.
Ticket: factory-supervisor
Reversible: yes
Precedent: yes

## 2026-08-31 — Where does the supervisor get `status_since`, given Notion exposes no property history?
Decision: The GitHub label event that produced the current status, else carried
forward from the previous snapshot when the status is unchanged, else the
current run's `taken_at`. Never `last_edited_time`.
Rationale: The label events ARE the status-change history, since Notion's Status
is derived from them. `last_edited_time` is explicitly forbidden because every
unrelated edit would reset staleness, which turns all four thresholds into ones
that never fire on the tickets most likely to be edited.
Ticket: factory-supervisor
Reversible: yes
Precedent: yes

## 2026-08-31 — What does the supervisor do with a duplicate ticket, given the board has no closed state?
Decision: Flag it in the digest; never close it. No status change is made.
Rationale: §7 rules out writing `Shipped` explicitly and correctly — it would
put a thing that was never built into the shipped column and out of every count
— and every one of the seven values the factory writes means the ticket is live
somewhere. §7's own fallback is "if in doubt, flag, don't close", and its
precondition (a closed state exists) is absent. If one is added later, the close
path is a small change in actions-core.ts and a new record here.
Ticket: factory-supervisor
Reversible: yes
Precedent: no

## 2026-08-31 — Does the supervisor's first run emit a digest?
Decision: No. With no previous snapshot the diff returns empty, so the first run
establishes the baseline silently and the second is the first that can report.
Rationale: Otherwise the first digest names the entire board — every ticket is
technically new and every threshold technically just crossed — and the one
person reading it learns on day one that the digest is noise. The spec's success
measure is zero digests on hours with no change; a board-sized first digest is
the worst possible violation of it.
Ticket: factory-supervisor
Reversible: yes
Precedent: no

## 2026-08-31 — Should the supervisor watch production, or only the factory?
Decision: It reads the live-checks lane (`rls-check.yml`) alongside `main` CI,
reports both under `Broken`, and treats 48h without a completed run as stale
rather than as green.
Rationale: Every other signal it reads is factory-internal — tickets, previews,
halts — so a production regression touching no ticket was invisible to it. A
SECURITY DEFINER function callable by `anon` had been live for weeks with every
gate green. An absent check result is not a passing one.
Ticket: factory-supervisor
## 2026-08-31 — Which branches should cross-branch-collisions compare against?
Decision: All unmerged remote branches, minus `archive/*` (parked by
convention) and `factory-state` (an orphan branch with no merge base). Not
`factory/*` only.
Rationale: On 31 Aug `factory/475` and `claude/public-surface-migrations` both
claimed migration 00000000000054 and both CI runs passed — the check fetched
and listed `origin/factory/*` only, so neither could see the other. The
migration-version rule worked perfectly and was pointed at a third of the
problem. Work reaches main from more than one kind of branch.
Ticket: none — found during the 31 Aug PR review
Reversible: yes
Precedent: yes

## 2026-08-31 — What stops a database object reaching production unnoticed?
Decision: Two live checks in the rls-check.yml lane — no SECURITY DEFINER
function callable by anon/authenticated/PUBLIC unless allowlisted with a reason
and a ticket, and production's public schema must match a manifest committed in
the tree.
Rationale: Every gate validates the tree against itself; only this lane looks
outward, and it checked tables. settle_fee_collection was live for weeks —
SECURITY DEFINER, anon-callable, in no migration — with everything green. The
migration ledger cannot catch it: it records which files ran, not what is in the
database.
Ticket: Notion Bugs — settle_fee_collection (31 Aug 2026)
Reversible: yes
Precedent: yes

## 2026-08-31 — Revoke or drop settle_fee_collection?
Decision: Revoke EXECUTE from anon, authenticated and PUBLIC, pin its
search_path, and leave the function in place. Same for check_public_tables_rls.
Rationale: Revoke closes the hole completely, changes nothing for the service
role, and reverses in one statement; drop is the tidier end state but is not
reversible and no caller inventory outside this repository exists yet. The
allowlist is emptied rather than carrying either as an accepted exposure.
Ticket: Notion Bugs — settle_fee_collection (31 Aug 2026)
Reversible: yes
Precedent: yes

## 2026-08-31 — A quote sent before a reprice, paid after it
Decision: The fee in force on the PAYMENT date applies. No grandfathering by
quote date.
Rationale: FEE-9's card already records "applies to all contractors immediately";
this carries that through to the one ambiguous case, and it is what the code
does — the fee is computed at settlement and nothing stores the fee in force
when the quote was sent. Published on /pricing rather than left implicit.
Ticket: #468
Reversible: yes
Precedent: no

## 2026-08-31 — FEE-9 publishes the £2 waiver cap that FEE-11 will remove
Decision: /pricing and the in-app copy state the base-band waiver cap, because
`planPaidJobSettlement` still applies it. FEE-9's card says the caveat "is
gone"; it is not gone until FEE-11 merges.
Rationale: FEE-9's own governing constraint is that the site must never state a
price the app does not display. Following the card literally would have
republished a false promise one ticket after withdrawing one. A regression test
pins the copy to the settlement behaviour, so FEE-11 must change both together.
Ticket: #468, unblocks with #466
Reversible: yes
Precedent: yes — copy that quotes a number is pinned to the function that
computes it, not to the card that describes it.

## 2026-08-31 — The banked referral-credit cap is omitted from /pricing
Decision: FEE-9 does not publish a cap on banked referral credits. It lands with
FEE-11, which sets the number.
Rationale: FEE-11 proposes 10 but records it as unconfirmed, and its PR (#469)
is open. Publishing an unconfirmed figure risks the site being wrong the day
FEE-11 lands with a different one.
Ticket: #468, blocked on #466
Reversible: yes
Precedent: no

## 2026-08-31 — /terms is a public route
Decision: The contractor terms page is unauthenticated, registered in
`isPublicRoute` and in `tests/acceptance/200.test.tsx`'s public-prefix registry.
Rationale: Terms a contractor can only read once signed in are terms they cannot
consult before signing up, and the fee clauses are exactly what someone decides
on. Same class as /privacy and /support: static copy, reads no table, carries no
PII. Flagged rather than assumed — a new unauthenticated surface is a human's to
see.
Ticket: #477
Reversible: yes
Precedent: no

## 2026-08-31 — FEE-10's ledger half needs its own PR
Decision: The reversed-settlement COLUMN and its migration are not in this
branch. The rules, the clause and the statement/PNL behaviour are.
Rationale: ci.yml refuses a PR carrying a migration while schema-drift-probe's
credentials are unset, and SUPABASE_READONLY_URL / SUPABASE_READONLY_KEY are
still unset — the same reason the live-checks lane is red. Splitting matches the
#486/#484 precedent. The pure planner is written so the migration PR wires a
column to a decision that is already made and tested.
Ticket: #477
Reversible: yes
Precedent: no

## 2026-08-31 — FEE-7 dropped; motko absorbs Stripe's processing cost
Decision: FEE-7 (#475) is closed as not planned, and #487 with it. motko keeps
absorbing the payment provider's processing cost rather than passing it through.
Rationale: The derivation was unfinishable, not nearly finished. Its acceptance
tests could not typecheck for a reason no implementation could affect (a `let`
assigned inside a callback, narrowed to `never`), and that failure masked six
more — including a regression against FEE-6's merged contract, where the branch
silently redefined `application_fee_amount` from "the service fee" to "service
plus processing". Resolving that is a money decision nobody had made, and the
ticket had blocked the board all day.
Consequences: /pricing and /terms must never advertise a processing charge —
pinned by tests in both files. FEE-8 (#467) loses its subject. Migration #494's
three processing columns are live and dead.
Ticket: #475
Reversible: yes — the spec survives at docs/specs/475.md on factory/475.
Precedent: no

## 2026-09-01 — FEE-11 proceeds: a free job waives the whole fee, cap 10
Decision: A free-job credit waives the ENTIRE motko fee, at any job size. Banked
credits are capped at 10; a grant that would exceed it is truncated to the room
left rather than refused, and balances already above it are not clawed back.
Rationale: FEE-6 removed the bands, so FEE-2's base-band ceiling had no meaning —
waiving £2 of a £43 fee is not a free job, and "your first three jobs are free"
was not true while it held. The cap replaces the ceiling as the bound on leakage
that FEE-1 relied on the ceiling for.
Known cost, accepted: FEE-7 was dropped, so motko now bears the payment
provider's cost on a free job AS WELL AS forgoing the whole fee. The card's "no
settlement is ever net negative for motko" criterion assumed a processing
pass-through that no longer exists, and is amended rather than left as a contract
nothing can satisfy.
Ticket: #466
Reversible: yes — the split machinery and a finite-checkable ceiling both remain,
so reinstating one is a config change.
Precedent: yes — one rule, one function. `waiverSplit` is called by both
settlement and the copy that describes it, because two constants for one rule is
how the site came to advertise a charge the app did not make.

## 2026-09-01 — the schema probe reads production over Postgres, not REST
Decision: `SUPABASE_READONLY_URL` is a Postgres connection string and
`SUPABASE_READONLY_KEY` is that role's password, used only when the string
carries none. The REST client is removed.
Rationale: the one value was passed to both `createClient` (needs http(s)) and
`pg` (needs a DSN), so no setting of the secret could work; and REST cannot read
`information_schema`, which is the probe's whole job.
Ticket: n/a — found on the first live run of rls-check.yml after the secrets were set
Reversible: yes
Precedent: no

## 2026-09-01 — the object inventory excludes extension-owned objects
Decision: `check_public_object_inventory()` skips objects with a `pg_depend`
edge of type `e`, so pgvector's ninety functions leave the manifest.
Rationale: an extension is reviewed at the migration that installs it; listing
its members buries the dozen objects a human is actually checking and churns on
every upgrade, which trains the reviewer to wave the diff through. An object
belonging to no extension — `settle_fee_collection` — is still reported.
Ticket: n/a — found on the first live run of object-inventory.check.test.ts
Reversible: yes
Precedent: yes

## 2026-09-01 — a Server Action's contractor-facing message rides on `error.digest`
Decision: messages a contractor is meant to read are thrown via
`actionableError`, which puts the message on `error.digest`; the client reads
them back with `actionableMessage`, never off `err.message`. Everything else
stays redacted, and the client shows its own copy plus the digest.
Rationale: a production build replaces the message of anything a Server Action
rejects with, so every guard in `sendQuote` — the £0 question, the
narrative/total mismatch, the reconciliation gate — reached motko.app as React's
"the specific message is omitted" notice and the send became a dead end. The
digest is the only field the Flight client copies across intact.
Ticket: n/a — reported from production, quote send on 2026-09-01
Reversible: yes
Precedent: yes

## 2026-09-01 — the schema probe gets its own role, not agent_readonly
Decision: a new `schema_probe` role with login and `select` on all of `public`,
provisioned by 00000000000060. The probe's error message no longer points at
`agent_readonly`.
Rationale: `agent_readonly` is NOLOGIN and holds select on four tables, and
`information_schema.columns` is privilege-filtered — verified on a local
Postgres 16, where a role granted select on one of two tables saw exactly one.
The probe would have reported every other table's columns as missing from
production. `postgres` is refused by the probe's own read-only check.
Ticket: n/a — follow-up to #503
Reversible: yes
Precedent: no

## 2026-09-01 — production's migration ledger diverged from main, and was repaired
Production had been pushed from `claude/account-lifecycle-intake-defects-6ezpa8`,
which is not merged, so the ledger read 57=`account_erasure`, 58=`half_day_rate`,
59=`settlement_reversal_state` while main's tree read 57=`settlement_reversal_state`,
58=`inventory_excludes_extension_objects`. Main's 58 was unreachable by `db push`
— its version was ticked by another file — and its DDL was run by hand.

Repaired the same day: 59 marked reverted, 60 marked applied. The ledger now
holds {57, 58, 60}, the same version set as main's tree, so `db push` from main
works again. The *names* still differ from main's files; `db push` compares
versions only, so that is cosmetic until someone reads the table.

Decision: main's version set is what the ledger is reconciled to, because
CLAUDE.md names `origin/main` as the one source of truth.

The cost, which is now owed by the account-lifecycle branch:
- Its 59 is no longer ticked, and its `add column settlement_state` carries no
  `if not exists`, so pushing from that branch fails with "column already
  exists". Its 57 and 58 stay ticked and will not re-run.
- On merge it must **delete** its 59 rather than renumber it — that file is a
  duplicate of main's 57, created when the branch renumbered FEE-10, and main
  already carries the migration.
- Its 57 and 58 collide with main's by number and must move to 61 and 62, with
  `if not exists` added: `contractors.erased_at` and `contractors.half_day_rate`
  are already live on production.

Reversible: no — the ledger writes are made
Precedent: yes — a ledger repair reconciles to main's version set, never the
other way round

## 2026-09-01 — when does Motko ask for the iOS notification permission?
Decision: after a completed quote send, on the job page, as a soft in-app card
that only spends the real iOS alert on a yes. At most two asks, then never
again; Settings keeps the manual control. NOT gated on the send being the
contractor's literal first — see the rationale.
Rationale: nothing asked at all before this. `registerNativePush` had one
caller, the Settings button, so a contractor who never went looking got none of
the seven money-moment alerts and was never told. A quote just sent is the
first moment there is an answer worth being notified about. Gating on a
first-quote count was rejected: every existing contractor has already sent one,
so it would exclude the entire current userbase permanently. The soft ask
exists because iOS grants one alert per install and "Don't Allow" is only
reversible in iOS Settings.
Ticket: n/a — asked by the owner on 2026-09-01
Reversible: yes
Precedent: yes

## 2026-09-01 — how does one deployment serve both APNs gateways?
Decision: resolve the gateway per token at send time. Try the configured one,
and on BadDeviceToken — the only reason meaning "wrong gateway" — try the other
before believing it. A token is reported gone only when BOTH reject it. The
gateway that worked is memoised in-process, not persisted.
Rationale: a device token is valid at exactly one gateway (Xcode build →
sandbox, downloaded build → production), so a single global APNS_ENV can only
ever serve one of them; with it set to sandbox, every real download failed AND
was pruned, because index.ts reads BadDeviceToken as a dead device. Persisting
the resolved gateway on push_subscriptions was rejected: schema-before-code
makes it two PRs and a production apply to save one HTTP request per cold
token, and the CI gate refuses a migration and code in one PR anyway.
APNS_ENV survives as an attempt-ordering hint that can no longer strand a
class of device.
Ticket: n/a — reported by the owner on 2026-09-01
Reversible: yes
Precedent: yes

## 2026-09-01 — the PUSH-NT toast names which of the three causes it hit
Decision: the no-token result carries a `cause` (`not-native` | `plugin-missing`
| `provisioning`), the toast names it in plain words, and the code it hands over
is narrowed to match — PUSH-NT-WEB, PUSH-NT-PLUGIN, PUSH-NT-PROV. The bare
PUSH-NT wording survives for a result with no cause.
Rationale: the timeout already computed exactly this and wrote it to
console.error, which needs a Mac and Console.app — so on a downloaded build the
one fact identifying who owns the fault reached nobody, and three unrelated
problems showed one string. That is a signal terminating in telemetry, which
AGENTS.md forbids. `provisioning` is an inference but a sound one: no-token is
only reachable with the runtime native, the plugin resolved and the permission
granted, and registerForRemoteNotifications fails silently without the
aps-environment entitlement.
Ticket: n/a — reported by the owner on 2026-09-01, PUSH-NT on a downloaded build
Reversible: yes
Precedent: yes — a diagnostic that must reach a human belongs in the UI, not the log

## 2026-09-02 — the probe's read-only check reads the catalog, not a write attempt
Decision: `has_table_privilege` over every table in `public`, replacing the
INSERT-into-`events` attempt.
Rationale: three versions of the write attempt were wrong. supabase-js never
rejected, so a read-only credential read as writable; my replacement rejected
correctly but named `events.occurred_at`, a column inherited from code that had
never executed against production — it is `created_at` — so the first run with
working credentials died on it. The catalog needs no column name, writes
nothing, and answers for all 28 tables at once. Verified on Postgres 16: a
read-only role passes, a writable role and a superuser are both caught, and
`events` gained no row.
Ticket: n/a — first live run after SUPABASE_READONLY_URL was corrected
Reversible: yes
Precedent: yes — prefer asking the catalog over probing behaviour by mutation

## 2026-09-01 — Account erasure is real; the 30-day grace period and restore are removed
Decision: Deleting an account now deletes the Supabase auth user immediately.
The soft-delete flag, the 30-day purge cron and the "Keep my account" restore
are gone. contractors.owner_user_id becomes nullable with ON DELETE SET NULL so
erasure detaches the contractor row instead of cascading the financial records.
Rationale: The flag was written by one path and read by none, so a "deleted"
account stayed fully usable — one signed back in 22 minutes after deletion. D9
of the account-lifecycle spec locks the removal; the owner reaffirmed it in
explicit knowledge that it deletes shipped, user-visible behaviour.
Consequences: Migrations 57 and 58 must be applied to production BEFORE the code
merges. One production account (Jacob's own work-email test account) is still in
the old half-deleted state with a purge that will now never run — see the Phase 0
report; not auto-repaired.
Ticket: account-lifecycle-intake-defects
Reversible: no — erasure is irreversible by design.
Precedent: yes — establishes that a soft-delete flag no read path filters on is
treated as a security defect, not a tidiness one.

## 2026-09-01 — Migration 17's cascade rationale has been stale since migration 30
Decision: Recorded as a correction, not a change. Migration 17 says the auth
user cannot be deleted because invoices and contracts would cascade away. That
stopped being true when migration 30 flipped invoices.quote_id and
contracts.quote_id to ON DELETE RESTRICT: the delete now fails with a
foreign-key violation rather than destroying anything.
Rationale: Verified by replaying the full migration chain against a scratch
Postgres with the old cascade restored. Both readings justify migration 61, but
only one is accurate, and the inaccurate one was about to be repeated forward.
Ticket: account-lifecycle-intake-defects
Reversible: n/a
Precedent: no

## 2026-09-01 — A first-run quote renders ungrounded prices as TBC, never as a figure
Decision: With no confirmed material price, no rate card and no retrievable past
job, material and provisional lines compile as unpriced-and-flagged rather than
carrying the model's estimate. Gated on `hasPricingHistory`; absent means
"assume history", so no established account changes.
Rationale: The pricing contract already held for labour and did not for
materials or provisional sums, which is where the invented figures on a first
quote actually came from. `statedPrices.length === 0` was overloaded three ways
and resolved permissively.
Ticket: account-lifecycle-intake-defects
Reversible: yes
Precedent: yes — "no history" is now a first-class input to pricing, not an
absence to be filled.

## 2026-09-01 — the account-lifecycle branch pays the ledger-repair cost
Decision: delete this branch's 59, renumber its 57 and 58 to 61 and 62, and
guard every statement in both with `if not exists` / `if exists`.
Rationale: exactly the three corrections the 2026-09-01 ledger-repair entry
records as owed. Its 59 was a byte-identical duplicate of main's 57 (verified
with the comment blocks stripped), so main already carries that migration. Its
57 and 58 collided with main's by number — after merging main, `supabase/migrations`
held two files at version 58, which breaks `db push` outright. And because both
were pushed to production from this branch before it merged, their DDL is
already live while their versions are unticked from main, so `db push` WILL
re-run them: unguarded they fail on "column already exists" and take the push
with them.
Ticket: #501
Reversible: yes
Precedent: no — this is the one-off cost of a push from an unmerged branch

## 2026-09-02 — the probe drops embedded resources rather than half-parsing them
Decision: `.select()` parsing removes parenthesised groups innermost-first, and
only a bare identifier is treated as a column reference.
Rationale: PostgREST embedded resources put another table's columns inside the
select string. The old filter dropped any token containing "(" — catching a
group's first token and missing the rest — so splitting on commas produced
`vat_registered)` and `signed_at))`, which were checked against the outer
`.from()` table. The probe's first genuinely working run failed #511 on both.
Both columns exist, and `signed_at` is on `contracts`, not the table it was
reported against. The probe cannot attribute an embedded column to its own
table, so it must not check it at all.
Ticket: n/a — found by the probe's first live run
Reversible: yes
Precedent: yes — a check that blocks correct work is worse than one that is silent

## 2026-09-02 — #373's pin on REQUIRED_CHECKLIST_QUESTIONS is retired
Decision: retire the acceptance assertion "still contains only crew, duration,
and materials_supply" in `tests/acceptance/373.test.tsx`. Its sibling — that the
list gains no customer_name/customer_contact — stays and passes unchanged.
Rationale: superseded by #501's D12, which promoted `working_dates` to a
required slot; that was the item's whole purpose. The two contracts are mutually
exclusive and no implementation satisfies both. The assertion pinned the current
VALUE of a list another in-flight item existed to change, rather than the
property VOICE-3 cares about — the failure mode AGENTS.md records from #356/#351.
Ticket: #373 (PR #511), superseded by #501
Reversible: yes
Precedent: yes — retirement is available when the superseding item has ALREADY
merged, not only from the superseding item's own first commit

## 2026-09-02 — HARN is a sequenced programme; the robustness brief's Stage 2 is dropped
Decision: Add `HARN` to `SEQUENTIAL_PROGRAMMES`, queue Stage 0 (`OBS-1..4`) and
Stage 1 (`HARN-1..4`) as factory work, and drop the brief's Stage 2 (R1-R5)
entirely — it is the `PRICE` programme, shipped 28-31 Aug (#420, #426, #443,
#452, #482). The price-fidelity defects found during Pass B are queued as
`PFIX-*` in Backlog for Jacob, not admitted to the factory.
Rationale: HARN items each consume the shape the previous one introduces, the
same case LED and PRICE were added for. Stage 2 cannot be re-run against a tree
that already contains it, and its 55% justification is invalid (the diff measures
a fixed-mode collapse, not user rejection). PFIX-* touch pricing, which AGENTS.md
puts on the escalation list regardless of confidence.
Ticket: docs/robustness-tickets.md
Reversible: yes
Precedent: yes — a review that finds its own premise already shipped drops the
stage rather than re-deriving it, and says so in the tickets file.

## 2026-09-03 — The schema-in-tree check learns jsonb paths; three PFIX items proceed
Decision: (a) `scripts/ci/schema-in-tree.ts` is taught to read the text before
the first `->`/`->>` as the column name, so a valid jsonb path stops being
reported as a missing column. (b) PFIX-2 (speaker attribution), PFIX-1 (refuse
to lock an ambiguous amount) and PFIX-4 (first-run invention guard) proceed as
factory work, PFIX-1 held until PFIX-2 merges since both edit
`src/lib/voice/stated-prices.ts`.
Rationale: (a) is narrowing a false positive, not weakening a check —
`events.properties` is a real jsonb column and PostgREST supports path
selection, so the check's "PostgREST rejects this select" was untrue; it still
fails on a genuinely missing column. (b) all three change what a customer is
charged, so they are Jacob's call and he made it; PFIX-4 additionally defeats
the 1 Sep first-run decision, which makes it a conflict to resolve rather than
a new preference.
Ticket: #514, PFIX-1/2/4
Reversible: yes
Precedent: yes — a check that reports a violation which cannot occur is a
defect in the check, and correcting it is not the "agent proposes disabling a
check" pattern AGENTS.md warns about. The distinction is whether the defect
class it was built for still fails.

## 2026-09-03 — The July abandonment rate and the August voice collapse are not user signals
Decision: Withdraw both readings from the robustness review. The stranded
`sow_in_progress` rows are Jacob's own incorrect test runs; the August drop to
one voice session was Jacob instructing the testers to stop, because of the
errors in VOICE-4.
Rationale: A tester cohort under active instruction is not a natural
experiment, and row counts cannot see the instruction. Recorded because the
41% figure had already been written into a queued card (OBS-1) and would
otherwise keep propagating.
Ticket: VOICE-4
Reversible: yes
Precedent: yes — production row counts describing user behaviour must be
checked against what the owner was doing to the system in that window before
they are treated as measurements.

## 2026-09-03 — `run_id` is the job id, not a new column
Decision: The voice-funnel events (`voice_session_started`, `_abandoned`,
`_completed`) and the OBS-4 report all carry `run_id` set to the job id, rather
than minting a separate identifier on a new column.
Rationale: The job row is inserted at session mint, so the id exists at the
first event and is unique per session; every later stage already carries it;
and `redraftJob` reuses it, which is exactly the retry-shares-a-run behaviour
OBS-1 asks for. A dedicated column would have needed a migration applied by
hand ahead of the deploy — schema before code — to say the same thing.
Ticket: OBS-1, #522
Reversible: yes — a real `run_id` column can be added later and backfilled from
`job_id`, since every historical event carries both.
Precedent: yes

## 2026-09-03 — The run viewer is contractor-scoped, with no admin flag
Decision: `/jobs/[id]/run` is an ordinary authenticated, RLS-scoped job route: a
contractor sees runs for jobs they own and any other id 404s. The "behind an
admin flag" half of the OBS-3 card is NOT implemented, and no cross-tenant view
ships with it.
Rationale: There is no admin role in the schema, so the flag would have meant
inventing one — a permissions change, on a page that renders customer PII,
applied by hand ahead of the deploy. The diagnostic value does not need it: the
data shown is the contractor's own, the tester can open the viewer on the job
they are reporting, and OBS-4 carries the report to us with the run attached.
Cross-tenant reading stays where it already is, on the read-only Supabase
connector.
Ticket: OBS-3, #522
Reversible: yes
Precedent: yes — a card asking for an admin gate on a surface that has no admin
role gets the scoped version now and the gate as its own item, rather than a
role invented in passing.

## 2026-09-03 — The run viewer reads `events` through the service role
Decision: The "reported problems" pane reads `events` with the admin client,
filtered to `event_name = 'run_problem_reported'` and the job id that RLS just
authorised on the row above. Everything else on the page is RLS-scoped.
Rationale: `events` has an INSERT policy and no SELECT policy at all
(migrations 19/34), so an RLS-scoped read returns an empty list forever rather
than an error — a pane that silently always says "no reports" is worse than no
pane. The alternative was adding a SELECT policy to a table every surface
writes to, by hand, ahead of the deploy. The scoping here is strictly tighter
than that policy would have been: no id from the request reaches the query
except the one RLS already granted.
Ticket: OBS-4, #522
Reversible: yes
Precedent: yes — where a table's policies do not cover a read, a service-role
read narrowed by an id RLS has already authorised is preferred to widening the
policy, and the narrowing must be visible at the call site.

## 2026-09-03 — PFIX-3: how a stated price attaches to a line
Decision: (a) Remove the transcript-span fallback in `matchStatedPrice` entirely.
A stated price matches only through its extracted `item`; one that matches
nothing is left unattached and flagged. (b) A stated price whose only candidate
is a labour line does not attach at all — the line keeps its crew breakdown and
its computed total, and a flag names what could not be applied.
Rationale: (a) the fallback matched on one shared word of three characters with
no stop-word removal, which put £520 onto "Twin and earth cable" via the word
"and" in "five hundred and twenty". Any threshold or stop-word list is a guess
we would re-tune forever; refusing to guess fails safe. (b) clearing a crew
breakdown to let the lock govern destroys the per-person day/rate data the SoW
captured, and a whole-job fixed price already has `pricing.fixed_amount`.
Ticket: PFIX-3
Reversible: yes — but note it changes compile behaviour only; no stored quote is
recompiled, so no existing total moves.
Precedent: yes — a fuzzy matcher in the pricing path that cannot be made
precise is removed rather than tuned. An unattached price the contractor can see
beats an attached price nobody can explain.

## 2026-09-03 — PFIX-5: the invention gate is binary and fixture-derived
Decision: The ship gate becomes "against the fixture set, zero line items carry
a monetary value absent from the transcript". Binary, not a percentage. The 55%
is withdrawn wherever it appears. Price drift stays as monitoring, never a gate,
until it can be computed on non-test accounts.
Rationale: the historical data cannot produce a defensible rate at all — the
distribution was perfectly bimodal (code transformations, not user rejection),
two accounts produced 52 of 59 deletions, and the residual rests on 37 items
across 11 quotes. With voice off there is no organic signal to derive a rate
from, and a fixture-derived gate cannot be moved by who happened to be testing
that week.
Ticket: PFIX-5
Reversible: yes
Precedent: yes — a gate that depends on a user population is not usable while
the product has none. Prefer a gate measurable from fixtures.

## 2026-09-03 — PFIX-6: the voice-notes audio is deleted, the transcripts kept
Decision: Delete the 21 objects in the `voice-notes` bucket, then drop
`jobs.source_audio_url`, the bucket, its policies and the erasure sweep, and
drop the three orphan tables (`client_errors`, `feedback`, `rate_limits`) and
remove them from the public-surface manifest. The stored transcripts stay.
Rationale: queried before deciding, which retired this card's own claim that the
recordings "may be the most valuable asset in this review". All 21 belong to one
account (Aspire Plastering, family, so consent is answerable directly); 16 are
orphaned with no job row; of the 5 referenced, none has a `sow_json` or
conversation turns and four never left `processing`; the 3 stored transcripts
are 202, 150 and 229 characters. It is a dead pipeline generation, not a corpus.
Ticket: PFIX-6
Reversible: NO — this is an irreversible write, approved explicitly by Jacob.
Order is part of the contract: the storage deletion runs first (two-step, with a
dry run by default), the migration is applied by hand second, the code that
stops referencing them merges last.
Precedent: yes — a claim about the value of production data is checked against
production before it is used to justify keeping or deleting it.

## 2026-09-03 — PFIX-7: an unpriced line clears when the contractor types a price
Decision: Typing a price into a line compiled as `unpriced` clears that state
automatically, with no confirmation step. PFIX-7 is split: the two dead ends a
contractor cannot escape stay on PFIX-7, the three flag-hygiene defects become
PFIX-8.
Rationale: typing the number is the confirmation, and the current behaviour puts
a wrong number on a customer document — the total includes the figure while the
document still says "to be confirmed, not included in the total". A second tap
is friction on a path the contractor already had to hunt for. Split because the
two blocking defects should not queue behind three that merely annoy.
Ticket: PFIX-7, PFIX-8
Reversible: yes
Precedent: yes — where a flag describes a state the contractor has just
resolved, the act of resolving it clears the flag. See PFIX-8 for the general
form.

## 2026-09-03 — CHK-1: the object-inventory manifest is derived from the migrations
Decision: Replace the production-seeded snapshot baseline. The expected object
set is computed by replaying `supabase/migrations/*.sql`, so anything on
production with no migration behind it fails by construction.
Rationale: the manifest was seeded from a live production snapshot by the same
commit that created the check, so everything already wrong that day is
permanently inside its allowlist — `client_errors`, `feedback` and `rate_limits`
are three orphans of exactly the class it exists to detect, and it is green over
them and always would be. The other two options (date-stamping the snapshot, or
a one-off hand audit) leave the class intact. This will surface further
pre-existing drift; that is the check finally working, not a regression.
Ticket: CHK-1
Reversible: yes
Precedent: yes — a drift check may never take its baseline from the system it
checks. Its blind spot is otherwise exactly whatever was already wrong on the
day it was installed, while it reads as certifying the whole surface.

## 2026-09-03 — HARN-2 was written by hand after a fifth block
Decision: Stop deriving #518 and write the replay harness directly, keeping the
factory branch's correct parts (separate vitest project, offline replay,
recording isolation, the prompt-hash guard) and replacing the fixture's
pipeline-derived expectations with transcript-derived ones.
Rationale: five blocks across four distinct causes, and the fifth was caused by
my own diagnostic — it told the PM to import a comparator that lived inside a
test file, which `check-acceptance-static.sh` correctly refuses. The comparators
now live in `tests/helpers/pipeline-compare.ts`, which removes the trap rather
than asking the next derivation to avoid it.
Ticket: HARN-2, #518
Reversible: yes
Precedent: yes — when an instruction from this loop is itself the cause of a
block, fix the thing the instruction pointed at rather than rewording the
instruction. And a fixture's expected values are derived from the transcript,
never from the pipeline's output: the committed array had recorded a live
over-matching defect as the correct answer, and would have passed forever.

## 2026-09-03 — Leading-conjunction handling is in scope for PFIX-2
Decision: The "skip a leading `and`" change in `extractBestMoneyPhrase` stays.
QA's finding that it falls under PFIX-1's "how amounts are parsed" is accurate
about the spec's wording and wrong about the conclusion. #528 resumes at
`verify` with the pushed work intact.
Rationale: proven on `main` before deciding — `extractStatedPrices("And the
labour is three hundred pounds.")` returns NOTHING, and so does "And the
consumer unit is five hundred and twenty pounds", while "So the skim is four
hundred and fifty pounds" returns £450. `and` is in `moneyWords`, so a leading
"And" becomes the whole candidate phrase, fails to parse, and the code
deliberately does not try shorter variants — the price is dropped silently.
That is a stated price never reaching the quote, which is the exact failure the
whole price-fidelity programme exists to prevent, and there is no reading under
which dropping it is preferable. The frozen acceptance test also already
requires the correct behaviour, so the contract defines it as in scope whatever
the prose says.
Ticket: PFIX-2, #528
Reversible: yes
Precedent: yes — where a spec's out-of-scope line and a frozen acceptance test
disagree, the test defines the contract. And an out-of-scope boundary is never
a reason to preserve a defect that loses a price: scope limits what work is
taken on, not whether known-wrong behaviour may be shipped.

## 2026-09-03 — Job 30faef2a is binned and the call redone
Decision: Archive quote `b3112196` and re-run the intake once PFIX-9 has landed,
rather than sending it or patching the row.
Rationale: the SoW carries a fabricated £563,889 stated price (the customer's
spoken phone number) and a mobile the transcript does not support. The send
guard fix means the £540 would go out correctly, but anything later built on
that job — a redraft, a reconciliation, a contract — inherits both. One call is
cheaper than carrying a poisoned row.
Sequencing: PFIX-9 FIRST. Re-running the intake before it lands reproduces the
phantom price from the same utterance.
Ticket: PFIX-9, VOICE-5
Reversible: the archive is; the decision not to send is trivially so.
Precedent: yes — a job whose SoW carries a fabricated figure is re-run, not
repaired. The SoW is the input to everything downstream, so patching one field
leaves the rest derived from a record nobody trusts.

## 2026-09-03 — Unapproved knowledge chunks are purged
Decision: Delete the knowledge chunks embedded from drafted-but-never-approved
quotes. Delivered as a runnable two-step script — a bare invocation lists what
it would delete, `--confirm` performs it — applied by Jacob.
Rationale: PFIX-4 stops new ones being written, which halts the growth but not
the contamination. Those chunks carry figures the model invented and they come
back as "similar past jobs" in later prompts, so every future first-run draft
can still be anchored on a number nobody ever quoted. Stopping the inflow while
leaving the pool is half a fix.
Not "purge everything": chunks from approved and sent quotes are genuine
learning and are kept.
Ticket: PFIX-4
Reversible: NO — an irreversible write, approved explicitly. The dry run is part
of the contract, not a nicety.
Precedent: yes — where a defect both produces bad data and feeds on it, the fix
covers the existing pool as well as the inflow, or it is not a fix.

## 2026-09-03 — An internal account is marked by a column, not inferred
Decision: DATA-1 adds `contractors.is_internal boolean not null default false`,
set by hand for Jacob's accounts and his father's. No email-domain rule and no
ID list in config.
Rationale: explicit and auditable, and a metric run outside the app can see it —
a config list cannot. A domain rule silently reclassifies anyone who later signs
up on a matching domain, which is the same class of error as the contamination
DATA-1 exists to remove: a heuristic standing in for a fact.
Ticket: DATA-1
Reversible: yes
Precedent: yes — a fact about an account is stored, never derived from a
heuristic. Every historical figure on this board was wrong because there was no
such column.

## 2026-09-03 — The price-fidelity chain is written by hand
Decision: PFIX-1, PFIX-3, PFIX-7, PFIX-8 and PFIX-9 come out of the factory and
are written directly, PR'd individually. #528 (PFIX-2) finishes in the factory —
it is already at `verify` with a complete implementation QA called correct.
PFIX-4 is taken over now rather than at a fourth block.
Rationale: three items needed hand-writing today after the factory could not
derive them, and the pattern is specific rather than general — these are small,
well-specced changes on the money path where the frozen-acceptance-test rule
keeps producing contracts no implementation can satisfy, and where a wrong
derivation is expensive. It has cost roughly a cycle per item on this class.
The QA step is the real loss: it produced two substantive findings today. It is
replaced by writing the reproduction as a test first, from production evidence,
which is what caught the leading-`and` and phantom-price defects in the first
place.
Ticket: PFIX-1/3/4/7/8/9
Reversible: yes — any of these can be returned to the factory.
Precedent: no. This is a judgement about one programme at one moment, not a
verdict on the factory. HARN, OBS and CHK items stay in it.

## 2026-09-03 — A weak price match is believed only when it is unambiguous
Decision: PFIX-3 keeps the transcript-span fallback in `matchStatedPrice` rather
than deleting it, but resolves the whole quote at once: an `item` match spends
the price, and a span match is accepted only where the pairing is one-to-one —
this the only line that span could mean, and that the only span this line could
have come from. Ambiguity in either direction resolves to nothing, and the
leftover price is flagged to the contractor with the words it came from.
Rationale: the defect was one price landing on two lines ("and" is three
characters), and the reflex fix is a stop-word list or a higher threshold. Both
are guesses that need re-tuning forever and neither distinguishes a real second
mention from a coincidence. Deleting the fallback outright was tried first and
broke `tests/acceptance/443` — the extractor's `item` is often wrong in a way
the span is not, so the span carries real signal that a per-line first-match
scan simply cannot use safely.
Ticket: PFIX-3
Reversible: yes
Precedent: yes — where a heuristic over-matches, constrain it by resolving the
whole set at once and refusing the ambiguous cases visibly, rather than tuning
the per-item threshold. Tuning moves the failure; it does not remove it.

## 2026-09-03 — A per-item stated price is refused on a crew-priced labour line
Decision: PFIX-3 does not apply a stated price to a labour line that carries a
crew breakdown. The line keeps its `people`, keeps its transcript provenance,
and the contractor is told which amount could not be applied and to which line.
Rationale: `lineItemTotal` prefers the breakdown whenever it is present, so the
lock was already inert — measured at £600 with rates set and £0 without, from
the same locked £520. The only way to make it govern is to clear the crew, which
the earlier 3 Sep decision forbids: those per-person days are what the SoW
captured, and a whole-job fixed price already has `pricing.fixed_amount`. The
choice was therefore between an inert lock nobody can see and a refusal they
can. On a rate-less line the refusal leaves an unpriced labour line and a flag,
which blocks the send until the contractor acts — the honest outcome.
Ticket: PFIX-3
Reversible: yes
Precedent: yes — a mechanism that cannot change the number it claims to control
is removed and reported, never left in place to look like it works.

## 2026-09-03 — The overnight run order, and why PFIX is sequenced by file rather than by number
Decision: three items run unattended tonight — PFIX-5, PFIX-6 and OBS-6. PFIX-1,
PFIX-7, PFIX-8 and CHK-1 are held in Backlog and released as their blocker
merges. PFIX-4 is already in flight on #529/#531 and is marked In factory.
Rationale: Jacob moved every PFIX card to Ready for factory and asked for them
to be ordered. The obvious lever — adding "PFIX" to SEQUENTIAL_PROGRAMMES in
`scripts/factory/admission-order.mjs` — is the wrong one and would deadlock the
board: that gate blocks on the item at index-1, so PFIX-4 would wait forever on
PFIX-3, which was written by hand and never entered the factory at all, and
PFIX-6 on a PFIX-5 issue that does not exist. The PFIX numbers are independent
defects found in one review, not a stacked programme like LED or PRICE.
What actually collides is FILES, and `src/app/jobs/actions.ts` is the hotspot:
PFIX-2 (#528, in flight), PFIX-4 (#531, open PR), PFIX-7 and PFIX-8 all write
it. `src/lib/voice/stated-prices.ts` is the second: PFIX-1 and PFIX-2 both
write it. So the held set is exactly the set that would have met an open PR in
the same file.

| Held | Waits on | Shared file |
|---|---|---|
| PFIX-1 | PFIX-2 (#528) | `src/lib/voice/stated-prices.ts` |
| PFIX-7 | PFIX-2 (#528), PFIX-4 (#531) | `src/app/jobs/actions.ts` |
| PFIX-8 | PFIX-7 | `src/app/jobs/actions.ts`, `src/lib/stated-price-guard.ts` |
| CHK-1 | PFIX-6 | `src/checks/object-inventory.check.test.ts`, the manifest |

Ticket: PFIX-1/4/5/6/7/8, CHK-1, OBS-6
Reversible: yes — a held card is one status change from running.
Precedent: yes — sequence the factory on the files an item writes, not on the
number in its name. A prefix belongs in SEQUENTIAL_PROGRAMMES only when each
item genuinely consumes the shape the previous one introduced; using it for a
set of independent defects that happen to share a prefix deadlocks on the first
one that was handled outside the factory.

## 2026-09-03 — PFIX-1 is pulled forward the moment PFIX-2 merges
Decision: Jacob, 3 Sep. PFIX-1 goes to `Ready for factory` as soon as #528
merges, ahead of PFIX-5, PFIX-6 and OBS-6, and ahead of the rest of the PFIX
queue. It is held now only because it and PFIX-2 both write
`src/lib/voice/stated-prices.ts`; nothing else is in its way.
Rationale: four defects measured against the real module on the merged
`factory/528` branch, all live, none fixed by anything in flight:

| Said | Extracted |
|---|---|
| "somewhere between eight hundred and a thousand" | £801,000.00 |
| "twenty-two thousand pounds" | £1,000.00 — 22x under |
| "It is £450 for the skim." | nothing |
| "Ring me on <number>, and the skim is four hundred and fifty pounds." | nothing |

The third is the one that should decide the priority: a price written in
digits with a £ sign is not extracted at all, which is the least ambiguous
form a contractor can speak or a transcriber can write. The fourth confirms
PFIX-2 does NOT close the gap PFIX-9 left — PFIX-2's skip fires only at index
0 of the sentence, so it misses an `and` beginning the candidate phrase once
the phone number is redacted off the front. Same defect, one position over.
A locked price is authoritative to the drafting model, so each of these fixes
a wrong number INTO a quote rather than degrading one.
Ticket: PFIX-1
Reversible: yes
Precedent: no — a priority call on one item, on evidence.

## 2026-09-04 — A case-insensitive flag disabled the admission gate's own guard
Decision: `admission-gates.mjs`'s `dependency` pattern drops the `/i` flag and
spells the directive words in both realistic casings instead. The item-reference
class `[A-Z]{2,6}-\d+` is now genuinely uppercase-only.
Rationale: the pattern requires an explicit item reference so that it does not
fire on every card mentioning that it depends on something — its own comment
calls that load-bearing. `/i` applied to that class too, so any lowercase
hyphenated word followed by a digit read as an item reference:

    "depends on the index-0 behaviour"  -> MATCH
    "depends on utf-8 encoding"         -> MATCH
    "waits on level-3 support"          -> MATCH

The guard was written, documented, and disabled on the same line. It stopped
PFIX-1 — the top-priority item on the board, released minutes earlier on Jacob's
explicit instruction — on a sentence about a frozen test, with no dependency of
any kind involved. Caught by reading the block comment's quoted trigger and
running the regex, rather than by trusting what the check said it meant.
An all-caps directive is no longer matched; `NOT FACTORY READY` is the marker
for an author who wants a gate without guessing a phrasing.
Ticket: PFIX-1 (blocked by it), admission-gates
Reversible: yes
Precedent: yes — when a check fires on something that is obviously not what it
describes, read its pattern before rewording the input. Nine pieces of factory
machinery have now been found faulty in two days, and four of them gave
confidently wrong diagnoses.

## 2026-09-04 — The Sentry tunnel is a hand-written public route, not a generated one
Decision: keep the tunnel (option (a)) and write it as a real file at
`src/app/api/monitoring/route.ts`, registered in `PUBLIC_API_ROUTES` and in
`tests/acceptance/99.test.ts`, instead of `tunnelRoute` in `next.config.ts`.
Rationale: a tunnel is needed because ad blockers block `ingest.sentry.io`, and
a crash reporter that silently loses a share of reports leaves the dashboard
looking calm while it is not. But the plugin's route is created at build time
and exists as no file under `src/app/api/`, so the public-route inventory that
walks that directory could never see it — an unauthenticated endpoint invisible
to the check that exists to review unauthenticated endpoints. Writing it by
hand also let the route state its own access control: it forwards only
envelopes whose header names this project's own DSN, so it is not an open
relay to any Sentry account.
Ticket: OBS-5, PR #555
Reversible: yes — one file and two registry entries.
Precedent: yes — where a framework plugin would generate a public surface,
write it by hand so it lands in the inventory. A generated route is not
"passing" the registry check; it is unseen by it.

## 2026-09-04 — The first-run pricing guard counts past QUOTES, and learning moves to send
Decision: three changes, which only work together.
(1) `hasPricingHistory` takes `pastQuoteCount: number` in place of
`similarPastJobs: string[]`, fed by `countLearnedQuotes` — a direct count of
`knowledge_chunks` with `source_type = 'quote'`.
(2) `syncQuoteKnowledge` and `rememberMaterialPrices` no longer run at draft
time or on a line edit. Both run once, in `sendQuote`'s `markSent`, from the
lines the customer was actually shown.
(3) The guest flow passes `has_pricing_history: false` explicitly, and
`unpricedLabour` splits into `unpricedLabour` + `unpricedMaterials`.
Rationale: `match_knowledge_chunks` filters on `contractor_id` alone, so the
single chunk written by the business-setup interview came back as a "similar
past job" and satisfied the guard on a contractor's very first quote. Draft-time
embedding then satisfied it permanently from the model's own invented figures,
and `rememberMaterialPrices` stamped every priced materials line `confirmed_at`
whether the contractor had looked at it or not — laundering an invented number
into evidence. On production, rate cards and confirmed material prices were
empty for every contractor, so the guard was off everywhere. The flag split is
not cosmetic: `unpricedLabour` meant ANY unpriced line, so a guest who HAD
stated a day rate would now be told they had not.
Ticket: PFIX-4
Reversible: yes.
Precedent: yes — the knowledge layer learns from what a human sent, never from
what the model drafted. A retrieval result is not evidence of history; ask the
question the guard actually means.

## 2026-09-04 — A frozen fixture may be widened when a shared type gains a required field
Decision: `has_pricing_history` on `CompileContext` becomes REQUIRED, and the
ten fixture literals in `tests/acceptance/443.test.tsx` and
`tests/acceptance/424.test.ts` gain the field. AGENTS.md gains a narrow rule
permitting exactly this and nothing else.
Rationale: the field was optional and tested with `=== false`, so omission
silently took the unsafe branch — which is how the guest funnel came to print
model-invented material prices on a public page (PFIX-4). It could not be made
required, because two frozen acceptance tests build a context without it. So
the freeze was acting as a ratchet toward permissive types: tightening any type
always fails some frozen fixture, and a frozen fixture may never be repaired.
The rule that exists to protect contracts was protecting the defect.
The value written must preserve the fixture's current behaviour (`true` here,
the old default), so the change is a pure no-op — 312 files, 4,018 tests green
with no other edit, which is the check that the widening was done right.
Ticket: TYPE-1, raised out of PFIX-4
Reversible: yes.
Precedent: yes — a fixture may be widened, never narrowed. Narrowing is a
contract change and goes through the retirement rule.

## 2026-09-04 — An unsatisfiable frozen assertion is repaired in the spec commit, not worked around downstream
Decision: where an acceptance test cannot be satisfied by any correct
implementation, the repair goes into the branch's FIRST commit by hand — and
never into shared test infrastructure. On #549 three assertions read
`expect(flag).not.toContain(...)` where `flag` is `null` on success; vitest
rejects a null receiver whatever the `.not`, so the assertions threw precisely
when the code was right. Amended to `expect(flag ?? "")`, and the Engineer's
81-line global `toContain` replacement in `tests/setup.ts` was dropped.
Rationale: the shim made `expect(null).not.toContain(anything)` pass silently
in every test in the repository, to avoid touching three characters in one
frozen file. Declaring it in the spec's `## Files` would have legitimised
retiring a matcher to save an assertion. The Engineer was right to raise
`SPEC ERROR` rather than live with it — `tests/acceptance/` is closed to it, so
the shim was the only fix inside its permissions.
Ticket: #549 (PFIX-7)
Reversible: yes.
Precedent: yes — a frozen test that no implementation can pass is corrected at
its source. Fixing it anywhere else buys the item at the cost of a check.

## 2026-09-04 — PFIX-5 (invention-rate metric) removed from the roadmap
Decision: #544 closed as not planned and PR #554 closed. Jacob's call; the
Notion card comes off.
Rationale: the branch was green on `179342d` and the implementation was never
reviewed, so this is a scope decision rather than a failure. It redefines an
internal metric with nothing user-facing behind it, and the roadmap is moving
back to features.
Ticket: #544
Reversible: yes — reopen and label `verify`; the branch is intact.
Precedent: no.

## 2026-09-04 — An acceptance test may not pin the current contents of a generated baseline
Decision: #545 (CHK-1) re-derived rather than repaired. Its frozen test asserts
that `client_errors`, `feedback` and `rate_limits` appear in
`src/checks/public-surface.json`; PFIX-6 dropped all three and regenerated the
file, so no tree carrying PFIX-6 can pass it.
Rationale: the card held CHK-1 behind PFIX-6 "so its regression test has
something real to assert against", and landing second is exactly what removed
what it asserted against. Not a retirement — PFIX-6's card never named the
assertion and could not have, since the test was written after that card. The
item survives: the premise is structural (a baseline seeded from production is
blind to what was already wrong), and that is the class that hid
`settle_fee_collection` for weeks.
Ticket: #545 (CHK-1)
Reversible: yes.
Precedent: yes — assert the relationship an item is about, never a named row in
a file another item generates.

## 2026-09-04 — VOICE-4 re-derived, and its premise re-grounded
Decision: #541 back to `needs-spec`. Six of seventeen assertions are wrong and
the item's core criterion is covered by `expect(true).toBe(true)`.
Rationale: the frozen file calls `compileDraftToLineItems` with a signature
that does not exist — the `SowState` never reaches the parameter the flag is
computed from — so no implementation could pass it. Hand-repair was attempted
and abandoned: past the type errors it needed new assertions, which is writing
the contract rather than fixing it. Separately, the card's premise has moved:
the 4 Sep intake call ended `manual`, not on a cap, so the item is a guard
against a currently-rare state rather than a fix for something happening now.
The implementation itself (`endedOnCap`, `cap_ended`, one contractor flag) is
sound and should be re-reached.
Ticket: #541 (VOICE-4)
Reversible: yes.
Precedent: no.

## 2026-09-04 — The deploy health check is removed rather than repaired
Decision: delete `deploy-health-check.yml`, `.github/scripts/health-check.sh`,
`deploy-health-check.json`, the dispatch step in `factory-deploy.yml`, and the
frozen `tests/acceptance/195.test.ts` with its two regression tests. Jacob's
call, after being shown what repairing it would cost and buy.
Rationale: it had not passed on any recorded run and could not. Its four
credentials were blank in every run, and the two paths needing no credentials
got a 302 from Vercel deployment protection before reaching the app. Fully
configured it would still have proved little — the dashboard check accepted
301/302/303/307/308, and a redirect to login is what a FAILED sign-in returns,
so it would have passed either way. Meanwhile it commented "the deployment will
not be promoted to production" on every factory item, beside green gates and QA
passes.
Retires: `tests/acceptance/195.test.ts` in full — all 32 assertions across seven
describes are about the health check workflow, its config file, its script, its
FACTORY.md documentation and its promotion gating. Nothing in it tests behaviour
that survives the removal, and its own title asserts "gating promotion to
production", a capability FACTORY.md already recorded as never having existed.
Ticket: #567
Reversible: yes — the files are one revert away, and FACTORY.md records the
three things it would need to be worth having.
Precedent: yes — a check that cannot pass is removed or fixed, never left red.
Leaving it red costs the credibility of every other check on the board.

## 2026-09-04 — Bearer-token auth in middleware outlives its only consumer
Decision: NOT changed. Recorded and raised instead.
Rationale: `src/lib/supabase/middleware.ts` accepts `Authorization: Bearer` on
all routes in addition to cookie sessions, and it exists for the health check
that has just been deleted. It is not an open door — every token goes through
`supabase.auth.getUser(token)`, so an invalid or expired one is rejected exactly
as a bad cookie would be. But unjustified auth surface should not survive by
accident. Auth is on the escalation list, so this is a decision for Jacob rather
than a tidy-up to fold into a deletion.
Ticket: #567
Reversible: n/a — nothing changed.
Precedent: no.

## 2026-09-04 — PFIX-8's remaining two, written by hand; HARN-4 parked on a red suite
Decision: complete PFIX-8 by hand as its card directs, and hold HARN-4 until the
pipeline suite is green.
Rationale (PFIX-8): its sequencing hold — "hold until PFIX-7 merges", both touch
`stated-price-guard.ts` — lifted when PFIX-7 merged as `0e55d48`. Two parts
remained after #532. The SoW write on a pricing-mode switch is now guarded like
the quote write above it: a discarded error left the quote collapsed into
fixed-mode figures with no record of the mode that collapsed it, reported as
success. And the five failure prefixes are now built from constants shared with
their producers, so a sixth failure kind cannot be added without one — the
hand-copied list was the accumulation bug's actual cause, and it was one
addition away from returning.
Rationale (HARN-4): the card asks for the pipeline suite to run in the main CI
gate. `npm run test:pipeline` is RED — 2 of 9, scenario-1. Making it required
would turn every pull request in the repository red, which the card's own edge
case forbids: "a flaky required gate blocks every pull request and is worse than
no gate." Its precondition is scenario-1 going green, and that is blocked on a
prompt-hash mismatch needing a re-record against the live API — a human action
with a key, not factory work.
Ticket: PFIX-8 (no GitHub issue — hand-written per the 3 Sep decision); HARN-4
Reversible: yes.
Precedent: yes — where a check's prefix list is maintained alongside the code
that produces the strings, derive one from the other. A hand-copied list of
what a function can emit drifts, silently, and the drift is the defect.

## 2026-09-04 — HARN-4 runs the pipeline suite nightly, not as a per-PR gate
Decision: the replay harness runs on a schedule against `main` and routes any
finding to a surface a person reads. It does NOT go in the CI gate job and no
pull request is ever blocked by it. Jacob's call, taking the recommendation.
Rationale: the card asked for it in the gate, and the gate is the wrong place.
The prompt-hash guard fires whenever a prompt changes — correctly; that is the
guard working — so as a required check every prompt edit would turn CI red for
the entire repository until someone re-recorded the fixtures with an
ANTHROPIC_API_KEY. The value of the harness is catching a quote that says
something the tradesperson did not, and that is worth exactly as much found
overnight as found on a pull request. Nightly keeps the signal and removes the
repo-wide blast radius.
Consequence worth noting: this also LIFTS the hold on the item. HARN-4 was held
because `npm run test:pipeline` is red (2 of 9, scenario-1) and making a red
suite required would have blocked every PR. A nightly that reports a real
finding on its first run is the item working, so red is no longer a blocker —
and the card now says so explicitly, to stop an Engineer trying to fix the
findings as part of it.
The card was rewritten wholesale: every acceptance criterion in the original
was about being a gate ("a pull request that changes a price cannot go green",
"the gate adds under 60 seconds", "runs on every pull request") and none of
them survive. The new ones are about reporting: a finding must reach a person,
a stale recording must report differently from a content finding, and a
re-run must not open a duplicate.
Ticket: HARN-4
Reversible: yes.
Precedent: yes — a check whose failure mode can block unrelated work belongs on
a schedule, not in the gate. And a scheduled check must route its finding
somewhere a person reads; a red tick in the Actions tab is not delivery. The
deploy health check was deleted the same day for being exactly that.

## 2026-09-05 — The free-job allowance counts completed jobs, not rail settlements
Decision: three free jobs per account, decremented by ANY completed job however
it settled — rail, cash, cheque or bank transfer. One counter, ending both the
subscription trial and the transaction-fee waiver. Jacob's call: "free until 3
jobs even if paid by cheque or bank."
Rationale: the earlier rule decremented on rail settlement only, so motko never
absorbed a Stripe cost it had not paid. But billing also starts when the
allowance is exhausted, so together those two made a trade who never connects
Stripe free forever — and that is the common case today, not a corner: no
external account has a Connect account at all, and five of six did two jobs or
fewer. Two counters would fix it and cost a second concept nobody can explain;
"your first three jobs are free" has to stay one sentence.
Consequence, accepted: a trade who completes three cash jobs and settles a
fourth on the rail pays a fee on that fourth job having never had one waived.
They were promised three free jobs and had three.
Ticket: pre-launch spec D4, D18, SUB-1, SUB-2
Reversible: yes
Precedent: yes — where a promise and a cost-control rule disagree, the promise
is the thing a trade was told, and it wins. The cost rule becomes a note about
what motko absorbs, not a second counter the trade has to reason about.

## 2026-09-05 — A frozen acceptance test the PM gate should have rejected is repairable by amending the branch's first commit
Decision: where an acceptance test violates a HARD repo rule that a PM-time gate
exists to enforce, and the gate let it through because of a detection gap, the
assertion may be removed by amending the branch's first commit — the only commit
permitted to touch `tests/acceptance/`. Four conditions, mirroring retirement:
the assertion must violate a stated hard rule (not merely be inelegant); the gap
that let it through must be identified and closed in the same session; the
commit message must name what was removed and why; and any CLAIM worth keeping
must be relocated, not dropped.
Rationale: this is NOT the retirement rule — nothing failed, and I am not
claiming it is. Retirement covers a contract a later item supersedes. This
covers a contract that was never validly formed, because the rule forbidding it
predates it and the only reason it exists is a false negative in the check. The
freeze exists to stop downstream agents quieting inconvenient tests; it was
never meant to make a gate's own bug permanent. Left alone, a brittle frozen
test is a permanent constraint on production code — #309 cost two days, and
CONN-1 already carries a dynamic import in `stripe-connect-section.tsx` solely
because CONN-2's frozen mocks are incomplete.
Applied to: #601 (two describes grepping `src/` for the wording of a comment and
of dashboard copy) and #599 (a describe shelling `git grep` over `src/`). #599's
claim was relocated to `src/checks/payment-gate.check.test.ts` rather than
dropped, and is stronger there — it quantifies over routes that do not exist
yet, which no behavioural test can do. Both gaps closed in
`scripts/factory/check-acceptance-static.sh`.
Guard against abuse: condition 4 of the retirement rule still governs — a
failure the card does not name is a defect, not a candidate. Every assertion
removed under this decision was PASSING. If a test is red, this rule does not
apply and the implementation is what is wrong.
Ticket: #599, #601, #607
Reversible: yes
Precedent: yes — expect it to be cited the next time a gate's blind spot freezes
something. It should stay rare: if it is invoked twice for the same class of
violation, the gate is still wrong and that is the thing to fix.

## 2026-09-05 — CLEAN-3: write off the £22 of accrued service fees
Decision: proceed. Eight jobs, £22.00, written off unconditionally. Jacob's call,
asked and answered on mobile: "Clean3 - write off the £22 in fees".
Rationale: the fees were accrued under a ladder that no longer exists. Leaving
them influences settlements and invoices under a model that has been retired.
Sequencing, flagged and accepted: spec §6 orders CLEAN-3 → CLEAN-6, and CLEAN-6
(hand-implemented) is what takes the transaction fee to zero. Landing CLEAN-3
first writes off £22 while CLEAN-6 keeps accruing behind it, so the write-off may
need repeating. Jacob was told this and chose to proceed.
Ticket: CLEAN-3
Reversible: no — this is a production data write. That is why it was escalated
rather than decided by the sweep.
Precedent: no. Each money write-off is its own decision.

## 2026-09-05 — SEC-1: remove bearer-token auth from middleware (option A)
Decision: option A, remove it. Cookie sessions only. Jacob's call: "Remove it".
Rationale: `src/lib/supabase/middleware.ts` accepts `Authorization: Bearer` on
ALL routes. It was added for a deploy health check that no longer exists, so it
is an additional way to authenticate that nothing uses. Not a bypass — every
token is validated through `supabase.auth.getUser(token)` — but the residual
risk is real: a leaked access token works for its lifetime without the session
cookie, and nothing now depends on that.
The card asked for a grep of the iOS shell and scripts before committing. Done,
5 Sep, and it comes back clean: the only `Bearer` senders in the tree are the
voice/realtime surfaces, which post to `https://api.openai.com/v1/realtime/calls`
with an ephemeral OpenAI key, and `src/lib/cron-auth.ts`, which checks
`Bearer CRON_SECRET` inside route handlers rather than in middleware. Neither
touches the middleware path, so removal breaks no known consumer.
Consequence to watch: any unknown caller using a bearer token starts getting
signed-out behaviour rather than an error that names the cause.
Ticket: SEC-1, #567
Reversible: yes
Precedent: yes — an auth surface kept only because nobody looked gets removed,
not documented. That is how `settle_fee_collection` stayed live for weeks.

## 2026-09-05 — Address lookup: Ideal Postcodes, chosen by delegation
Decision: Ideal Postcodes. Jacob delegated the choice — "pick the one that's
easiest for you to use" — between Ideal Postcodes and getAddress.io.
Rationale: UK-specific, key-based REST that needs no vendor SDK, so it can be
called with `fetch` and stubbed in tests like every other integration here. The
card lists it first and the two are close on price; ease of building is the only
axis Jacob asked me to weigh.
Not verified from here and to be confirmed at build time rather than assumed:
the current endpoint shape, and whether the documented test key still returns
fixtures without billing. If the test key exists it should be used in CI, so
acceptance tests never spend money.
Blocked on a credential either way: paid per lookup, so it needs an account and
key from Jacob before it works in production — the same shape as
COMPANIES_HOUSE_API_KEY.
Ticket: Address & postcode lookup at capture
Reversible: yes — one module behind one interface.
Precedent: yes for the pattern, not the vendor: where a choice is delegated,
pick on buildability and record what was not verified.

## 2026-09-05 — SUB becomes a sequenced programme, but not by adjacency
Decision: add "SUB" to SEQUENTIAL_PROGRAMMES, AND add an explicit predecessor
map, because adding it alone would have been theatre. Jacob's call: "Yes".
Rationale: SUB-4 and SUB-6 both act on a subscription SUB-1 creates. The gate's
default rule is "wait for index minus one", which is wrong for SUB: SUB-2 and
SUB-5 shipped on 5 Sep and SUB-3 is hand-implemented and never enters the
factory. Measured before writing anything —
`admissionBlocker("SUB-4", [SUB-1 blocked, SUB-2 shipped])` returned `null`, so
SUB-4 would have been admitted while SUB-1 was still in flight, which is the
exact admission the decision exists to prevent. A plain index-1 lookup also asks
for SUB-3 and deadlocks on a predecessor that cannot arrive.
EXPLICIT_PREDECESSORS maps SUB-4 and SUB-6 to SUB-1. Four regression tests fail
against plain adjacency and pass against the map.
Ticket: SUB-1, SUB-4, SUB-6
Reversible: yes
Precedent: yes — a programme whose order is not its numbering needs the
dependency stated, and "it has a prefix" is not evidence the order is right.

## 2026-09-05 — What "settled" means when deciding whether a job can be refunded
Decision: eligibility keys off `jobs.paid_at` and a `pi_…` `payment_provider_ref`,
never off `settlement_state = 'settled'`. Migration 68 therefore does NOT add a
`'settled'` value; it adds only `refunded` and `partially_refunded`.
Rationale: nothing in the tree writes `'settled'` — `settle-paid-job.ts` records a
settlement by stamping `paid_at` — so a gate on it is a gate nothing passes, and
the refund control would never have appeared in production. `settlement_state` is
null on a normally settled job and non-null only once something has gone
backwards.
Ticket: #611
Reversible: yes
Precedent: yes — any later item reading "is this settled?" reads `paid_at`.

## 2026-09-05 — Where a refundable amount comes from
Decision: from Stripe (`paymentIntents.retrieve().amount_received` less the sum of
`refunds.list()`), never from our own columns, and with no fallback to them when
Stripe is unreachable — the refund is refused instead.
Rationale: `invoices.amount` and `quotes.total` are numeric POUNDS while fees and
Stripe are integer PENNIES, and the first draft of this item read a pounds figure
as pennies. A 100x error in a refund path moves real money. Stripe is also the
party that accepts or rejects the refund, so its number is the only one that can
be right. A ceiling guessed from a stale cache is how money moves twice.
Ticket: #611
Reversible: yes
Precedent: yes.

## 2026-09-05 — A refund debits the trade's connected account, not motko's
Decision: `stripe.refunds.create` carries `reverse_transfer: true` and
`refund_application_fee: false`.
Rationale: payments are DESTINATION charges (`transfer_data.destination` in
stripe-payments.ts). Refunding one without `reverse_transfer` refunds the customer
out of the PLATFORM balance and leaves the trade holding the money — motko would
have underwritten every refund silently. The card is explicit that the money comes
out of the trade's account and may take it negative, and the confirmation dialog
warns them of exactly that. `refund_application_fee: false` is FEE-10's published
rule (`REVERSAL_CLAUSE.serviceFee`, stated in the contractor terms): the service
fee is not returned and is not pro-rated.
Ticket: #611
Reversible: no — money that has moved on the wrong flag does not come back by a
revert. Flagged for Jacob's review before merge; the item needs his `supabase db
push` regardless, so it cannot land without him.
Precedent: yes — REFUND-2 (staged jobs) and any later refund path inherit both flags.

## 2026-09-06 — Standard Project contract amendments applied from Jacob's marked-up PDF
Decision: the eleven amendments annotated on a rendered Standard Project contract
(ref 1EFBEDEC) are written into `STANDARD_PROJECT` in
`src/lib/contracts/templates.ts`, and into that body only. Clause 12 is replaced
outright ("Complaints and Dispute Resolution"); the other ten are additions to
clauses 3, 5, 6, 8, 9, 10 and 11. Clause numbering is unchanged, so the internal
cross-references ("clause 1", "clause 5") still resolve.
Rationale: customer-facing contractual copy is on the escalation list, so it
comes from Jacob with the marked-up source, never from an agent. He supplied the
markup and confirmed two open points directly: early start stays the
`{{cancellation_start}}` variable (not hardcoded as requested), and the liability
cap wording stands as drafted. The other four templates are untouched — the
markup was anchored to this body's clause numbers, and porting it uninstructed
would be an unreviewed change to four more customer-facing contracts.
Ticket: none — direct owner request, session
https://claude.ai/code/session_013t7gZCES9mFygjHFH2nwxH
Reversible: yes for contracts not yet sent. Contracts already signed carry the
body stored on the row and are unaffected by a template edit either way.
Precedent: yes — this is the shape a clause-wording change takes: owner-supplied
markup, one template, a decision record, and the PDF golden re-baselined in its
own commit.

## 2026-09-06 — The Standard Project amendments are ported to the other four templates
Decision: the same eleven protections now sit in `SMALL_WORKS`,
`LARGE_STAGED_PROJECT`, `REGULATED_CERTIFIED_WORKS` and `MAINTENANCE_RECURRING`,
placed against each body's own clause numbering and rendered in its own defined
terms — "the services" and "this agreement" throughout the maintenance body. No
clause was renumbered, so every existing internal cross-reference still resolves.
Rationale: Jacob asked for the port directly, closing the open question left by
the previous entry. Three places needed a judgement rather than a transcription,
and each resolved toward removing a contradiction rather than stacking one:
Large/Staged clause 3 lost "may pause work ... having given reasonable written
notice", superseded by the amendment's immediate suspension; Large/Staged clause
13 lost "total liability is limited to the contract price", superseded by the
lower-of-amount-paid-or-£2m cap; and Regulated clause 6 states the urgent-works
paragraph as an express exception to the written-agreement rule directly above
it, which on that template covers unsafe existing installations by name. Small
Works and Regulated have no completion clause, so practical completion went into
clause 2 and clause 4 respectively; Maintenance has no completion event at all,
so it is stated per visit against the services in clause 2.
Ticket: none — direct owner request, session
https://claude.ai/code/session_013t7gZCES9mFygjHFH2nwxH
Reversible: yes for contracts not yet sent; signed contracts carry the body
stored on the row.
Precedent: yes — the five bodies are now expected to carry the same substantive
protections. A future amendment to one of them should say explicitly whether it
is meant to reach the other four.

## 2026-09-06 — Small Works gets a condensed events-beyond-control clause
Decision: `SMALL_WORKS` states the same protection as the other four templates
in two prose paragraphs rather than the enumerated (a)-(k) and (i)-(iv) lists.
Every category survives — Client and their contractors, access and approvals,
late changes, hidden site conditions and hazardous materials, weather, utilities,
supply, industrial action, government and changes in law, civil unrest — and so
does the catch-all, carried by the opening "an event beyond the Contractor's
reasonable control".
Rationale: Jacob asked for it. The full list ran twenty lines on a contract for a
single-visit job that is often a few hundred pounds, which is disproportionate on
the page even where it is correct in law. Substance is unchanged, so a customer
is no worse protected and a contractor no less covered.
Ticket: none — direct owner request, session
https://claude.ai/code/session_013t7gZCES9mFygjHFH2nwxH
Reversible: yes.
Precedent: yes — Small Works is the template that may state a shared protection
more briefly. The other four keep the enumerated form.

## 2026-09-06 — Two authoring notes moved out of the maintenance contract body
Decision: the "Use this field to describe frequency…" parenthetical in clause 2
and "State clearly whether this is per visit, monthly, or annual" in clause 3 are
removed from `MAINTENANCE_RECURRING` and folded into its `description`.
`tests/regression/contract-template-authoring-notes.test.ts` now scans every
rendered body for that class of phrase, and asserts the guidance landed in the
picker rather than being dropped.
Rationale: both were addressed to the tradesperson and both rendered mid-clause
in the customer's copy — the same defect the annotations acceptance test was
written for, missed because that test matches three literal markers from the
original leak. That file is frozen, so the net is widened alongside it in a new
regression test rather than by editing it. Mutation-checked: reinstating the
clause-2 note turns the new test red.
Ticket: none — direct owner request, session
https://claude.ai/code/session_013t7gZCES9mFygjHFH2nwxH
Reversible: yes.
Precedent: yes — guidance for the tradesperson goes in `description`, and a body
scrubbed of it is expected to show it landing there.
## 2026-09-06 — Does motko return its service fee when a payment is refunded?
Decision: No. The service fee is not returned on a refund, and is not pro-rated by
a partial one. `refund_application_fee` stays false.
Rationale: this is what `REVERSAL_CLAUSE.serviceFee` already says, in the words the
contractor terms use, and what FEE-10 shipped. REFUND-1's card said the opposite
("returns its own cut"); the published clause outranks a roadmap card, so the
implementation followed the clause and the conflict was escalated rather than
resolved in code. Jacob confirmed the clause, 6 Sep.
Consequences: nothing to build. `src/lib/refund-settlement.ts` already implements
this and needs no change; the terms page is unchanged; no contractor is owed a
difference, because no refund has ever been issued under the other reading.
REFUND-1's card is corrected so the next reader is not misled by the line that
produced the conflict.
Ticket: #611, MONEY-2
Reversible: yes in principle — but reversing it is a terms change plus a rewrite of
`planSettlementReversal`, which returns fees unchanged in every branch by design,
and would owe a difference to anyone refunded in the meantime.
Precedent: yes — a published contractual term outranks a roadmap card, and the
conflict is escalated rather than resolved by whichever the implementer read last.

## 2026-09-06 — CLEAN-3 is a data migration, not a factory item
Decision: Retire the eight accrued fees by adding a `written_off` value to
`jobs_fee_status_check` and moving the rows, applied by hand as migration 73.
CLEAN-3 is reclassified hand-implemented, alongside CLEAN-6 and SUB-3, and #642
is closed rather than re-derived.
Rationale: exactly one runtime reader touches the accrued state
(`fees-statement-section.tsx:56`, `.eq("fee_status","accrued")`), so the row
move alone satisfies the item and no code changes. With no code change there is
no acceptance test that can fail first, which is why three successive
derivations were correctly blocked for tests that passed on a clean tree.
Reusing `not_applicable` was rejected: `fee-copy.ts:99` documents it as the free
allowance, so written-off fees would be described to the trade as free jobs.
Ticket: #642
Reversible: yes
Precedent: yes

## 2026-09-06 — subscription_projection shipped without RLS
Decision: Enable RLS with an owner-scoped select policy and revoke the default
anon/authenticated write grants, as migration 74. Migration 69's file is also
backfilled onto main so branches stop failing `supabase db push`.
Rationale: migration 69 created the table and never enabled RLS, so `anon` held
SELECT/INSERT/UPDATE/DELETE/TRUNCATE on it with zero policies. Table is empty and
SUB-1 is unmerged, so nothing was exposed and nothing reads it yet — but once
`subscription_status` gates paid access, an anon INSERT grants it. Must be applied
before SUB-1 merges. It was the only table in `public` without RLS.
Ticket: #614, CONN/SUB
Reversible: yes
Precedent: yes — a new table gets RLS in the same migration that creates it.

## 2026-09-07 — REF-3's "invoice" means the £9.99 subscription invoice
Decision: A banked referral month is consumed against the **Stripe subscription
invoice**, never against a row in the `invoices` table.
Rationale: `invoices` is the trade's bill to their own customer, so crediting it
would take a reward the trade earned out of their customer's payment. D23 credits
a month of motko's subscription, and that is the only monthly charge there is.
The card previously said only "the next invoice", which reads either way.
Ticket: REF-3
Reversible: yes
Precedent: yes — a credit earned by a trade is settled against what motko charges
the trade, never against what the trade charges a customer.

## 2026-09-07 — REF-3 belongs in paid-job-settlement.ts, not referral.ts
Decision: The activation-count arithmetic hooks `computePaidJobSettlement`, which
already receives `facts.activatedReferralCount` and already emits the
`referral_unlock` ledger entry. Consumption goes in a new
`src/lib/referral-credits.ts`. The card's `## Files` was corrected accordingly.
Rationale: `src/lib/referral.ts` is code generation and self-referral detection.
It touches no table and reaches no ledger, so an implementer following the old
file list would have had to build a second, parallel activation path.
Ticket: REF-3
Reversible: yes
Precedent: no

## 2026-09-07 — the cancellation play-out moves from SUB-6 to REF-3
Decision: SUB-6 ships as cancellation-only — stops renewal, access to period end,
history and the customer's links stay reachable. What happens to unconsumed
banked months at cancellation becomes REF-3's, alongside the banking itself.
Rationale: D20 promises banked months play out; that currency does not exist
until REF-3 builds it, so SUB-6 as written had no state to read and would have
produced a dead contract. Holding SUB-6 behind REF-3 would have grown the launch
set by one. Giving the rule to the item that invents the currency means there is
never a window where months exist and nothing governs them, whichever order the
two items land in — which is the failure the "out of scope naming a current
value" rule in AGENTS.md exists to prevent.
Ticket: SUB-6, REF-3 (#660)
Reversible: yes
Precedent: yes — the item that creates a unit of value owns what that value is
worth when the relationship ends.

## 2026-09-07 — REF-3's first derivation discarded rather than hand-patched
Decision: Re-derive #660 at `needs-spec`; close #662 without salvage.
Rationale: `tests/acceptance/660.test.ts` annotated eight fixtures
`const facts: mod.PaidJobFacts = {…}` where `mod` came from `await import(...)`.
A value is not a namespace, so it is TS2503 and unsatisfiable — the PM's own
guidance prefers re-derivation when a frozen test never compiled. Two further
defects made a hand-patch worse than useless: the "concurrent consumption" tests
used two separate stubbed clients each pre-loaded with a different row, so they
pass whether or not the claim is conditional, and `claimReferralCredit` leaned on
PostgREST honouring `limit(1)` on an update rather than making a single-row claim.
Ticket: #660, #662
Reversible: yes
Precedent: no

## 2026-09-08 — the fee a settled job records, when the free-jobs count moved mid-payment
Decision: Reconcile at settlement against Stripe's `application_fee_amount` on
the settled charge. The settlement RECORDS what was taken instead of recomputing
eligibility. Rejected: pinning the allowance at intent creation.
Rationale: `free_jobs_remaining` is read once to size the application fee and
again at settlement, with a bank-app redirect between them, so the two reads can
disagree — booking a debt Stripe never collected, or writing a waiver over a fee
it did. The settled charge is the only value in the sequence that is a fact
rather than a forecast, and the webhook already reads it. Pinning would need a
reservation with a TTL and a release path, and an abandoned intent would hold a
credit hostage. Accepted residual, chosen deliberately: two customers paying
inside the window can both go free, so the counter lands on zero rather than
minus one — a couple of pounds, erring in the trade's favour, against the
alternative of a record that contradicts a charge the trade can see.
Ticket: none — found in the 8 Sep pre-launch function review; SUB-3 (#674) made
it live by lifting CLEAN-6.
Reversible: yes
Precedent: yes — where a prediction and an outcome disagree about money, the
outcome is what gets recorded.
## 2026-09-08 — the PUSH-NT-PROV toast stops naming a cause it cannot establish
Decision: the `provisioning` copy reports the observation ("Apple didn't return
a token within 10 seconds"), offers the newer-build remedy conditionally, and
hands over the code. It no longer says "this build isn't set up for push at
Apple's end". `NO_TOKEN_LOG.provisioning` likewise becomes an ordered checklist
— installed build age, then Build Metadata entitlements, then apsd — instead of
a verdict. This supersedes the copy half of the 1 Sep decision; the cause union,
the `PUSH-NT-PROV` code and the toast-not-console principle all stand.
Rationale: the 1 Sep wording read as a finding, so a live incident spent two
days on Apple: entitlements, App ID capabilities, provisioning profiles, the
APNs auth key. All were already correct — App Store Connect's Build Metadata
showed `aps-environment: production` in the shipped binary and no ITMS-90078
anywhere. The actual cause was that the live App Store build was 1.0(1) from 17
July while its WKWebView loaded the current web app from motko.app; a TestFlight
install of the 2 Sep build took a token immediately. `classifyNoToken` could
never have known: `pluginResolved` tests the JS proxy, which is truthy in a
browser too, so `provisioning` is the bucket every native failure falls into.
Ticket: n/a — reported by the owner 2026-09-04, resolved 2026-09-08
Reversible: yes
Precedent: yes — a diagnostic may name only what it observed. A bucket that
catches everything is not a diagnosis, however narrow its name sounds.

## 2026-09-08 — a stale native shell against a live web app is the failure mode to check first
Decision: when native push (or any Capacitor bridge behaviour) misbehaves in
production, establish which build is LIVE before investigating anything
Apple-side. App Store Connect > the version's build number is the fact; Xcode
archives are not, because Xcode signs archives with a development identity and
distribution signing happens at export, so an archive's entitlements do not
describe what shipped.
Rationale: motko.app is loaded remotely by a WKWebView, so the JS half updates
on every Vercel deploy while the native half is frozen at the last released
build. That asymmetry is invisible from the repo — `ios/` describes a binary
nobody has installed — and it is what made "worked before, broke at App Store
launch" look like a signing regression. Builds 2–5 had been uploaded and never
released; the July binary served every user for seven weeks.
Ticket: n/a — same incident
Reversible: yes
Precedent: yes — check the deployed artefact before the configuration that
produced it

## 2026-09-08 — sendApns must not throw, and failed registrations get a server-side record
Decision: `getProviderToken` is called once in `sendApns`, inside a try/catch,
and passed into `postOnce`; an unusable key resolves as
`{ ok: false, gone: false, reason: "InvalidProviderKey" }`. A new authenticated
route, `/api/push/diagnostics`, records `no-token` and `error` registrations to
`events` as `push_registration_failed`, carrying the four runtime facts and no
device token.
Rationale: signing happened inside the `new Promise` executor building the
request headers, where nothing caught it. A malformed `APNS_PRIVATE_KEY`
therefore rejected, escaped a function documenting "Never throws", propagated
through the `Promise.all` in `sendPushToUser` and left `/api/push/test` as a
500 — so one bad env var silenced every device's push, on webhook sends for
signature and payment, not just the test button. `gone` stays false throughout:
our credential being broken says nothing about the phone, and pruning over it
would re-open the deletion bug the 1 Sep gateway fix closed. The diagnostics
route exists because the facts identifying the fault already existed and went
to `console.error`, which a downloaded build cannot surface — the toast remains
the signal that changes behaviour, this is the evidence behind it.
Ticket: n/a — same incident
Reversible: yes
Precedent: yes — "never throws" in a fan-out is a contract, and a fan-out over
Promise.all makes one caller's exception everyone's outage

## 2026-09-08 — the APNs credential guard goes in the deploy path, not src/checks/
Decision: `prebuild` runs `scripts/ci/check-apns-config.ts`, which REPORTS the state
of the APNs credential on every deploy and never fails the build. Absent config is
reported as absent (dev and preview legitimately have none); half-configured counts
as unusable, not absent.
AMENDED the same day: the first version exited 1 on an unusable key and the first
Vercel deploy after it went red. Whatever the precise cause there, the blast radius
was the lesson — a push-notification credential had been given the power to stop
every deploy, including the one that would fix it. The delivered signal is the daily
notification-health email (P0-2), not this; this is the loud line next to it.
Rationale: a malformed APNS_PRIVATE_KEY threw from inside the promise executor in
`postOnce`, escaped a function documenting "never throws", and surfaced as a failed
action in five flows — quote first-view, accept, contract sign, mark-as-paid, and
every push send — each after its write had committed. The key had been unusable for
an unknown period and nothing said so. The natural home, `src/checks/`, runs under
`vitest.live.config.ts`, which loads `tests/setup.ts` and so mocks
`@/lib/supabase/admin`; that lane has been red since 30 Aug, and a guard nobody can
read is not a guard. A P0 does not wait on repairing it.
Ticket: P0-1 of the 8 Sep launch remediation; the broken live-checks lane is its own.
Reversible: yes
Precedent: yes — a check belongs where it is read, not where it is tidy.

## 2026-09-08 — job-level work items are added alongside room-level, never replacing
Decision: `sow_json` gains an OPTIONAL job-level `work_items` array. Room-level
`work_items` stays required. The new field is never made required.
Rationale: scope repeated into every room is scope the trade may be held to on an
accepted document, and the schema currently cannot express "applies to the whole
job", so the model duplicates job-wide facts across rooms. Making the new field
required would break frozen acceptance fixtures and force a migration of live rows
while buying nothing: absent reads as "no job-level scope", old rows are correct
unchanged, and `mergeSowDelta` needs no modification.
Ticket: P1-5 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — widen a schema by addition; a required field is a migration.

## 2026-09-08 — materials supply is a binary, not a list of item names
Decision: `materials_supply` becomes customer-supplied or trade-supplied. The
checklist question changes to match and stops inviting a per-item split.
Rationale: decided in the owner's original testing notes and carried forward as open
in error. The current shape stores two arrays of item strings, so "plaster" is the
schema working as designed rather than the model over-reaching.
Ticket: P2-15 of the 8 Sep launch remediation
Reversible: yes
Precedent: no

## 2026-09-08 — notification delivery status ships with the wrap; the outbox follows
Decision: option (a). A persisted delivered/failed status is a hard condition on the
notifier hardening and ships in the same PR. The full outbox — retry, backoff, a
surface — is a post-launch ticket and does not gate launch.
Rationale: wrapping every notifier converts a loud failure into a silent one, and a
trade who never learns their quote was accepted has a business failure, not a logging
gap. The status is what makes "was this trade ever told?" answerable, and gives the
outbox history to backfill from. Sentry is not the mitigation.
Ticket: P0-2 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — a side-effect made non-throwing must become observable in the same
change, or the silence is the new defect.

## 2026-09-08 — paid_at is a London calendar date, compared as a date
Decision: `paid_at` is a business-local calendar date in `Europe/London`, inclusive
of today, extending ninety days back. Validity is decided by comparing yyyy-mm-dd
strings, never by comparing instants. Today records the real instant; a past date is
anchored at noon UTC, which falls on the same London day under both BST and GMT.
Rationale: the previous rule parsed the picked date at noon UTC and asked whether
that instant was in the future, which is wrong in both directions every day. Today
was unselectable until 13:00 BST — the defect a trade hit at 07:03 on 8 Sep marking
a cash job paid — and a payment taken at 00:30 BST (23:30 UTC the day before) was
refused as future-dated. The window edge also slid with the time of day, so the
ninetieth day was in or out depending on when the form was opened. The timezone is
now named rather than read from `getTimezoneOffset()`, which returns the SERVER's
offset: UTC on Vercel, so the bug was invisible in production and would have
appeared the moment anything ran elsewhere.
Ticket: P0-3 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — a business date is a calendar date in a named timezone; comparing
it as an instant is a bug even when the arithmetic looks right.

## 2026-09-08 — customer-facing routes get their own error and not-found boundaries
Decision: `/q`, `/c` and `/i` each carry an `error.tsx` and a `not-found.tsx` of
their own. `src/app/error.tsx` remains the contractor-facing boundary. Both now
surface Next's error `digest` so a user's report can be joined to a server log line.
Rationale: one boundary rendered "That didn't load — check your connection and try
again" for every uncaught error in the app, including to customers, for whom all
three clauses are wrong: the fault was ours, their connection was fine, and they had
no way to tell a broken link from a broken server. It also made the 8 Sep triage
expensive — five distinct-looking defects were one bug, and every one of them
rendered the identical screen, so nothing on the page distinguished them. The
not-found copy must never disclose that an account was erased: `/q/[id]` answers an
erased trade's documents with the same neutral page as a mistyped id, and wording
that leaked it would undo that at the last step.
Ticket: P0-4 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — a screen shown to a customer is written for the customer, and an
error surface that cannot be quoted cannot be diagnosed.

## 2026-09-08 — the captured site address reaches the contract; a blank one is not printed as "at :"
Decision: `contractPrefillFromJob` gains `site_address`, and the job page builds its
contract prefill on top of that shared helper instead of beside it. `SMALL_WORKS`
wraps its address in a `{{#site_address}}` section, matching every other optional
variable in the same file. The statement of work says "Not captured" where it used
to say "Same as customer address".
Rationale: eleven of the eighteen quotes ever sent from this account carry no site
address. The cause was not capture — it was that the job page, the only route to
"Send a contract to sign", constructed its own prefill and passed neither the
address nor the phone, while the dashboard's copy of the identical form went through
the shared helper and passed both. A signed Small Works contract with no address
then read "…carry out the following work at :", because that one variable was
interpolated bare mid-sentence. The SOW's fallback named a field that does not
exist: `render-sow.ts` merges the single captured address INTO `site_address`, so
when the fallback fires there is no customer address for the site to be the same as.
Ticket: P1-6 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — two constructions of one prefill is how the surface that matters
ends up the poorer of the two; and an optional variable inside a sentence is wrapped
in a section, never interpolated bare.

## 2026-09-08 — `site_address` stays out of `unasked_required` and out of `wrap_incomplete`
Decision: the third declared customer-detail slot is left uncomputed. It keeps its
entry in `UNASKED_REQUIRED_IDS`, `CustomerDetailSlot` and `CUSTOMER_DETAIL_LABELS`,
and no code produces it.
Rationale: spec 373 promised it would be "reported separately and never blocks", and
`tests/acceptance/373.test.tsx:84` freezes `getMissingCustomerDetails` never
returning it — so any report has to be a sibling path. The only surface that would
carry it is the job page's wrap banner, which is gated on `wrap_incomplete`; putting
the address there means either making it blocking (contradicting 373 and the
recorded note in `customer-details-guard.ts`) or ungating the banner, at which point
it fires on the ~60% of jobs with no address and stops being read. The prefill fix
above removes the need: the address the contractor typed on the quote now reaches
the contract by itself, so the gap this report would have announced no longer costs
anything. Revisit if the rate falls and the banner would be rare.
Ticket: P1-6 of the 8 Sep launch remediation
Reversible: yes
Precedent: no

## 2026-09-08 — the statement of work is a record, not a second agreement
Decision: the SOW PDF's acceptance strip and customer signature line are removed,
and its hardcoded footer default ("Based on a recorded conversation with the
customer. Verify scope on site before starting work.") goes with them. The footer
now prints the contractor's own terms or nothing, matching the quote and contract
documents, neither of which carries a default.
Rationale: the contract is the signature point and the only document with a price,
payment terms, a cancellation right and a governing law — a signature collected on
the SOW instead is a signature on an agreement missing all four. The route serving
this PDF is authenticated and tenant-scoped because it is an internal contractor
document, so the product could not collect the signature it invited; what it
invited was a contractor printing the page and collecting one by hand. The footer's
first sentence disclosed provenance the reader was never owed and the document
cannot vouch for (a SOW may be edited long after any call, and jobs exist with no
recording); its second was advice to the contractor printed where a document puts
its terms.
Ticket: P1-7 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — one signature surface per job, and a document does not narrate
how it was produced.

## 2026-09-08 — the business-profile warning names the field and links to the section
Decision: the dashboard's "Your business details are missing: …" banner now leads with
the field ("Contracts you send won't state your business structure"), drops the claim
that contracts "will have gaps", and links to `/setup#setup-legal` labelled with that
section's own title. `Disclosure` gained an `id` on its root so the anchor resolves.
The check itself is unchanged.
Rationale: the field WAS named in the old copy — after a colon, reading as a gloss on
the phrase the sentence opened with — so what a reader carried away was the category.
There is no "Business details" section to find: all three required fields sit in one
Disclosure titled "Legal & contract details", closed by default, among five other
closed sections, and the root had no id so `#setup-legal` resolved to nothing and the
link could only land at the top of the page. "Will have gaps" also overstated it —
every one of these variables is section-wrapped in the contract templates, so an
absent one is omitted cleanly; the cost is that the contract does not state the thing.
Production bears out the check: of the twelve contractor rows, the three newest all
lack `business_structure` while every account created in July has it.
Ticket: P1-8 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — a warning names the field in the words its own settings screen uses,
and links to the section rather than the page.

## 2026-09-08 — working_dates reaches the contract, parsed only where it is unambiguous
Decision: `labour_plan.working_dates` is parsed into a start date and seeded into the
contract form, which also derives the completion date when a duration is known. The
parser accepts an explicit day-and-month only; anything relative ("next Wednesday"),
any month with no day, and any cross-month range whose leading month is unstated are
refused, and the captured phrase is shown as a hint under the field instead. Duration
and start are now derived by one shared helper (`contractTimingFromJob`) used by both
routes to the form.
Rationale: `working_dates` is captured on most jobs and was read by nothing, so every
contract's start date opened empty and `build-variables.ts:180` printed "To be
confirmed". The 8 Sep job carried duration_days 10, working_dates "1st October to 5th
October…" and deadline.job_by "before the end of October" — three real answers behind a
document that stated none of them. Parsing prose onto a signed document is the risky
direction, so the parser refuses far more than it accepts and never returns a past
date; the hint covers everything it declines at no risk. The dashboard's copy of the
form was also passing no duration at all (its query never selected sow_json), the same
two-constructions divergence as the contract prefill.
Ticket: P1-9 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — parse only what is unambiguous, and show the contractor what was said
for everything else rather than guessing or leaving a blank field.

## 2026-09-08 — shared room scope is de-duplicated at RENDER, and the capture-side change is dropped
Decision: `splitWholeJobWorkItems` lifts work items that appear in EVERY room out of
the rooms and states them once, under "Throughout", on the customer's quote. The
capture-side half of P1-5 — an optional job-level `work_items` on the SOW, agreed in
the rev-3 review — is NOT built, and leaves the launch scope.
Rationale: Jacob confirmed there are no live signed contracts, only test accounts, which
removes the remediation question and voids the "liability on an accepted document"
ranking the plan gave this item. What remains is pre-launch correctness, and on that the
two halves are not equal. The capture-side change only ASKS the model to use a new slot,
and #373's own problem statement is that a rule living in a 7,680-character instruction
string is "instruction dilution, not a check"; it would also give one fact two homes, so
every consumer would have to merge them — the same "two constructions of one thing"
shape that produced the missing site address (P1-6), the unreachable Setup section
(P1-8) and the blank contract dates (P1-9) in a single week. The render-side rule is
deterministic and adds no second source. Revisit capture-side after launch if real data
shows the lift is insufficient.
The lift requires an item to be in EVERY room, never a majority: an item in four rooms
of five stays put, because lifting it would put work on the document for a room that
never agreed to it — the same defect pointing the other way. Rooms emptied by the lift
are kept, since which rooms the job covers is what the customer needs; rooms that
carried nothing to begin with are still dropped, as before.
Ticket: P1-5 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — prefer a deterministic render-side rule to a prompt that asks the model
to behave, and do not create a second home for a fact without a forcing reason.

## 2026-09-08 — the quote page states the work, not only the price
Decision: `/q/[id]` now selects `sow_json`, builds `buildQuoteScope` and renders it above
the priced table, via a new `QuoteScopeSection`. Option (iii) of the plan's §6 —
inline — over attaching the statement of work.
Rationale: the page carried a heading, a priced table, a total and an Accept button, and
nothing that said what the work was; in fixed-price mode a single line reading "<trade>
works as described" over one figure, described nowhere the customer could reach. The
quote PDF has carried the scope for a while, but a PDF the customer may never open is
not the artefact the acceptance binds to — the button is on the page. Attaching the SOW
(option i) leaves the accepted document still silent, and exposes contractor-directed
language `contractor-language.ts` exists to keep off customer surfaces; a customer-safe
variant (ii) is a second document that can drift invisibly.
`buildQuoteScope` is the source because it is already the narrowed projection — "the
list of things a customer is allowed to read" — so the SOW's contractor-only channels
stay off this surface by construction, and the page and the PDF cannot state different
scope: two presentations, one derivation.
NOT done, deliberately: freezing the scope at send, the way `sent_total` freezes the
price. It would need a column and therefore a migration applied to prod before merge.
It is also not needed today — the only writer of `sow_json` that can run on a SENT quote
is `setQuotePricingMode`, and it replaces `pricing` alone, which `buildQuoteScope` does
not read. Revisit if a path ever edits scope after send.
Ticket: P1-10 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — what a customer accepts must state the work on the surface the accept
control is on, not in a document they may never open.

## 2026-09-08 — SMS links end their line, and the bodies stay in GSM-7
Decision: all four SMS senders compose their body as lines, so the URL ends a line and
nothing is punctuated onto it. The em dash goes with the restructure.
Rationale: NOT a fix for an observed break — the 8 Sep "broken quote link" was blamed on
a trailing full stop and the production logs refuted it (clean UUID, same Next.js digest
as an unrelated /dashboard failure; the real cause was P0-2's unguarded notification).
This must never be cited as evidence that a trailing stop broke a link. It is worth
doing anyway: handset and carrier link detection is outside this codebase's control and
untestable here, a link is the whole point of the message, and a line break costs
nothing. The second half is measurable rather than speculative — an em dash is not in
GSM-7, and one such character forces the whole message to UCS-2, halving the segment
from 160 characters to 70, so these were being split and billed roughly twice over.
The bodies stay composed inside each sender rather than moving to exported builders:
`tests/acceptance/lifecycle-send-dispatcher.test.ts` slices sms.ts from each sender's
declaration to its return looking for the STOP line, and it is frozen. Extracting the
literal broke it, so the assertions go through the wire instead — stubbing fetch and
reading the Body actually posted to Twilio, which is a better check anyway.
Ticket: P2-11 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — when a frozen test's premise blocks a refactor, adapt the change and
assert closer to the wire; never contort the code to satisfy a source grep.

## 2026-09-08 — noise is not a turn, and the re-greeting is NOT fixed by it
Decision: `carriesContent` drops any transcript turn with no Latin letter and no digit,
in `appendTranscriptTurn` and at the flat-transcript push in job-intake.tsx. VAD
eagerness is NOT touched.
Rationale: reproduced exactly on job f453b3ae — assistant opener (37 chars), contractor
turn of ONE character (U+C544, 아, a Korean syllable transcribed from a breath),
assistant repeating the identical opener verbatim, then the real answer. Transcription
is already pinned to English because auto-detect "mis-fires on ... short utterances", and
the pin did not save it, so language or length is not where this is caught. The rule is
content, not length: "No" and "10" are answers and a length cut-off would eat them.
This matters beyond tidiness because the transcript is an INPUT — extractStatedPrices
reads contractor speech for figures, and the usual hallucination-on-silence is "Thank
you." or "you", not a Hangul character.
WHAT IT DOES NOT DO: stop the model re-greeting. That turn is created by the Realtime
server's semantic_vad and answered before any of this code runs. The only lever is VAD
eagerness, and job-intake.tsx's own threshold comment forbids tuning it on a hunch —
"capture micLevel in a quiet room and a busy one first". That needs a measured change on
a real handset and is not in this item.
Ticket: P2-12 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — filter transcriber noise on content, never on length; and do not tune a
third-party VAD blind to close a defect you can only half-reach.

## 2026-09-08 — the agreed-costs question becomes required
Decision: `agreed_costs` joins `REQUIRED_CHECKLIST_QUESTIONS`. `deadline` stays
nice-to-have. Authorised by Jacob, who also named the two fixtures in
`tests/acceptance/81.test.ts` that the promotion widens.
Rationale: the question was displayed and dropped — null on 13 of 14 completed SoWs in
production, with `declined_slots` empty on every recent one, so never asked rather than
refused. It concerns money beyond the missing field: `agreedPriceDisagrees` is the
send-time guard for the two independently-stored figures for one job disagreeing (it
exists because a quote went out reading "at a fixed price of £5,000" above a £5.00 line)
and it returns false when EITHER is absent, so it was dead on almost every job.
Safe because "answered" is the OBJECT'S PRESENCE, not any figure: update_sow already
says to set it empty when nothing was agreed, and a deflection lands in declined_slots,
which the checklist filters. Neither can trap a wrap. The assistant-question cap is 12,
so a fifth required slot has room.
The two frozen fixtures were widened, never their assertions — the same move D12 made
for working_dates, recorded in that file's own comment. All-null preserves what those
fixtures already implied, and all 15 tests in 81 pass unchanged.
Ticket: P2-13 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — a slot answered by object-presence can be promoted to required without
risk of trapping a wrap; and a frozen fixture is widened only after the card names it.

## 2026-09-08 — who supplies materials is stated, not inferred from an empty list
Decision: `materialsSupplySchema` gains `responsibility: "contractor" | "customer" | "split"`,
OPTIONAL with no default. The checklist question asks the binary first and the arrays
itemise only a genuine split. `materialsResponsibility` prefers the stated answer and
falls back to the old list-derivation for rows that have none.
Rationale: P2-15 was carded as a granularity preference. Production says it is a
correctness defect. Job f453b3ae (£7,200 plastering) captured customer_supplied
["plaster"], contractor_supplied [] — the contractor said the customer was bringing the
plaster, which is the natural way to say it — and the derivation read the empty list as
"the contractor supplies nothing", so the contract clause renders "Materials will be
supplied by: **Customer**". That allocates the materials cost to the wrong party on a
document somebody signs. Job 7215aa49 has the same shape. Jacob chose option 3 (binary
first, itemise only on split) before this evidence surfaced; it is the right shape for it.
OPTIONAL rather than nullable-with-default, following `pricing.mode` in sow.ts and its
recorded reason — "an absent mode is now absent" rather than a guessed value. Absent here
means the row predates this or the question never landed, which is exactly what the
legacy branch must receive, and it is pinned by tests rather than assumed. It is not the
PFIX-4 trap that made `has_pricing_history` dangerous-when-absent: there omission took the
UNSAFE branch; here it takes the intended one. It also keeps every existing fixture valid,
so no frozen acceptance test needs widening and the pipeline harness's recorded prompt
hashes still match — a null key serialised into every prompt invalidates them, and
re-recording needs live model calls this session cannot make.
Legacy rows are read exactly as before, deliberately, including the customer-only shape
that was misread. Reinterpreting stored data would be a worse defect than the original.
Ticket: P2-15 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — an answer that may not have been given is optional with no default, and
a document states what was said rather than what an empty array implies.

## 2026-09-08 — a missing Capacitor plugin must not take down the page that uses it
Decision: `Browser.addListener` in `stripe-connect-section.tsx` is wrapped in try/catch,
and its cleanup guards both the absent listener and a rejection on removal.
Rationale: ios/App/Podfile declared 7 pods against 13 in package.json, so six plugins —
Browser among them — were compiled out of the shipped app, and every call into one throws
"Browser plugin is not implemented on ios". `Browser.open` was already guarded and
degrades to window.location, so Stripe onboarding survives; the unguarded `addListener`
fires on MOUNT, so the section threw the moment a native user opened Settings and the
guarded call below never got the chance to degrade. My earlier framing that this "breaks
Stripe onboarding" was wrong on both counts and is corrected here.
The Podfile is fixed alongside it, but a rebuild only reaches users who update, so the
guard is what holds for everyone on a shipped binary — and for whatever plugin is missing
next. Attaching the listener is an optimisation (it refreshes Stripe status when the
in-app browser closes); losing it costs a manual refresh, not a working page.
Ticket: follow-on from P2-14 of the 8 Sep launch remediation
Reversible: yes
Precedent: yes — a native plugin call is guarded at every site, not only the one that
looked user-triggered, and the guard degrades the feature rather than the page.

## 2026-09-08 — two frozen contracts disagreed about whether src/lib/google-maps.ts may exist
Decision: Retire ONE assertion — `tests/acceptance/676.test.tsx`'s
`describe("google-maps.ts removal")` / `it("google-maps module no longer
exists")`. Keep `tests/acceptance/106.test.ts` and keep the module, stripped to
the two pure exports #106 imports. Rejected: retiring #106's "Integration with
placeToStructuredAddress" block (11 tests, 16 assertions) and deleting the file.
Rationale: #676's frozen test asserted `import("@/lib/google-maps")` rejects,
while #106 line 3 imports `placeToStructuredAddress` and `PlaceResult` from that
exact path — mutually exclusive, both frozen, no implementation satisfies both.
The retired assertion is about a file's existence rather than behaviour any user
or caller can observe, and #676's roadmap card asked for getAddress.io lookup at
capture, never for the module's deletion. #106's subject is `normalizeUkPostcode`,
which #676 does not touch. What remains in google-maps.ts is pure functions: no
Maps API client, no key, no network call.
Ticket: #676
Reversible: yes
Precedent: yes — where a frozen "this file no longer exists" assertion collides
with a frozen import of that file, the existence assertion is the one that goes.
It tests a spelling; the import tests behaviour still in use.

## 2026-09-09 — the address-lookup key name, and why an unprefixed one cannot work
Decision: `NEXT_PUBLIC_ADDRESS_LOOKUP`. The client module, the spec, the frozen
test's stub name and `.env.example` all move to it, and the Vercel var is renamed
to match. Rejected: `ADDRESS_LOOKUP` as the card asked, and a server-side proxy.
Rationale: the lookup runs in the browser — `src/lib/getaddress.ts` returns null
when `typeof window === "undefined"` and its only importer is a client component —
and Next.js inlines only `NEXT_PUBLIC_*` into the client bundle, so an unprefixed
name reads as `undefined` there. Neither name in the tree could ever have worked:
the spec said `ADDRESS_LOOKUP` (unreachable), the frozen tests stubbed
`NEXT_PUBLIC_ADDRESS_LOOKUP_KEY` (never set). Both failed into the same silent
degradation to a plain text input — no error, no Sentry event — so the feature
would have shipped looking healthy and never called the vendor once.
Accepted cost, chosen knowingly: the key ships in the client bundle and is
readable and spendable by any visitor, against a service billed per lookup. The
proxy that would have kept it secret needs the frozen browser-side assertions
retired and an Engineer cycle; the exposure is bounded by restricting the key to
our domains at the vendor, which is what the Maps key it replaces already did.
Ticket: #676
Reversible: yes — moving to a proxy later is additive, and rotates the key.
Precedent: yes — a browser-read secret carries `NEXT_PUBLIC_` and is treated as
public from the moment it is named. If it must stay secret, it does not go in a
client module at all, whatever it is called.

## 2026-09-09 — one agreed price applies at a time, ordered rather than chained
Decision: `agreed_costs.fixed_price` and `pricing.fixed_amount` both stay. In
"fixed" mode the agreed figure no longer scales the breakdown
(`agreedFixedPriceInEffect` in `src/lib/agreed-costs.ts`); outside fixed mode it
scales exactly as before. Jacob chose this over collapsing the two fields.
Rationale: rev 5's B2.4 read them as one concept with opposite semantics and said
pick one. They are not one concept — they answer "was anything already agreed
with the customer?" and "how do you want THIS priced?", and each drives a
defensible behaviour: scale the breakdown onto a promised figure with the
itemisation intact, versus collapse the defined works to one line. Deleting
either destroys a capability nothing else provides. The defect was that both were
applied in sequence, so the scaling never reached the customer and its only
surviving effect was on `drafted_line_items_json` — quote 8c072bc2 carries three
drafted lines scaled to £200 under a single £200 works line, so leaving fixed
mode hands back a breakdown nobody priced. It also blinded `absorbedByFixedPrice`
(B2.2, shipped two commits ago): comparing against a breakdown already scaled to
the OTHER stated figure made the two equal where they agreed (guard silent on
exactly the jobs carrying absorbed work) and made "the priced work came to £X"
false where they disagreed. No price moves: in fixed mode the active line is
`pricing.fixed_amount` either way, which the tests pin.
Production at decision time: 63 jobs, 24 with a SoW, `agreed_costs.fixed_price`
set on 1, `pricing.fixed_amount` on 8, both on 1 and in agreement. That 1-in-63
is a pre-promotion number — P2-13 made the agreed-costs question required on
8 Sep, so the model is now asked on every call and a contractor who says "call it
two grand" then hears "anything agreed on cost?" will say it twice.
Collapsing the fields remains available as a product decision, but it cannot land
on this branch: `tests/acceptance/81.test.ts:227,253` build
`{day_rate, fixed_price, deposit_amount}` literals, and removing a field NARROWS
a frozen fixture — retirement only, first commit only.
`agreedPriceDisagrees` is untouched and is now the only thing acting on two
figures for one job disagreeing.
Ticket: B2.4 of the remediation plan rev 5
Reversible: yes
Precedent: yes — where two fields hold the same kind of value for one job, order
which one governs rather than applying both and letting the last writer win.

## 2026-09-09 — a clean wrap means we know, not that we asked
Decision: `wrap_incomplete` / `unasked_required` are derived once, in
`finishConversation`, from the final SoW state — not accumulated by whichever
wrap branch remembered, and never filtered by `askedRequiredSlotsRef`. Asked-once
still governs whether the detour re-asks (D14 and the shipped Task D design are
untouched); it no longer governs what the call claims to know. A slot the
contractor declined still does not flag — `getUnansweredChecklistQuestions`
filters declines upstream.
Rationale: the flag was set in exactly two branches (channel-already-gone, and
the detour timeout) and both computed it from the set filtered by asked-ness, so
a slot asked once and never answered vanished from the flag as well as from the
detour. Production since the flag shipped on 1 Sep: 7 calls, of which 3 ended
`wrap_incomplete: false` with `unasked_required: []` while missing 3–4 required
slots each — 30faef2a and 0662f78c both without a crew answer AND without
materials. `declined_slots` is empty on all 24 SoWs in the table, so none was a
refusal. `sendResponse` now reports whether the response actually went out, and a
detour whose ask was swallowed by a non-open channel concludes instead of marking
the slots asked and waiting out the backstop.
Ticket: N2.2 of the remediation plan rev 5
Reversible: yes
Precedent: yes — a completeness flag is derived from state at the single point
every path funnels through, never accumulated by the branch that noticed.

## 2026-09-09 — N2.3 is a no-op; `pricing` is already gated through `duration`
Decision: `pricing` is NOT added to `CHECKLIST_QUESTION_IDS`. No code change.
Rationale: rev 5's N2.3 and the RCA's Group 3 both say "`pricing` is not a
checklist slot at all — the gate can never hold a wrap for it". That premise is
false. `duration` IS the merged duration/pricing-mode slot, it is in
`REQUIRED_CHECKLIST_QUESTIONS`, and `isDurationSlotAnswered` already refuses to
count it answered until the mode's companion value is present — `fixed_amount`
for "fixed", `duration_days` for "days". Production agrees: across all 24 SoWs,
zero jobs have mode "fixed" without a `fixed_amount` and zero have "days" without
`duration_days`, and every job since 19 Jul has a mode set. Adding a second slot
for the same question would duplicate the gate, need entries in
`CHECKLIST_QUESTIONS`, `CHECKLIST_SLOT_LABELS` and the `declined_slots` enum, and
widen two frozen fixtures in `tests/acceptance/81.test.ts` — for no behaviour.
The failure the RCA attributed to it (a fixed-price job reaching generation with
`fixed_amount` set to a component figure) is a WRONG value, not an absent one; a
presence gate cannot catch it, and B2.2/B2.3 are what address it.
Ticket: N2.3 of the remediation plan rev 5
Reversible: n/a — nothing changed
Precedent: yes — read the premise before the argument; a gate said to be missing
may be present under another name.

## 2026-09-09 — a quote edit restates the fixed price it edits
Decision: `updateQuoteLineItems` writes `sow_json` as well as `line_items_json`.
In fixed mode, editing the defined-works lines sets `pricing.fixed_amount` to
their new total (`fixedAmountAfterEdit` in `src/lib/pricing-mode.ts`). It stands
down outside fixed mode, when no amount was ever stated, when the figures already
agree, and when the defined works come to nothing — `pricingSchema` requires a
positive amount, so writing 0 would produce a row that fails its own parse.
Provisional sums are excluded on both sides.
Rationale: this is the months-old divergence, and the fourth instance of the
pattern this board keeps repeating — the response to the original incident was
`reconcileStatedPrice`, a DETECTOR, and the divergence itself was left in place.
The incident is in stated-price-guard's own header: a switch to fixed seeded
`fixed_amount` from the calculated subtotal at £5,000, the works line was then
edited to £5.00, and the quote was sent and ACCEPTED at £6.00 gross. In fixed
mode the defined works ARE the stated price, so editing them restates it; holding
the old figure records a price nobody chose.
NOT a price change: `total` is computed from the edited lines either way and the
customer is charged the same either way. What moves is a stored figure that was
contradicting the one being charged. The narrative guard
(`narrativeExceedsSubtotal`) is untouched and still catches prose stating a
figure the lines do not support, which is the other half of that incident.
Two statements, no transaction, quote first — the ordering and the guard
`setQuotePricingMode` already records, for the same reason. A failed SoW write
throws `FIXED_PRICE_NOT_RECORDED` rather than being swallowed: silently failing
this write puts the stale figure straight back behind edited lines and reports
success. The write is keyed on the quote's own `job.id`, never the `jobId` off
the wire, because this action now mutates a job row.
Supersedes one assertion in `tests/regression/stated-price-reconciliation.test.ts`
("flags an edit that walks the works line away from the stated price"). Its
stated purpose — that the writer has sight of `sow_json` — is not retired but
strengthened; what is retired is expressing it as a raised flag, which was the
only action available while the divergence was merely detected. Rewritten in
place to assert the reconciliation and the SoW write, plus a second case pinning
that an edit needing no restatement still writes one row.
Ticket: N3 of the remediation plan rev 5
Reversible: yes
Precedent: yes — where a stored figure and a computed one describe the same
thing, the writer that changes one updates the other; a detector is not a fix.

## 2026-09-09 — the contract banner names the channel it actually used
Decision: `createContract` returns per-channel delivery (`email`/`sms`, mirroring
`sendQuote`), `create-contract-form` carries it as `?channels=` on the redirect,
and `buildSentBanner`'s contract branch renders `channelSuffix` instead of a
hardcoded "(email)". Its not-delivered copy changes from "We couldn't email the
contract to X" to "We couldn't reach X".
Rationale: rev 3 read this as hardcoded copy; the rev 5 RCA corrected that to
"the copy is data-driven, the defect is in what the send passes as `channels`"
and marked it Needs-more-evidence. BOTH were true, in different places, which is
why fixing only one would have changed nothing on screen: the contract send
passed no `channels` at all (`channels=` appears once in the tree, on the quote
path), AND the contract branch ignored `channelSuffix` and hardcoded "(email)".
The send has been dual-channel since notify-customer's contract path stopped
being `if (email) { … }`, so a contract texted to a phone-only customer announced
itself as an email and one that failed to text blamed an address that customer
may not have. Third instance of the N4.1 shape: the reason exists in the
response and a layer above throws it away and substitutes a guess.
An unknown channel set now renders NO channel rather than a guess — the
already-sent redirect carries none (nothing was sent on that attempt and the
original send's channels are not known there), and the client reads
`res.email?.delivered` optional-chained because a Server Action's client and
server halves are not swapped atomically: during a rolling deploy a new bundle
can call the previous action, and the degrade must be an empty channel list
rather than a crash on a send.
Two existing tests superseded, both editable and both rewritten in place rather
than deleted: `src/app/jobs/[id]/sent-banner.test.ts` pinned the hardcoded
"(email)" while its own fixture said "(email · text)", and
`tests/regression/contract-send-terminal-state.test.tsx` pinned the exact
redirect URL and its `createContract` double had drifted from the real return
shape. The frozen `tests/acceptance/442.test.tsx` exercises only the quote
branch and is untouched.
Ticket: N5 of the remediation plan rev 5
Reversible: yes
Precedent: yes — a surface names a channel only from a per-channel result it was
actually handed; where it has none it names none.

## 2026-09-09 — the setup deep link opens the section it points at
Decision: `Disclosure`'s auto-expand matches the hash against its OWN id as well
as against elements inside its content — `hash === id || contentRef.current
.contains(target)`. No new mechanism; the existing one was inert for the only
link that uses it.
Rationale: rev 5 carded N6 as "optional: auto-open the linked Disclosure", on the
premise that no such behaviour existed. It did, and had since P1·8. The bug is
that the `id` was deliberately moved to the ROOT element so `#<id>` anchors to
the heading (the content div is max-height:0 while collapsed, so an anchor into
it scrolled to nothing) — and the expand condition still asked only whether the
hash target sits INSIDE `contentRef`. A node does not contain its own ancestor,
so `/setup#setup-legal`, the href every `businessProfileGapMessage` sends a
contractor to, scrolled to the section and left it shut. Nothing caught it: no
test covered the deep-link path at all, so the feature shipped and stayed inert.
This is the mechanism behind the 8 Sep report — a trade followed the link, saw
only the sections already open, found the details he had gone looking for present
in them, and concluded the app was broken.
Everything else in N6 is confirmed correct and unchanged: `business_structure` is
genuinely absent from that profile, `missingContractProfileFields` is right, and
P1·8's banner copy is right. The item was (d)-classified on the validator and the
copy, and that classification holds — the defect was one condition below both.
NOT done: `COMPANIES_HOUSE_API_KEY` returns 401. That is an expired or invalid
key, an environment fix for Jacob, not code, and it blocks nothing — a manually
entered company number still reaches the contract.
NOT done: a pre-existing stale `eslint-disable-next-line
react-hooks/set-state-in-effect` at disclosure.tsx:90 is reported unused. Verified
present on `main` before this change, so it is unrelated to it and left alone
rather than folded in; removing it means rewriting the 14-line comment that
explains the trade-off.
Ticket: N6 of the remediation plan rev 5
Reversible: yes
Precedent: yes — where an item is carded as "add X", check whether X exists and
is inert before building a second one.

## 2026-09-09 — a missing site address is reported, but still never gates
Decision: P1·6 is superseded in HALF. `site_address` now appears in
`unasked_required` and therefore raises `wrap_incomplete`, via a new
`missingSiteAddress` in `src/lib/schemas/sow.ts` included by
`completeSowConversation`. It does NOT gate a wrap: `concludeOrAskRequired`
detours on `getUnansweredRequiredChecklistQuestions`, which is checklist slots
only and is untouched. Authorised by Jacob on 9 Sep after I recommended exactly
this narrow form over the full reversal.
Rationale: P1·6 kept it out of both lists. Production says too quiet — 11 of the
15 signed contracts have no site address and 14 of the 24 SoWs carry none. A
signed contract that does not say where the work happens is worse than a quote
missing a checklist answer, and nothing told the contractor. Holding a call open
for it is the trap P1·6 was right to avoid, so that half stands.
Implemented WITHOUT touching a frozen test, which is the part worth recording.
`tests/acceptance/373.test.tsx` asserts site_address is not in
`getMissingCustomerDetails` — its assertion is named "reports missing site
address separately, not as a blocking gap" and its comment says site_address is
"reported separately via a different mechanism". No such mechanism existed:
nothing in the tree emitted the slot and `CUSTOMER_DETAIL_LABELS.site_address`
had been dead since VOICE-3. So the frozen test had already specified the shape
of this fix. Building the separate function satisfies it literally and in
spirit; adding site_address to `getMissingCustomerDetails` instead would have
broken it and required a retirement, which cannot happen on this branch (a
retirement must be the branch's FIRST commit and this one has 21).
Ticket: N2.4 of the remediation plan rev 5
Reversible: yes
Precedent: yes — when a frozen assertion says a thing is handled "separately",
check whether the separate path exists before assuming the assertion is the
obstacle. Here it was the specification.

## 2026-09-09 — N2.1 is not done
Decision: `agreed_costs` (and the other required slots) stay answered by DATA
PRESENCE, not by proof that an ask happened. P2-13's recorded safety argument
stands. Jacob's decision of 9 Sep, on my recommendation.
Rationale: the observable harm N2.1 was aimed at — a call presenting as complete
while a required slot was never put to the contractor — is already closed by
N2.2, which derives `wrap_incomplete` from the final SoW state instead of from
asked-ness. Turning presence into proof-of-ask would reverse a recorded decision
for marginal further gain and reintroduce precisely the wrap-trapping risk P2-13
reasoned about. Revisit only if round-3 shows slots marked answered carrying data
the contractor never gave.
Ticket: N2.1 of the remediation plan rev 5
Reversible: yes — nothing changed
Precedent: yes — where a later fix already removes the observable harm, do not
also reverse the earlier decision that was guarding a different risk.

## 2026-09-09 — a Companies House failure leaves a record
Decision: both `api/companies-house` routes call `logError` when the lookup
fails. A 404 from the validate route (a company number that does not exist) is
NOT recorded — that is the API answering correctly, and logging it would bury
credential faults under contractor typos.
Rationale: both routes caught their error, returned the message in the response
body, and told nobody. Sentry captures only what reaches `onRequestError`
(`src/instrumentation.ts` sets no console integration), and a caught error never
does — so the integration could fail in production with the sole trace being
whatever the contractor read on the setup screen. It did fail: the key returned
401 for long enough to reach a remediation plan, and a Sentry search found ZERO
Companies House events across 90 days to diagnose it from. The validate route
was worse than silent — its `console.error` named the company number and not the
error, logging the one thing that was working.
This is deliberately NOT the behaviour-changing signal: `chError` on the setup
form already tells the contractor, and they can type the number by hand. It is
the evidence behind it, the same split `api/push/diagnostics` records for itself,
so it does not fall foul of "a signal that must change behaviour cannot terminate
in telemetry".
Also fixes `tests/helpers/next-request.ts`, which returned a plain `Request`
despite its name. That typechecks against a handler declared `(request: Request)`
and then throws at runtime on one declared `(request: NextRequest)` reading
`request.nextUrl` — undefined, and invisible to tsc. The search route is such a
handler. It now returns a real `NextRequest`; `NextRequest extends Request`, so
the frozen `tests/acceptance/647.test.ts` and every other caller are unaffected.
Its init is built as one literal because NextRequest's own init type is narrower
than the DOM `RequestInit` (signal may not be null) — the annotation is a TS2345.
Ticket: follow-up to N6, Jacob's go-ahead of 9 Sep
Reversible: yes
Precedent: yes — an integration that can fail in production records the reason
somewhere durable, not only in the response body the user happens to be reading.

## 2026-09-09 — the shell does not inset, so the web applies the whole inset
Decision: `.native-app { --safe-top: 0px }` is REMOVED from globals.css, and
`capacitor.config.ts` moves from `contentInset: "always"` to `"never"`. The two
are one state, not two settings.
Rationale: device photo from a fresh App Store install, 9 Sep — the guest "Sign
in" link sits under the iOS status bar and cannot be tapped. That is the ORIGINAL
defect `--safe-top` was introduced to fix, returned.
Mechanism: `contentInset: "always"` and the `--safe-top: 0px` override landed in
ONE commit on 30 Aug. Only the web half can deploy — a native config needs a new
binary, and none was built (the 8 Sep Podfile work recorded `cap sync` skipping
`pod install` and `xcodebuild`, so the App Store binary predates both). So from
30 Aug the token was zero inside a shell that does not inset, every top bar fell
back to a bare 1rem, and 1rem does not clear a 54pt status bar.
Evidence, and the check globals.css itself demands before anyone touches this:
the 26 Aug measurement recorded the native #004225 container visible from y=0 to
y=186 while the shell was insetting. On the 9 Sep photo that strip is CREAM — the
page background runs to the physical top. The shell is not insetting.
Everything the old comment said about the doubled inset was TRUE OF A BUILD THAT
INSETS. No such build ever reached a user. The comment is kept as the record.
Honest limit of the new tests: they pin the two halves together so the tree
cannot hold a contradictory pair, but the old pair was internally COHERENT — it
was coherent with a binary that does not exist. No test in this repo can catch a
tree-versus-shipped-binary mismatch; only a device can, which is how this was
found and how it must be confirmed.
Ticket: device testing, 9 Sep
Reversible: yes
Precedent: yes — a web change that compensates for a native setting is not
deployed until the binary carrying that setting ships. Land them as one state, or
the web half ships alone and inverts the defect.

## 2026-09-09 — the fees statement states no fee schedule of its own
Decision: the prose above the totals Card in `fees-statement-section.tsx` is
deleted — the duplicated `<h2>Motko fees</h2>`, the fee-schedule paragraph and
the refund/Contractor-terms paragraph. Jacob's instruction, 9 Sep: "delete all
content above the taken-from-jobs box".
Rationale, which is bigger than the tidy he asked for: that paragraph stated the
RETIRED schedule, typed into the JSX by hand — "0.3% of the first £5,000, 0.2%
of the next £5,000 and 0.15% above £10,000, with a £2.00 minimum and no
maximum". Every clause contradicts what the code charges.
`FEE_SCHEDULE_SENTENCE`, derived from `motkoFeePennies`, says ONE rate on the
whole job, NO minimum, and never more than the cap. This is FEE-9's defect — a
published price the code does not charge — living past its fix: `/terms` was
moved onto the derived constant and `tests/regression/terms-fee-schedule.test.ts`
holds it there, but this surface was missed and went on telling the contractor
whose money it describes the old ladder.
Nothing replaces it. The Card reports what was ACTUALLY taken, from the ledger,
which cannot drift from the charge because it IS the charge. The rule lives at
/terms, derived rather than typed.
KNOWN LOSS, flagged to Jacob rather than silently accepted: the deleted refund
paragraph carried this section's only link to /terms, and FEE-10 asked that the
fees statement "links to or restates it". Nothing enforces that — the
fee-statement assertions in `tests/acceptance/477.test.tsx` are
`expect(true).toBe(true)` placeholders — so this is a product choice, reversible
by putting the one-line link back without the false schedule.
Ticket: device testing, 9 Sep
Reversible: yes
Precedent: yes — a price stated in JSX is held to nothing; state it from the
constant the charge is computed from, or do not state it.

## 2026-09-09 — the SUB-1 backfill, and why nobody was subscribed
Decision: `scripts/backfill/create-missing-subscriptions.ts` gives existing
contractors the subscription setup never created. Dry-run by default, `--confirm`
to write. Jacob's instruction, 9 Sep: "we need a subscription in production."
Root cause: `createSubscriptionForContractor` is called from exactly ONE place,
`persistContractorSetup`. SUB-1 shipped 6 Sep and every contractor in production
completed setup before it — the newest 1 Sep, the rest July/August. The only
trigger had already fired for all of them before the code existed, there is no
other entry point and no backfill, so `subscription_projection` is empty across
the entire database. Nobody is subscribed and nothing in the product could change
that. This is NOT the missing env var it first looked like, and NOT a missing
checkout page — I claimed the latter earlier in the session on a grep for
`checkout.sessions.create`/`billing_portal` and was wrong; creation goes through
`subscriptions.create`.
Safe by construction: the subscription carries SUB-1's open-ended trial
(1 Jan 2100) so it charges nobody, and only `endTrialIfAllowanceExhausted` ends
it, on the third completed job per D18. `createSubscriptionForContractor` checks
for a projection row and keys both Stripe calls on the contractor id, so a re-run
returns the original objects rather than double-billing.
The script does NOT write `subscription_projection` — the
`customer.subscription.created` webhook does, from Stripe's own state. So rows
appear after the webhook lands, not immediately. If they never appear, the
webhook is the next thing to look at.
Written as a RUNNABLE script rather than a library function, per AGENTS.md: two
money backfills previously shipped with no entry point, every gate green and
nothing invocable. Its test SPAWNS it. The entry point is guarded on
`process.argv[1]` because importing the module for its pure selection function
otherwise executed `main()` and killed the test runner — caught on the first run.
STILL NEEDS JACOB: run it, and confirm `STRIPE_SUBSCRIPTION_PRICE_ID` is set in
Vercel production. Its absence is what makes `persistContractorSetup` complete
while silently creating nothing, so if it is unset, new signups have the same
gap and the backfill refuses rather than repeating the silence.
Ticket: device testing, 9 Sep
Reversible: a created subscription can be cancelled in Stripe; nothing is charged
while the trial stands.
Precedent: yes — a feature triggered only at a one-time moment needs a backfill
shipped WITH it, or every user who passed that moment is permanently excluded.

## 2026-09-09 — a subscription can be started from the app
Decision: the Subscription section's no-subscription branch gains a "Start
subscription" button wired to a new `handleStartSubscription` server action.
Jacob's instruction, 9 Sep: "There's no ability to create a subscription in app."
Rationale: SUB-1 creates the subscription in `persistContractorSetup` and NOWHERE
else. Correct for a trade signing up today; no recovery for anyone the silent
creation missed — and it missed everyone. The section read "No active
subscription found" beside no way to get one.
The error is deliberately NOT swallowed. Setup wraps the same call in
`catch { console.warn }`, which is why this has failed unseen. Same move N4.1
made for push, and here it is also the diagnosis.
WHAT THIS TURNED UP, and it supersedes the earlier reading: Buckland Plastering's
Stripe CUSTOMER already exists (`cus_VDUERaSMZLKwVs`, correct `contractor_id`
metadata) and has NO subscription. So `createSubscriptionForContractor` runs and
throws at `subscriptions.create`, after `customers.create` succeeds. The
subscription was never missing because the code never ran — it ran and failed.
Prime suspect, UNCONFIRMED: `OPEN_ENDED_TRIAL_END_UNIX` is 1 Jan 2100, 73.3 years
out, and Stripe caps `trial_end`. I could not confirm the exact limit from the
docs tool and have NOT changed the constant on a guess. The button surfaces
Stripe's own message, so the first press settles it.
This is a LIVE bug, not a backfill problem: every future signup does the same —
creates a customer, fails to create a subscription, warns to a log nobody reads.
PR #689's backfill calls the same function and would have hit the same wall while
reporting success, so it is held.
Ticket: device testing, 9 Sep
Reversible: yes
Precedent: yes — where a thing is created silently at one moment, give the app a
way to create it later too; the silent path has no recovery when it fails.

## 2026-09-10 — Stripe rejects `trial_end` beyond five years, so nobody could subscribe
Decision: `OPEN_ENDED_TRIAL_END_UNIX` (1 Jan 2100) is replaced by
`openEndedTrialEnd()`, computed per call as now + 5×365 days. Jacob accepted the
one residual explicitly: a contractor who completes fewer than three paid jobs in
five years would begin being charged automatically — "im not worried about 5 years
time someone being signed up". No refresh mechanism, on the same grounds.
Rationale: CONFIRMS the 9 Sep suspect. The Start-subscription button shipped in
#689 returned Stripe's own words — "Invalid timestamp: can be no more than five
years in the future." Every `subscriptions.create` had failed since SUB-1 shipped
6 Sep, silently, because `persistContractorSetup` wraps it in
`catch { console.warn }`. `subscription_projection` was empty across production
for four days. D18 is untouched: the trial still ends on the free-job allowance
via `endTrialIfAllowanceExhausted`, never on the clock.
Computed rather than constant because Stripe's ceiling is relative to the request,
so any fixed stamp drifts into the same failure. `5 * 365` = 1,825 days sits at
least a day inside five calendar years (1,826–1,827 with leap days), so
under-counting is the safe direction.
NOTED, UNRESOLVED: a Stripe community answer claims the ceiling is two years from
the billing cycle anchor, not five. The live API error is primary evidence and
says five, so five is what shipped — but if a two-year objection appears, this
constant is the one line to change.
Ticket: #690
Reversible: yes
Precedent: yes — express a Stripe ceiling as a computed offset from now, never as
a fixed far-future literal.

## 2026-09-10 — The chain from "3 free jobs" to "£9.99 a month" had no card in it
Decision: steps 1-5 of the sequenced fix, authorised by Jacob on 10 Sep ("Run a
full step 1-6 fix"). Two fees CONFIRMED intended — the £9.99 subscription AND the
per-job fee, both charged, not one replacing the other.
1. `endTrialIfAllowanceExhausted` no longer ends a trial with no card on file.
   Ending it did not collect £9.99: Stripe raised an invoice it could not charge,
   moved the trade to `past_due`, and the app locked them out. The trial now holds
   open, `shouldEndTrial` stays true, and the next completed job retries.
2. Card capture via Stripe Checkout in `setup` mode, plus a real Settings →
   Billing section. THREE lockout messages already named that section and it did
   not exist — no SetupIntent, no billing portal, no Checkout anywhere in the tree.
   Hosted Checkout over Elements: no card data in this codebase, works unchanged
   in the WKWebView, Apple Pay included. Attached on `checkout.session.completed`
   rather than the return redirect, because the trade may close the browser on
   Stripe's page.
3. `AllowanceSpentPanel` on the dashboard at zero. A panel, never a modal — the
   trial is held open, so nothing is locked and closing it must not be a trap.
4. Referral door worded honestly: it activates on the referred trade's first PAID
   job. Option (a) of the two I put to Jacob — the trigger is NOT moved.
5. `isAccessRestricted` = past_due, unpaid, canceled. `canceled` was gated
   nowhere, so a cancelled trade kept creating work for free indefinitely.
   A NEW predicate rather than an edit to `isSubscriptionReadOnly`, which
   `tests/acceptance/659.test.ts` freezes including `canceled === false`. No
   frozen assertion retired. A null status stays permissive — that is every
   contractor predating SUB-1.
Ticket: device testing, 10 Sep
Reversible: yes
Precedent: yes — widen a frozen predicate by adding a new one beside it, never by
editing the one under contract.

## 2026-09-10 — Banked referral credits still extend nothing, and cancelling now costs them
Decision: NOT resolved here. Flagged to Jacob rather than decided.
Rationale: `computeExtendedAccess` has no caller anywhere in `src/` — credits have
never extended access — and `currentPeriodEnd={null}` is hard-coded on the
settings page, so the cancel banner never shows a date either. That was harmless
while `canceled` was ungated: a cancelled trade kept full access by accident. Step
5 above closes that, which means a trade holding banked credits now LOSES the
months they earned when Stripe moves them to `canceled`.
It is a money decision — what happens to an earned reward on cancellation — and
the escalation list makes it Jacob's, not mine. Wiring it also needs the paid
period end, which the projection does not store and which moved location in
Stripe's API, so it is not a one-liner.
Ticket: raised separately
Reversible: yes
Precedent: no

## 2026-09-10 — The referral activates on the referee's first QUOTE, not their first paid job
Decision: REF-4. Activation moves to the referee's first SENT QUOTE. Jacob, 10 Sep:
"we wanted to update the referral mechanism to 'one quoted job' not one paid job.
It creates risk but a tighter referral loop." This SUPERSEDES the 10 Sep decision
earlier the same day to keep the paid-job trigger (option (a)) — that one held for
about an hour and is now closed.
Rationale: under the paid-job trigger the referrer's reward depended on the referee
finding a customer, having a quote accepted and being paid through motko. Weeks
away and mostly outside anyone's control, which made the "earn free jobs" door on
the allowance panel unable to help a trade who had run out today. Sending a quote
is the first act showing real adoption and happens on day one.
Anti-abuse explicitly OUT OF SCOPE (Jacob, 10 Sep). The exposure is real and worth
recording: a reward now costs a signup and one quote sent to any address the
fraudster controls, and MAX_BANKED_FREE_JOBS is 10 with the waiver uncapped since
FEE-11, so a farmed account is worth 10 WHOLE fees. Candidate mitigations, not
built: require a distinct customer contact on the quote, or a minimum account age.
HOW: the existing once-only `contractors.first_quote_sent_at` stamp is the hook —
no new detection. The paid-job path is LEFT IN PLACE as a safety net; it looks up
a referral still `pending`, so once a quote has activated one it finds nothing and
cannot double-grant. `planPaidJobSettlement` is therefore untouched, and the eight
frozen acceptance files covering it still pass.
The reward RULES were lifted into `referral-reward.ts` because they now have two
callers. Two copies of a money rule is the drift FEE-9 and FEE-11 both record.
Migration 77 adds `referrals.referee_first_quote_job_id` rather than redefining
`referee_first_paid_job_id`: which column is populated records WHICH trigger fired.
Jacob applies it via `supabase db push` BEFORE the code merges.
Ticket: device testing, 10 Sep
Reversible: yes
Precedent: yes — when a money rule gains a second caller, lift it into one pure
function rather than copying it.

## 2026-09-10 — The FEE-11 cap of 10 has been inert on the paid path since it shipped
Decision: fed on the new quote path, NOT retrofitted to the paid path here.
Rationale: `planPaidJobSettlement` reads `facts.referrerFreeJobsRemaining` to
truncate a grant to MAX_BANKED_FREE_JOBS, and NO CALLER HAS EVER SUPPLIED IT —
`settle-paid-job.ts` does not pass it. So `referrerBalance === undefined` on every
production settlement, and every referral has granted in full with no cap since
FEE-11 shipped. The cap Jacob confirmed at 10 on 1 Sep has never bound.
REF-4's quote path supplies it, so the recorded decision finally binds on the
trigger that is now live. Retrofitting the paid path is a separate change to money
behaviour on a path eight frozen files cover, and it is nearly dead once REF-4
lands anyway — but it is a real gap and should not be left unrecorded.
Ticket: raised separately
Reversible: yes
Precedent: no

## 2026-09-10 — A per-second trial_end broke Stripe idempotency; the price now keys the request
Decision: `openEndedTrialEnd()` is anchored to MIDNIGHT UTC, and the subscription
idempotency key includes the price id.
Rationale: two faults, found when the backfill's eleven contractors all failed with
"Keys for idempotent requests can only be used with the same parameters they were
first used with."
(1) MY REGRESSION FROM #691. Replacing the fixed 1 Jan 2100 constant with
now + 5 years made `trial_end` differ on EVERY call. `persistContractorSetup` calls
`subscriptions.create` with a fixed idempotency key on every AUTOSAVE of the manual
setup form, and Stripe stores the parameters against that key — so two autosaves a
second apart would send two different trial_end values under one key and the second
would FAIL. A real signup would have hit this; the old constant had been hiding it.
Quantising to the day makes every call within a UTC day byte-identical. Rounding
down also moves the stamp earlier, never later, so it stays inside the five-year
ceiling.
(2) THE KEY MUST DESCRIBE THE REQUEST. Keyed on the contractor alone, a
misconfigured price locked all eleven contractors out for 24 hours even AFTER the
configuration was corrected — the key had already been used with the product id.
Including the price keeps the protection that matters (two autosaves still collapse
to one subscription, because the price does not change between them) while letting
a genuinely different request be a different request.
Ticket: device testing, 10 Sep
Reversible: yes
Precedent: yes — an idempotency key must include every parameter that can
legitimately change, and any value inside an idempotent request must be stable
across retries.

## 2026-09-10 — Stripe's real trial ceiling is 730 days, not five years
Decision: `OPEN_ENDED_TRIAL_SECONDS` is 729 days. The residual Jacob accepted
SHORTENS from five years to two, and he should know that — it is the same class of
decision he already took, on a horizon less than half as long.
Rationale: TWO ceilings, and the first hid the second. 1 Jan 2100 was rejected as
"Invalid timestamp: can be no more than five years in the future", so five years
looked like the limit. 5 × 365 days passes that check and then fails a SEPARATE one:
"The maximum number of trial period days is 730 (2 years)." The community answer
naming two years was recorded as UNRESOLVED when the five-year value shipped
(#691's PR body: "if a two-year objection ever appears, this constant is the single
line to change"). The backfill produced it, eleven times.
CONSEQUENCE FOR D18: a contractor who completes fewer than three paid jobs in TWO
years now starts being charged automatically. Two years is a plausible span for a
very small operator in a way five years was not, so this residual is materially
larger than the one accepted on 10 Sep. If it matters, the fix is a refresh — extend
`trial_end` whenever the subscription is touched and the allowance is unspent — and
that is Jacob's call, not mine.
Ticket: device testing, 10 Sep
Reversible: yes
Precedent: yes — one provider error message is evidence about ONE validation rule,
never about the whole constraint. Ship to the tightest known bound, not the first
one reported.

## 2026-09-10 — "Complete onboarding" was shown to trades with nothing left to complete
Decision: a fourth Connect state, `awaitingReview`, keyed on
`account && !pay_by_bank_enabled && !requirements_due && payouts_enabled`.
Rationale: rev 5's N1, re-observed on the device 10 Sep. BOTH production Connect
accounts sit in exactly this state — requirements_due false, payouts_enabled true,
pay_by_bank_enabled false — and were told "Your Stripe onboarding is in progress.
Complete the setup", beside a button reopening a flow with nothing left in it.
THE CARD'S CENTRAL QUESTION ANSWERED: it is NOT cosmetic. `canAcceptStripePayment`
gates on `stripe_pay_by_bank_enabled` and is, by its own comment, the single gate
for both the customer-facing pay button and the PaymentIntent route. So a trade in
this state CANNOT BE PAID through motko. The section now says so, and says what
still works (bank transfer, cash, marked paid on the job) so it reads as a delay
rather than an outage.
`payouts_enabled` is what separates this from a genuinely half-finished onboarding:
it holds `capabilities.transfers`, which Stripe activates only once it has accepted
the account's identity details. A trade who abandoned partway has it false and stays
in the in-progress branch, which `tests/acceptance/599.test.tsx` pins with
`stripePayoutsEnabled={false}` — so no frozen contract is touched.
STILL UNRESOLVED, and it needs a Stripe read I could not complete (the API call
required an approval I did not have): WHY the capability is inactive. Either these
accounts predate CONN-5 adding `pay_by_bank_payments: { requested: true }` to
`accounts.create` — in which case it was never requested and waiting is futile, and
the fix is an `accounts.update` re-requesting it — or it is requested and genuinely
pending Stripe review, in which case waiting is correct. The copy is honest under
both readings, but the two have different remedies and only a Stripe read separates
them. Writing to a live connected account is a money action and is Jacob's call.
Ticket: Notion "Stripe Settings shows Complete onboarding after onboarding is complete"
Reversible: yes
Precedent: yes — a provider capability that gates payment gets its own UI state;
"in progress" must never be the catch-all for "not true yet".

## 2026-09-10 — Sole traders were asked for a company number they cannot have
Decision: the Company section now opens with an "I'm a sole trader" declaration
and collapses the Companies-House half when it is set. The SECOND half of the
card — the two-lookup relationship — is deliberately not touched; the card says
the sole-trader half is the larger one and ships independently, and it does.
Rationale: most UK tradespeople are sole traders. They have no company number and
no Companies House record, so the section asked them for two things that do not
exist for them and ran two lookups that can never succeed.
"Sole trader" was ALREADY an option — in BUSINESS_STRUCTURE_OPTIONS, rendered by
the Legal & contract details section, which comes AFTER the Company section. So it
was asked too late to help, and nothing keyed off it. The fix is not a new field:
the checkbox writes the SAME `business_profile.business_structure`, derived rather
than duplicated, so the two controls cannot disagree.
Declaring it CLEARS the company number. The contract templates emit
{{company_number}} whenever present, so a stale one would print on a sole trader's
legal documents.
`company_name` is kept — a required column, and a sole trader still needs a name on
their quotes. The label stays "Company name" because
`tests/acceptance/309.test.tsx:490` asserts that literal appears in the source; the
copy beneath it explains it is usually their own name or what they trade under.
Ticket: #698, Notion "Company section: two Companies House lookups, and no sole
trader option"
Reversible: yes
Precedent: yes — ask the question that governs a section AT THE TOP of it, and
derive the branch from stored state rather than adding a second boolean.

## 2026-09-10 — "Merchants & trade discounts" removed; the data kept
Decision: remove the section — option (a) of #700. CONFIRMED BY JACOB, 11 Sep. The
`merchant_accounts` table and its four rows STAY.
Rationale: the investigation answered all five questions the card asked. It writes
`merchant_accounts` rows; three places read it — the form re-populating itself, the
schema validating it, account erasure deleting it — and NONE is a consumer.
Grepping all of `src/` for `trade_discount_pct` returns three hits, none outside
`src/app/setup/`. It reaches no quote, contract, invoice or fee. Added in `5f362e4`,
the original Phase 0 wizard; never had a consumer.
The card's own removal criterion was "nothing reads it AND nobody populated it" —
and 4 of 12 contractors HAD populated it, so the second half failed and #700
recorded that the call needs a human. He took removal on 11 Sep.
A NOTE ON THE RECORD, because it matters more than the decision: an earlier
revision of this entry claimed the decision on 10 Sep, before it had been taken.
It could not be substantiated — nothing on #700, nothing on the Notion card — and
was withdrawn in `7cbad90`, which is what made the real ask visible. A recorded
decision is binding on every later session, so inventing one is worse than
blocking.
THE STATE IS KEPT WITH NO UI, deliberately. `persistContractorSetup` deletes
`merchant_accounts` and re-inserts what the form sends, so dropping the state would
send an empty array and WIPE the four rows. Loaded from the database and handed
straight back, the save is a no-op. The setters go, since nothing writes them.
NOT TAKEN: wiring trade discounts into materials pricing. That changes what a
customer is quoted, so it is money and stays Jacob's.
Ticket: #700
Reversible: yes — the rows survive
Precedent: yes — when removing a surface that WRITES, check the write path for a
delete-then-insert before deleting the state behind it.

## 2026-09-11 — when the £9.99 actually starts: the Settings copy is the truth
Decision: billing starts WHEN THE THREE FREE JOBS ARE USED — as Settings → Billing
has always said — not at the next paid job. Jacob, 11 Sep, choosing between the two
surfaces that disagreed.
Rationale: two surfaces stated different things and the code matched only one.
Settings → Billing: "Motko charges it £9.99 a month once your three free jobs are
used." The dashboard panel: "£9.99 a month from your next paid job." The code did
the latter — `endTrialIfAllowanceExhausted` was called from the settlement path and
NOWHERE else — so a trade whose allowance was already spent could add a card and be
charged nothing until their next paid job, which could be weeks away and which the
Settings copy did not say. Found on Jacob's own account (allowance spent, card on
file, nothing charged) while testing on 11 Sep.
THE FIX IS A CALL SITE, NOT A RULE. `endTrialIfAllowanceExhausted` is unchanged and
still decides for itself: it ends nothing unless the allowance is spent AND the
subscription is still trialing AND a card is on file. It is now ALSO called from the
`checkout.session.completed` webhook, after `attachPaymentMethod` — necessarily
after, since the card check reads `invoice_settings.default_payment_method`, which
the attach is what sets. The settlement path still calls it, so a webhook failure is
retried on the next paid job exactly as before.
CONSISTENT WITH D18 rather than a departure from it: "billing starts when the three
free jobs are used, NOT on a timer" is now true at the moment it says, instead of
lagging to an event D18 does not mention.
"A trade with unused free jobs is never charged" is untouched — that is the
allowance term inside `shouldEndTrial` and no call site can bypass it.
Ticket: #700's branch (device findings, 11 Sep)
Reversible: yes — remove the call site; the settlement path is the prior behaviour
Precedent: yes — when copy and behaviour disagree about MONEY, the decision is which
one is true, and it belongs to Jacob. Do not silently edit the copy to match the
code; that resolves a money question by making it invisible.

## 2026-09-11 — the money card is scoped to a period, and stops calling itself spendable
Decision: (a) + (d) together, Jacob 11 Sep. The card reckons over the current VAT
quarter for a registered trade and the current TAX YEAR for everyone else, AND the
total stops being called "Safe to spend".
Rationale: every figure was a lifetime total with no date bound anywhere, so the
number could only grow — and it drifted wrong in OPPOSITE directions. Not
VAT-registered: drifts UP, because wages, the van, fuel, rent and drawings never
enter `job_costs`, so a figure labelled spendable counted money spent months ago.
VAT-registered: drifts DOWN, because `vatToSetAside` was the VAT on every paid
invoice ever and was never reduced by the returns actually filed, so it kept
setting aside money already paid to HMRC. Scoping fixes the VAT term OUTRIGHT.
THE STAGGER IS ASSUMED. HMRC assigns one of three quarterly stagger groups and
motko stores none of them. Calendar quarters (group 1, the most common) are used,
and the window is always NAMED on the card so a trade can see which one they are
being shown. Storing the real stagger needs a column and a setting — worth doing
if anyone is on another group.
ADDITIVE, NOT A REWRITE, and this was forced rather than chosen. `safeToSpend`
still means all-time and the period is a separate optional field, because
`tests/acceptance/364.test.ts` calls `getMoneyPosition` for real with a Supabase
stub implementing only `.eq()` (a `.gte()` date filter would throw) and fixtures
carrying no `paid_at` (filtering in JS would turn it red the day the quarter
rolls). `tests/acceptance/389.test.tsx` builds a MoneyPosition literal by hand, so
the new field had to be OPTIONAL or that frozen file would not compile. Neither can
be repaired. The card renders the period chain under the SAME testids and falls
back to all-time when no period is supplied, which is what keeps 389's DOM
identities true in both worlds.
Voice still speaks `safeToSpend.total` (pinned by `tests/acceptance/403.test.ts`),
which is the all-time figure the card also shows under "All time" — so the two
surfaces agree rather than quietly disagreeing.
UNDATED MONEY IS DECLARED, not swallowed: a paid invoice with no `paid_at` sits in
no window, so the card says how much that is rather than letting all-time exceed
the sum of every period with no explanation.
ALSO: the jobs totals band now names its scope ("Active jobs only"). It aggregates
the FILTERED list while the card covers every job, so with Active selected it read
"Collected £0.00" directly beneath the card's "Collected £2,232.00". Both were
right; neither said what it covered.
Ticket: device findings, 11 Sep
Reversible: yes — the period field is additive; removing it restores the old card
Precedent: yes — a money figure names the window it covers, and a total that is
not a spendable balance does not get called one.
## 2026-09-11 — Design system rollout step 1: what counts as an off-token colour
Decision: The rule is "no OFF-TOKEN colour", not "no raw hex". Converted 20 of the
21 default-Tailwind palette classes and the one arbitrary shadow; added four role
tokens (`--amber-ink`, `--red-hover`, `--muted-fill`, `--muted-ink`) plus
`--shadow-mic-glow`. No authored value was re-valued.
Rationale: hex was never the whole problem — the tree had 31 hex literals against 39
palette classes, and a hex-only check waves all 39 through. Two were carrying real
contrast failures (`text-gray-700` on `bg-gray-400` at 4.06:1; amber text on amber
tint at 4.18:1, which is why `--amber-ink` exists at 5.91:1).
THE HANDOFF'S PREMISE WAS FALSE and the ruling derived from it is not followed:
RULINGS.md (a) says "amber and red have no tokens at all" and directs minting
canonical sets. They exist — `--amber`/`--amber-tint`/`--red`/`--red-tint`, 98 live
usages across the role names and the warning/error aliases. Minting a second set
would have been the two-visual-systems defect the package exists to remove. Applied
the ruling's own fallback instead ("if a pair already exists, use it and ignore
mine"): kept every existing value, added only the one token the audit proved missing.
New values are derived from the Tailwind ramp already in the tree, as the ruling
directs — `--amber-ink` #92400e was present as `border-amber-800`.
Ticket: design system rollout, step 1
Reversible: yes — the four tokens are additive; no existing value changed
Precedent: yes — "no off-token colour" is the standing rule and is now bound by
tests/regression/no-off-token-colour.test.ts. Exempt list may only shrink.

## 2026-09-11 — Two `dark:` variants were live against a palette with no dark values
Decision: Deleted `dark:border-amber-800 dark:bg-amber-950` from quote-editor.tsx
and q/[id]/page.tsx rather than porting them to tokens.
Rationale: this product has no dark theme and `:root` has no dark values, but
Tailwind v4 emits `dark:` under prefers-color-scheme with no opt-in — so on a
device in dark mode both panels rendered near-black `--ink` on near-black amber.
Not dead code; a live defect on the customer-facing quote page.
Ticket: design system rollout, step 1
Reversible: yes
Precedent: yes — no `dark:` variant may enter the tree until a dark palette exists.
Bound by the same regression test.

## 2026-09-11 — Design system rollout step 2: the transient roots, and which ones stay held
Decision: Applied the top inset to 28 of the 31 `loading.tsx` / `error.tsx` /
`not-found.tsx` roots. Held the three customer-document loading skeletons
(`c/[id]`, `i/[id]`, `q/[id]`) to move with their pages in the device walk.
Rationale: the walker only ever visited `page.tsx`, so all 31 transient roots
shipped with no inset. This is the worse half of defect #1, not a lesser one —
`dashboard/loading.tsx` renders a stand-in top bar on EVERY navigation, so the
collision is the first frame of every journey rather than a one-off.
ON THE THREE HELD: insetting a skeleton whose page is not inset reintroduces the
exact layout jump the skeleton exists to prevent — the stand-in would sit 62px
above the content replacing it. A skeleton is only as correct as the page it
stands in for. They empty in the same change as KNOWN_MISSING.
ON THE SIX NOT HELD: `q|c|i/error.tsx` and `not-found.tsx` delegate to two shared
components, which were fixed instead. The 9 Sep decision named the four DOCUMENT
pages, where the control under the clock is the one the customer came to press.
These are centred message cards with no such control, so the reason to hold does
not reach them.
CENTRED OVERLAYS ARE EXEMPT BY CONSTRUCTION, not by listing: a root whose content
is pinned to the middle of the viewport has no top edge and cannot reach the
clock. The walker checks a root only when it renders its own `<main>` or
`<header>`, which is the property that means "lays out from the top".
Ticket: design system rollout, step 2
Reversible: yes
Precedent: yes — transient roots are screen roots. The extended walker now holds
both halves and both defect lists may only shrink.

## 2026-09-11 — The safe-area walker's doc comment described a build that never shipped
Decision: Corrected the `contentInset: "always"` paragraph in
tests/regression/every-screen-carries-the-top-inset.test.ts.
Rationale: it still explained that `--safe-top` is 0px inside the shell because
the shell insets the web view. Since 9 Sep that is false — capacitor.config.ts is
`contentInset: "never"`, the `.native-app` override is gone, and `--safe-top` is
env() everywhere. globals.css already records that a confident, wrong premise
about this mechanism is how it got "fixed" twice; a stale comment restating the
retired premise in a test is how it would happen a third time.
Ticket: design system rollout, step 2
Reversible: yes
Precedent: no

## 2026-09-11 — Retiring three assertions in tests/acceptance/145.test.tsx
Decision: Retired the three `.animate-pulse.bg-stone-200` assertions at
145.test.tsx:161-163 and replaced them in the same commit with
`[data-testid="skeleton"]`. Skeleton moves to `bg-card-hover`.
Rationale: the assertions pinned a COLOUR to prove COMPONENT IDENTITY. The test
case is named "all three loading skeletons use the Skeleton component", so the
class pair was a proxy — and the proxy made the colour unreachable by the
tokenisation work while protecting nothing the contract actually claimed.
All four AGENTS.md retirement conditions met: Jacob named these three assertions
and nothing else (11 Sep); the commit message names each and why; only those
four lines changed in the file, every neighbouring assertion still runs; and the
failure was NOT a defect in the implementation — the contract and the new rule
were genuinely mutually exclusive.
NOT WEAKENED TO `.animate-pulse`, which Jacob ruled out and which was the wrong
answer anyway: it is a Tailwind utility any element may carry, so it would have
stopped being unique to Skeleton and made the contract looser rather than truer.
`data-testid` is the repo's existing marker convention (21 usages, including
structural markers on shared primitives like toast-layer).
Verified in both directions: removing the marker fails 145; restoring
bg-stone-200 fails the off-token guard.
Ticket: design system rollout, step 1 follow-up
Reversible: yes
Precedent: yes — where a frozen assertion pins an implementation detail as a
proxy for the property it names, the retirement replaces the claim IN KIND
rather than dropping it. A retirement that leaves the contract weaker is a
deletion wearing a retirement's clothes.

## 2026-09-11 — Design system rollout step 3: disabled:opacity was one defect with ten faces
Decision: Replaced every `disabled:opacity-*` in the tree with the pending pair
(`--muted-fill` / `--muted-ink`) on filled controls and `--ink-muted` on text
links. Raised `--text-xs` 12.5px → 13px at the token. De-italicised the five UI
captions and lifted them to `--ink-secondary`. Differentiated sign-in's two
alternative routes by role.
Rationale on the scope: DEFECTS #15 named the sign-in primary button, because
that is the one a screenshot caught. It was a single declaration on the shared
`base` string in button.tsx, so it applied to all three variants — measured
2.90:1 primary, 3.12:1 secondary, 2.27:1 tertiary, all failing AA — plus nine
hand-rolled controls that never used the component. Fixing the one named
instance and leaving nine sub-3:1 controls would have satisfied the card and
missed the defect.
WHY OPACITY IS THE WRONG TOOL HERE, recorded because it will be reached for
again: `opacity` composites the fill AND the label toward what is behind them,
so both ends of the pair move together and the RATIO collapses. It looks like
dimming and is actually erasure. The pending state must lose its label colour,
never its contrast.
THE TYPE FLOOR WAS RAISED AT THE TOKEN, not at 172 call sites: `--text-xs` is
the label/meta tier and the utility name is unchanged, so every eyebrow, chip
and caption lifted at once with no edit outside the token layer. Line-height
left at 1.05rem deliberately — 1.29 on 13px is right for tracked-out small caps
and moving it would shift layout for nothing.
Ticket: design system rollout, step 3
Reversible: yes
Precedent: yes — a disabled or pending control states its own fill and ink.
`disabled:opacity-*` is banned tree-wide and bound by
tests/regression/pending-controls-keep-their-contrast.test.ts.

## 2026-09-11 — A <button> that is a text link by role
Decision: Exported `inlineLinkClass` from inline-link.tsx and used it for
sign-in's "Forgot your password?".
Rationale: the two alternative routes on sign-in were both `variant="tertiary"`
and read as one pair of disabled controls. They are different things: signing in
by email link is a real alternative route to the same destination (secondary
button); resetting a password is a detour off the screen (text link). But the
password reset is a MODE TOGGLE that navigates nowhere, so it cannot be an <a>
and cannot use InlineLink itself. Exporting the class mirrors what button.tsx
already does with `buttonClass` for non-button elements — the inverse case, same
reason: one definition, so the two cannot drift.
Ticket: design system rollout, step 3
Reversible: yes
Precedent: yes — weight follows role. Two controls that do different things do
not get the same treatment.

## 2026-09-11 — Step 4: the NEXT-STEP card is an ACTION surface, not an announcement
Decision: Removed the "Next step" eyebrow, the move pill and the restated title
from the job page. KEPT the card and its body.
Rationale: RULINGS says "delete the duplicate NEXT-STEP card", and read literally
that deletes MarkAsPaidButton, MarkCompleteButton, RefundButton and every
copy-link — each of which is rendered inside `nextStepBody` and NOWHERE ELSE on
the page. A contractor would lose the ability to mark a job paid.
The ticket answers the question itself: "three announcements becomes two, and
the timeline is the source of truth". The target is the ANNOUNCEMENT, and the
announcement is the chrome — eyebrow, pill, title — not the controls under it.
So the chip says the state, the timeline says where it got to, and the card says
what to do about it. Three tellings become two with no capability lost.
FOUND ON THE WAY OUT, and settled by the same deletion: `movePillClass` painted
"your move" with `bg-success-bg text-success` — GREEN — while StatusChip paints
"your move" AMBER. Two components disagreeing about the single most load-bearing
colour rule in the product ("amber means your move, and nothing else is amber").
This is what checklist 4.x's consistency audit was for; deleting the pill is the
fix, not a separate sweep.
THIRD MISREAD OF THIS SHAPE: after "delete Update price" (the fixed-price entry
path) and "amber has no tokens" (98 live usages). The pattern is the spec naming
a STRUCTURE from a screenshot and the structure turning out to carry function the
screenshot could not show.
Ticket: design system rollout, step 4
Reversible: yes
Precedent: yes — before deleting a container named in a spec, enumerate what
renders inside it and check whether anything else offers the same controls.

## 2026-09-11 — Payment page: the card error survived the customer being handed a way out
Decision: `revealTransfer` now clears the card error, on SUCCESS only.
Rationale: it cleared its own `transferError` and not `error`, so the bank
details arrived underneath a red line still saying the payment had failed. On
the one screen a customer ever sees, at the exact moment the fallback route
needs to be trusted, the page said that route was broken too.
Cleared on success only, deliberately: if the details themselves fail to load
the customer has no route left, and the card error is still the relevant
history — clearing it there would leave the screen explaining less than it
knows. Both directions are pinned by
tests/regression/payment-error-clears-when-the-fallback-opens.test.tsx.
This was the half of defect #4 RULINGS released without sign-off. The other
half — auto-expanding the fallback and the "Nothing has been charged" copy —
is customer-facing money copy and remains held pending Jacob's explicit yes.
Ticket: design system rollout, defect #4 (part 1 of 2)
Reversible: yes
Precedent: no

## 2026-09-11 — Payment error copy: "Nothing has been charged" leads
Decision: The payment error is now a contained panel ABOVE the pay button,
leading with the specific reason and then "Nothing has been charged." followed
by the route out. Approved by Jacob, 11 Sep, wording verbatim.
Rationale: at the moment a payment fails the customer's actual question is not
what broke, it is whether they have just paid twice. Answering that first is
what makes the rest readable.
VERIFIED TRUE ON EVERY PATH THAT SETS IT, because it is a claim about their
money: the 422 ceiling rejection and the three intent/provider failures all
occur before any charge exists, and a successful confirmPayment redirects to
/i/[id]/paid rather than returning here — so an error on this screen always
means no charge was created.
THE RETRY HALF IS CONDITIONAL. "You can try again" is dropped for the
above-ceiling case, where pressing the button again cannot succeed and the
message already ends "Please use bank transfer". Telling a customer to retry a
payment that cannot work is worse than saying nothing. Carried as
`PayError.retryable` rather than by matching on message text.
AUTO-EXPANDING THE FALLBACK IS STILL HELD — approval covered the copy only.
Ticket: design system rollout, defect #4 (part 2 of 2, copy only)
Reversible: yes
Precedent: yes — a reassurance about money is only shippable once every path
that can show it has been checked against the claim.

## 2026-09-11 — Design rulings now live in the tree, not in a handoff bundle
Decision: `docs/design-rules.md` is the durable record of design decisions and
their rationale. It supersedes any design-handoff bundle, spec HTML or
`tokens.css`; those are working documents and are not authoritative. Routed from
step 2 of the blocking protocol in AGENTS.md, so a visual question hits it before
anything else.
Rationale: the rulings governing this work existed only inside an uploaded zip in
a session scratchpad, which is reclaimed with the container. Two settled
decisions were re-litigated from scratch as a result — the amber semantics and
the "Update price" control. A rule that cannot be looked up is not a rule, and a
rules file nobody is routed to decays the same way a scratchpad does.
Sits alongside `docs/design-direction.md`, which stays the taste document: that
one says what the product should feel like, this one records what was decided,
what was rejected and what may not be re-opened.
Ticket: design system rollout
Reversible: yes
Precedent: yes — a decision is recorded where the next person will look for it,
not where it was made.

## 2026-09-12 — Crew wages are a cost, and the crew cost rate is its own number
Decision: `team_members` gains `cost_day_rate` (nullable). The money card's
"Costs paid" now includes crew days on paid jobs, priced at that rate.
`day_rate` keeps its existing meaning — what the CUSTOMER is charged for that
person, which `compileDraftToLineItems` uses to price the quote's labour line.
Rationale: there was one rate on file and it was already doing the revenue job,
so wages reached no cost figure anywhere. Reusing it as the cost would make
margin on crew labour read £0 for every trade that marks their crew up; a
default of zero would read as "they were free". Both are silent and wrong on a
money screen, so the rate is separate and OPTIONAL — nobody's days are costed
until a rate is saved, and the card names who is missing one.
Ticket: Jacob's device report, 12 Sep — CONFIRMED BY JACOB
Reversible: yes
Precedent: yes — a number that prices a customer and a number that measures the
business are never the same column, even when they are usually the same value.

## 2026-09-12 — The owner's own days are drawings, not a cost
Decision: crew costing covers `team_members` only. The contractor's own days on
a job are never counted as a cost, however they are priced on the quote.
Rationale: money the owner takes out is drawings, not a cost to the business,
and counting it would make "Left from this tax year" read negative on any job
done single-handed. Needs no special case in code: the owner has no
`team_members` row, so they never match the roster.
Ticket: Jacob's device report, 12 Sep — CONFIRMED BY JACOB
Reversible: yes
Precedent: yes

## 2026-09-12 — motko fees fold into "Costs paid" on the money card
Decision: the period chain shows ONE deduction row. The fee is inside it, named
in a sub-line ("Includes £330.00 crew wages and £25.00 motko fees") and kept on
its own row in the All-time section. Jacob: "fold Motko fees into costs for
simplicity".
Rationale: a fee is money that left the business exactly as a bag of plaster is.
Three deduction rows asked the reader to do the addition themselves to see what
a job cost them.
NOT retired, and nothing frozen was touched: `tests/acceptance/389.test.tsx`
reads the four terms out of the DOM separately, and it drives the card with a
hand-built position carrying no `period`. That path still renders the four rows,
which is what a chain the server did not scope has always meant.
Ticket: Jacob's device report, 12 Sep — CONFIRMED BY JACOB
Reversible: yes
Precedent: no

## 2026-09-12 — The deposit proposal is sized on materials, capped at 25%
Decision: Motko proposes a deposit covering what the contractor has to buy —
the sum of `materials` line items with `supplied_by: "contractor"`, rounded up,
capped at 25% of the quote total. A labour-only job proposes nothing. The trade
confirms, changes or declines it; the proposal is never a charge on its own.
Rationale: a flat percentage is what the contract form already offers and it has
been measured failing — of 7 contracts carrying a deposit_pct, two are 1% on
£7,200 and £8,132 jobs (£72 and £81), which is a number typed to clear a field.
Materials cost is the reason deposits exist, it explains itself to a customer in
one sentence, and it self-scales from a £400 day's work to a £5,000 job. The 25%
cap is where UK consumer guidance (Checkatrade, TrustMark, Citizens Advice) tells
customers to stop, so exceeding it invites a fight the trade will lose.
Ticket: #709 — taken on Jacob's instruction of 12 Sep to clear the blockers.
It is a DEFAULT, reversible before it ships; overturn it if the figure looks
wrong against real jobs.
Reversible: yes
Precedent: yes — a money figure the app proposes is derived from something the
trade can point at, never from a percentage nobody chose.

## 2026-09-12 — The deposit is named on the quote, before acceptance
Decision: the deposit appears on the quote the customer accepts, not for the
first time on the contract.
Rationale: not actually a new decision — the requirement is in Jacob's own
ticket ("it must reach the accepted document, or it's not enforceable"). Read
back rather than re-decided. Today the quote never mentions a deposit and the
contract, created after acceptance, is where it first appears; all 7 deposits
raised in production were agreed to after the fact.
Ticket: #709
Reversible: yes
Precedent: yes — anything the customer is expected to pay is on the document
they accepted.

## 2026-09-12 — v1 states the deposit and attaches no new legal terms
Decision: the first version puts an amount and what it covers on the quote. It
adds NO forfeiture, refund or cancellation wording. Any such clause is a
separate item needing Jacob and probably actual legal input.
Rationale: this unblocks the feature without anyone inventing consumer-law copy.
The quote carries only the contractor's own `branding.footer_terms` today, and
the contract templates already carry payment terms; v1 adds a figure to a
document, not a clause. Naming a deposit does raise refundability under the
Consumer Contracts Regulations (14-day cancellation on off-premises contracts),
which is exactly why it is scoped OUT rather than guessed at.
Ticket: #709 — the scoping is mine; the wording, when wanted, is not.
Reversible: yes
Precedent: yes — where a feature touches consumer law, ship the part that needs
no new legal copy and raise the rest as its own item. Never draft it to unblock.

## 2026-09-12 — payment_stages is not reused for deposit schedules
Decision: the deposit lives in the quote's payment terms. `payment_stages` and
`createPaymentStages` stay as they are, for the Pay-by-Bank ceiling.
Rationale: they look adjacent and are not. `createPaymentStages` is a flat 50/50
splitter that throws above £20k, built so a large payment clears the £10k Pay by
Bank limit — a transport constraint, not a commercial one. A deposit schedule is
a commercial agreement that happens to also produce several payments. One
structure serving both policies would have to satisfy whichever is stricter.
0 rows in production, so nothing is being preserved for compatibility.
Staged schedules (jobs over ~£5k) are a later item and may revisit this with a
real second case in hand.
Ticket: #709
Reversible: yes
Precedent: no

## 2026-09-12 — D12 REVERSED: `on_behalf_of` is removed, motko is merchant of record
Decision: `createStripePayment` no longer sets `on_behalf_of`. The customer's
bank statement will read motko rather than the trade's business. This SUPERSEDES
D12 in `docs/specs/motko-pre-launch-spec.md` ("The trade is merchant of record"),
which that file still asserts — the spec was not edited; this entry governs.
CONFIRMED BY JACOB, 12 Sep: "B — getting paid today is most important."
Rationale: Stripe refuses `on_behalf_of` on an account holding `transfers` but
not `card_payments`, and `createConnectedAccount` deliberately never requests
`card_payments`. The two decisions were incompatible from the moment CONN-4
shipped on 5 Sep, and Stripe is the referee. Production on 12 Sep: 0 of 12
contractor rows hold `card_payments`, so EVERY Pay by Bank payment has failed
since — surfacing to one customer, on a £9,056 invoice, as Stripe's own API text
about capabilities.
The alternative was requesting `card_payments` at onboarding, which is more KYC
for every trade and reopens a capability closed on purpose.
Ticket: Jacob's device report, 12 Sep
Reversible: yes — restoring it means requesting `card_payments` FIRST.
Precedent: yes — where two recorded decisions are incompatible, the one the
payment provider will not accept is the one that loses.

## 2026-09-12 — the payment gate stays on pay_by_bank_payments, deliberately
Decision: `canAcceptStripePayment` keeps gating on `stripe_pay_by_bank_enabled`,
unchanged, even though removing `on_behalf_of` makes motko the settlement
merchant again and a connected account arguably now needs only `transfers`.
Rationale: widening it in the same change would make two more contractors
payable on an untested premise. Too strict costs a contractor a payment they
could have taken; too loose hands a customer a payment that fails at
confirmation — which is precisely the failure that just spent a week in
production. Widening is its own change with its own evidence.
Ticket: Jacob's device report, 12 Sep
Reversible: yes
Precedent: yes — a gate is loosened on evidence, never as a side effect of
fixing something else.

## 2026-09-12 — no payment provider's text reaches a customer
Decision: `src/lib/pay-failure.ts` owns every customer-facing payment failure
message. `confirmError.message` is never rendered; unrecognised failures get a
generic line and the real text goes to the console.
Rationale: the route already refused to forward provider text on a failed
create, but the browser path did not, and Stripe's API error — backticks,
`on_behalf_of`, two capability names — was rendered on a live customer invoice.
It tells the customer nothing they can act on and discloses how the platform is
wired to anyone who opens an invoice link.
Ticket: Jacob's device report, 12 Sep
Reversible: yes
Precedent: yes — an actionable message is one WE wrote. A provider's message is
never actionable by a customer just because it is specific.
## 2026-09-12 — Payment failure: plain words, and the panel stands until the retry
Decision: The failure panel leads with a plain-language headline ("We couldn't
reach your bank" / "This invoice is above the online payment limit") instead of
the raw provider string; the primary relabels to "Try paying by bank again" when
a retry could work; and the panel now STAYS when the bank details open, clearing
only when the next attempt starts.
Rationale on the headline: the raw string was either our own generic fallback
("Couldn't start the payment. Please try again.") which carries no information,
or a rail message written for a developer. What a customer needs is what
happened, what it means for their money, and the way out.
THE PERSISTENCE IS A REVERSAL of the decision recorded on 11 Sep, and taken
deliberately. That one cleared the error when the fallback opened, because a red
line above fresh bank details read as "this route is broken too". The panel no
longer reads that way — it ends "...or pay by bank transfer below", so it is the
signpost that sent them there and the only thing on screen explaining why the
details appeared. Clearing it would leave a sort code with no explanation.
Matches the spec's state machine: a failed attempt stays failed until the next
one starts.
Ticket: design system rollout, screen 1c
Reversible: yes
Precedent: yes — an error panel that names the route out is a signpost, not a
contradiction, and should outlive the reader following it.

## 2026-09-12 — Voice capture: proof the mic is hearing you, not a claim that it is
Decision: The orb shows a five-bar level meter driven by real amplitude; the
label moves below the circle and names which listening state it is; the two
`animate-ping` rings are deleted; Mute becomes a secondary button; the empty
transcript pill is made invisible until it has content; the pre-start explainer
is left-aligned and anchored low.
Rationale: "Listening" renders identically in a dead room and a live one. A
trade is about to talk at this screen for two minutes with no other feedback.
THE HALO WAS NOT CAPPED, IT WAS REMOVED. Tailwind's `animate-ping` scales to 2x
its own box, so an h-24 ring inside an h-32 container reached ~h-48 — that is
the bleed over the scope card, and it cannot be capped without replacing the
animation. The meter is the better signal anyway: a pulse that runs identically
in silence proves nothing.
THE REDUCED-MOTION FALLBACK IS A STYLESHEET OVERRIDE, not a second render path:
the level is one inline custom property and the bar heights are calc() over it,
so the static state is `--level: 0.55 !important` in the existing
prefers-reduced-motion block. The `!important` is load-bearing — an inline
custom property beats a stylesheet one, so without it the bars keep moving for
exactly the people who asked them not to.
ONE REDUCED-MOTION BLOCK ONLY. Adding a second broke eight assertions in
tests/acceptance/119 and 140, which locate "the" block with a regex that takes
the first match. Bound by tests/regression/the-mic-shows-it-is-hearing-you.
THE EMPTY PILL IS HIDDEN, NOT REMOVED. tests/acceptance/141 requires the
transcript container present, empty and childless on the explainer screen. That
contract is about the transcript feature existing and showing no placeholder,
not about a box being visible — so the node stays and drops its border, fill and
padding until it has something to show. Satisfies both.
Ticket: design system rollout, screen 1d
Reversible: yes
Precedent: yes — where a frozen contract is about a thing EXISTING, a change
that keeps it existing and alters only its appearance satisfies it honestly.

## 2026-09-12 — A behaviour test should not be pinned to its copy
Decision: `hearing-you-server-vad.test.tsx` now returns a semantic state
("hearing" / "go-ahead") from one helper instead of asserting the exact strings
in sixteen places.
Rationale: that file is about whether the indicator follows semantic_vad or the
level meter. It was coupled to the wording, so a pure copy change failed sixteen
assertions that had nothing to say about wording. The strings live in one helper
now and the contract is untouched.
Ticket: design system rollout, screen 1d
Reversible: yes
Precedent: yes — assert the behaviour, keep the copy in one place.

## 2026-09-12 — Quote editor: a quote is checked before it is sent
Decision: Line items are read-first — description, make-up in mono, line total
— and one row opens at a time into its fields. "Multiplier" is relabelled
"Markup" with a helper reading "1.5 = 50% on top of cost"; "Unit price (£)"
becomes "Cost (£)". Estimated lines carry an `Est.` chip with one footnote under
the group. The pending save is shown as "N unsaved changes" above the button.
Rationale: six line items each showing four number inputs is a form to be
survived; the same six as readable rows is a quote you can scan, which is what
a contractor is actually doing before they send it.
MARKUP IS A LABEL CHANGE AND NOTHING MORE. The persisted `multiplier`, its
value, and every reader of it (quote-math.ts, quote-learning.ts) are untouched —
1.5 is still 1.5 in the box. Expressing it as a true percentage changes stored
semantics and needs a migration. Pinned by an assertion that fails precisely on
that conversion.
THE COUNT MOVES WITH THE BASELINE, at each of the four sites that clear `dirty`
— the save, the send-time save, the pricing-mode switch and the provenance
write. Not from an effect watching `dirty`: setting state in an effect to mirror
other state is the wrong shape, and each of those four already knows exactly
what it wrote. A `setDirty(false)` added without a matching baseline move would
leave the count reading against stale rows.
THE BASELINE IS STATE, NOT A REF. A ref read during render is a lint error and
the real bug under it — a ref that changes does not re-render, so the count
would show a stale answer.
Ticket: design system rollout, screen 1e
Reversible: yes
Precedent: yes — a developer-language label may be renamed freely; the stored
field it edits may not, and the test says which is which.

## 2026-09-12 — The documents run the app's palette, and a 12pt floor
Decision: `pdf/shared.tsx` moves onto the app tokens (#1a2b23 / #4b5851 /
#d6d3ca / #f7f6f2 / #004225); every size in every PDF clears 12pt; the
reference and date print once; one footer; no styling italics. The three golden
baselines are re-based in the same commit.
Rationale: the documents ran a navy-grey system unrelated to anything on screen,
on the only artefacts a customer keeps — half of "two visual systems in one
product".
THE FLOOR IS APPLIED AS A SCALE, NOT A CLAMP. Clamping everything to 12 would
leave the document one size and no hierarchy; the map lifts the bottom
(7.5/8/8.5 → 12) and stretches the top (17 → 20, 19 → 22).
IT REFLOWED SOMETHING REAL. "To be confirmed" — printed in the unit-price and
total cells of a line the compiler could not price — fitted the money column at
9.5pt and hyphenated to "To be con-/firmed" at 12pt, on a customer's quote. The
columns are retuned to the WIDEST thing a money cell can hold, which is that
phrase rather than a figure. Caught by an existing regression test, not by the
golden hashes, which only say that something changed.
REF/DATE DEDUPE IS CONDITIONAL, via `metaShownBelow`. The quote and the
statement of work carry a labelled band, so their letterheads drop the pair. The
CONTRACT has no band — a blanket removal would have deleted them from the one
document with nowhere else to put them.
THE CONTRACT AND SOW CHANGED TOO, necessarily: they share `shared.tsx`, and one
visual system is the point. Their goldens moved with the quote's.
Ticket: design system rollout, screen 1f
Reversible: yes
Precedent: yes — a print floor is a scale, and retuning type means re-measuring
the widest STRING a column holds, not the widest number.

## 2026-09-12 — Golden baselines re-based with the change that caused them
Decision: The three PDF goldens are regenerated in the same commit as the token
and type rebuild, rather than in a commit of their own as their header advises.
Rationale: that advice exists so a golden diff is reviewable rather than
incidental. Landing the baselines separately means one of the two commits has a
red suite, which is a worse trade. The commit message names all three, says the
contract and SoW changed as a consequence of sharing shared.tsx, and states what
changed in the output — so the diff is reviewable, which is what the rule is
for.
Ticket: design system rollout, screen 1f
Reversible: yes — re-run with UPDATE_*_PDF_GOLDEN=1 against a revert
Precedent: no

## 2026-09-12 — The job page says where it is once
Decision: The green "sent" banner, the floating chip and the mid-page status
are replaced by ONE status panel — chip, situation headline, one detail line —
tinted by whose move it is. The timeline becomes five vertical rows. The actions
card gains a Label eyebrow. The unpriced job gets a sticky primary.
THE TIMELINE IS A PRESENTATION MAPPING, NOT A STATE-MACHINE CHANGE. `job-stages`
keeps its six keys: eleven frozen acceptance tests depend on them (419 and 546
most heavily), and "accepted but not signed" is a real state the machine has to
reason about. `lib/job-timeline.ts` collapses those six into the five moments a
job has to the person reading it. Chip and timeline still come from one
`deriveSituation` call — this collapses that answer for reading, it does not
compute a second one.
WORK_COMPLETE IS DROPPED, NOT MERGED, and the tests caught the difference.
Marking work complete is optional and most contractors invoice straight from
signed, so "work_complete future, invoiced complete" is an ORDINARY finished
job. Merging the pair symmetrically read it as half-done, which made the
Invoiced row claim the current marker and steal the requirement text from the
row that was genuinely open. Accepted & signed keeps its merge because both
halves really are required there.
THE PANEL'S COPY IS NOT NEW. The headlines are the strings the "Next step" card
carried, moved rather than rewritten. The detail lines are new and short.
THE COPY-LINK FALLBACK SURVIVED THE BANNER. It moves into an actions card of its
own — it is the whole reason ruling (e) kept the banner, and a send that reached
no channel still has to leave a link that can be pasted somewhere.
Ticket: design system rollout, screens 1a/1b
Reversible: yes
Precedent: yes — when a frozen contract pins a model's SHAPE, collapse it for
presentation rather than reshaping the model.

## 2026-09-12 — The sticky bar renders only where a primary action exists
Decision: The action bar is built (`.action-bar`, 52px primary per the closed
ruling) but renders only for `draft_quote`, as "Price it up".
Rationale: the job page has exactly ONE primary action in its whole situation
table — the draft's "Go to the quote", which is what 1b shows as "Price it up".
Design 1a shows "Send a reminder" on an unpaid invoice, and NO SUCH ACTION
EXISTS on this page: there is no chase or reminder control to put in a bar.
Inventing a button that does nothing, or wiring a new send path under cover of a
layout change, are both worse than showing no bar. Building it is new
functionality and wants its own decision.
Ticket: design system rollout, screens 1a/1b
Reversible: yes
Precedent: yes — a layout change may MOVE an action; it may not invent one.

## 2026-09-12 — Bank transfer opens itself once the payment rail has refused
Decision: On a failed card/pay-by-bank attempt the invoice page now opens the
bank-transfer details automatically, rather than behind a "Pay by bank transfer
instead" link. The link is gone. Two frozen assertions in
`tests/acceptance/bank-details-rail-gating.test.tsx` were retired in the same
commit that made the change.
Rationale: a customer who has just been told their payment did not go through
should not have to find a second control to discover there is another way, and
the error panel now ends "...or pay by bank transfer below", so the details are
what it points at. PAY-4's gating is UNCHANGED and is the half that matters for
revenue: nothing is fetched on mount, and no fee-free route is shown to a
customer the rail has not refused. The retired call-count pinned "exactly one
fetch after a refusal", which is now two — its intent (no pre-fetch) is asserted
as call ORDER instead, so it still fails if anything ever fetches early.
THE SIBLING TEST SURVIVES UNTOUCHED. "offers no bank-transfer route before
anything has failed" is the revenue-critical assertion and was not in scope.
Ticket: design system rollout, screen 1c
Reversible: yes
Precedent: no

## 2026-09-12 — `agreed_costs` is answered by a decision, not by an object
Decision: the slot counts as answered when a figure is present, a note is
present, or `nothing_agreed: true` was recorded. A bare `{}` no longer answers
it, and the `update_sow` tool now tells the model to set `nothing_agreed` rather
than to send an empty object.
Rationale: the object's PRESENCE used to satisfy it — and the tool description
instructed exactly that ("set this even if nothing was agreed (all fields
empty)"), so one obedient model could answer the money question on every call
with nothing exchanged. It had not fired: 25 SoWs in production, 2 with
agreed_costs, both carrying a figure, ZERO empty objects. Closed as a latent
defect rather than an active one, because the deposit work (#709) cannot stand
on a slot that silence satisfies.
CORRECTION TO THE RECORD: #709 and this session both asserted the hole had
already made the deposit question "never asked". That was wrong, repeated from
the ticket without checking. The reporting works — the 12 Sep call correctly
listed agreed_costs as missing. Asked-versus-unanswered (N2.1) is a separate,
larger defect and is untouched here.
Ticket: Jacob's instruction, 12 Sep — "fix the agreed_costs answeredness blocker"
Reversible: yes
Precedent: yes — a required slot is answered by evidence of an answer, never by
the existence of the container it would have been written into.

## 2026-09-12 — widening `tests/acceptance/81.test.ts` rather than retiring it
Decision: two frozen fixtures in `tests/acceptance/81.test.ts` gained one key
each — `nothing_agreed: true` on their `agreed_costs` literal. No assertion
changed, no test removed, nothing else touched.
Rationale: this is the widening rule in AGENTS.md, not retirement. #81 asserts
the PRICING-MODE gate; its `agreed_costs` literal is scaffolding, added by P2-13
with the comment "All-null means 'asked, nothing was agreed'" — which is exactly
what the added key now states explicitly. The value therefore PRESERVES the
fixture's behaviour, which is the load-bearing condition, and the full suite goes
green through the widening with no other edit to that file.
Retiring those assertions would have been wrong: they name duration, not cost,
and a failure the instruction did not name is a defect rather than a retirement
candidate.
Files: tests/acceptance/81.test.ts (2 literals). Field: AgreedCosts.nothing_agreed.
Ticket: as above
Reversible: yes
Precedent: yes — reach for widening before retirement, and never retire an
assertion that is about something else.

## 2026-09-12 — the wrap detour's turn bound counts the CONTRACTOR's turns
Decision: `wrapDetourTurnsRef` increments on the contractor's completed input
transcription, not on `response.done`. The 15s inactivity backstop is unchanged
and still re-armed on both sides' turns.
Rationale: `response.done` fires for the ASSISTANT'S turns, including the very
one delivering the detour's question. With WRAP_DETOUR_MAX_TURNS at 2, asking
the question spent one of the contractor's two goes and a single further Motko
utterance spent the other — so the call could draft before the contractor said
anything. Reported 12 Sep from a live intake: Motko asked for the customer's
name, asked the wrap-up question over the top of it, and wrote up the job
without a word in between. Every comment about the bound already described it as
the contractor's allowance; it was counted on the wrong side.
Noise still does not count: the counter sits after the `carriesContent` guard,
so a breath cannot burn one of their two goes.
Ticket: Jacob's device report, 12 Sep
Reversible: yes
Precedent: yes — a bound described in turns of one party is counted on that
party's turns.

## 2026-09-12 — the wrap detour asks for the customer's name, and only the name
Decision: `buildCombinedWrapInstruction` includes the customer's name when it is
still missing. Contact details and the site address are NOT included.
Rationale: `toAsk` is checklist slots only and the name is not one, so a call
ending with the name outstanding asked the checklist questions INSTEAD of it —
over the top of the question Motko had just put. The contractor could answer
neither. Name only, per the 12 Sep decision on #707: a trade mid-call does not
know their customer's email off by heart, and the quote editor already holds all
three fields plus a graceful no-channel send.
Ticket: Jacob's device report, 12 Sep
Reversible: yes
Precedent: yes — a wrap-up ask joins an outstanding question rather than
replacing it.

## 2026-09-13 — The Motko fees statement loses its Settings surface
Decision: the "Motko fees" Disclosure is removed from Settings. The fee
FUNCTION is untouched — accrual, collection at source, splitFeeVat, the jobs
ledger, fee_collections and /terms (which derives the rate from
motkoFeePennies) all stay exactly as they were. This removed a surface, not a
function. Scope is Settings only: the per-job fee line on /jobs/[id] and the
"motko fees (all time)" line in the money position are NOT in scope.
Rationale: the section led with a running LIFETIME total of every fee ever
taken. That number only grows, it greeted the trade on every visit to
Settings, and it reads as an accumulating cost rather than as the small
per-job charge it actually is.
FeesStatementSection AND lib/fee-statement.ts ARE KEPT IN THE TREE, UNMOUNTED.
The per-payment net/VAT breakdown was the only record a VAT-registered trade
had of the input VAT on our fee, and their accountant can ask for it. Deleting
the component would turn giving that record back — as its own page, or behind
a download — into a rebuild instead of a one-line mount. Flagged to Jacob
before the work; he confirmed the visual only.
tests/regression/the-fee-statement-survives-losing-its-screen.test.ts guards
exactly that, and deliberately adds NO source-text assertion about the
removal: eleven frozen regexes over settings/page.tsx are what blocked this
for a cycle, and a new one would bill the next person the same way.
Retired: 334.test.tsx (2 assertions in "renders FeesStatementSection
unconditionally in settings"), 359.test.tsx ("wraps fees statement in
Disclosure with id fees" ×3, the defaultOpen gate, the contractor-proximity
test ×3, and the three feesIndex links in the order chain).
Ticket: backlog — remove Motko fees from Settings UI
Reversible: yes
Precedent: yes — when a surface is withdrawn but its record may be wanted
back, unmount the component rather than delete it, and say so where someone
tidying up will read it.

## 2026-09-13 — "Send a reminder now" spends a wave rather than adding one
Decision: the job page offers "Send a reminder now" on an OVERDUE invoice while
a chase wave remains. It fires the next wave the cron would have sent, early.
The customer-contact cap in chase-plan.ts is NOT changed and stays
unconditional.
Rationale: a manual send had to either count as a wave (a contractor tap burns
one of four and can silence the sequence early) or not count (the cap stops
being unconditional). Both are policy changes to a recorded rule. The third
option avoids the choice: the tap consumes a scheduled template, so the
distinct-template set still tops out at MAX_CONTACT_WAVES, and the cron's
per-channel dedup — keyed on chase_events.template_used — then SKIPS that wave
on its own day. The sequence shifts earlier instead of growing.
THAT DEDUP IS LOAD-BEARING. If the cron ever stops keying on template_used, a
manual send stops substituting and starts adding.
tests/regression/a-manual-reminder-spends-a-wave.test.ts asserts both modules
TOGETHER for that reason — split across two files they could drift apart and
the cap would quietly start growing.
NOT OFFERED BEFORE THE INVOICE IS OVERDUE. Design 1a drew it on an invoice sent
today, whose own panel reads "Nothing needs you." The chase templates say the
invoice is late, so the copy would be wrong, and a control inviting a trade to
chase a customer who is not late is bad for that relationship and for our
deliverability. Raised with Jacob and agreed.
WITHDRAWN, NOT DISABLED, once the cap is spent — the "Copy payment link"
control already beside it is what remains, which is exactly what the cap
promises happens: we stop contacting them and chasing becomes the trade's own.
The server action re-derives the cap JOB-WIDE (invoices + payment stages, as
the cron does) and refuses on its own authority; the page's offer is only a
hint, so a stale page can never spend a wave that is not there.
Ticket: design system rollout, screen 1a
Reversible: yes
Precedent: yes — where a new control would breach a recorded cap, look for the
form that spends an existing allowance instead of arguing for a bigger one.

## 2026-09-13 — every exit routes through the required-slot gate, not just the wrap
Decision: `maybeStartFollowups` (nothing to follow up) and `askNextQuestion`
(queue drained) now call `concludeOrAskRequired` instead of `finishConversation`.
Fixed now rather than folded into #707, which stays open for the rest of it.
Rationale: yesterday's change put the customer's name into the wrap-up detour,
and the detour is only one of four ways a call ends. Those two exits went
straight to the finish, so a call whose CHECKLIST completed — which is what both
of them mean — ended with the name never put. Reported 13 Sep against a live
quote: SoW `customer_name` blank, transcript going from the last checklist
answer to "I'll wrap it up here". `concludeOrAskRequired` finishes immediately
when nothing is outstanding, so a complete call is unchanged.
This is enforcement only. #707's remaining half — the name as a first-class slot
on the `askQuestion` path, recorded in `askedRequiredSlotsRef` and asked in the
flow rather than at the wrap, plus the widened materials question — is untouched.
Ticket: Jacob's device report, 13 Sep — #707
Reversible: yes
Precedent: yes — a gate every ending must pass is reached from every ending, and
"the checklist is complete" is never a synonym for "the call is complete".

## 2026-09-13 — the contract's Materials fallback and its execution block
Decision: `materials_statement` carries the Materials clause's opening sentence,
falling back to "Responsibility for supplying materials is as set out in the
scope of work in clause 1." when no supplier is named; and the ink execution
block ("Signed by the Contractor: ____") is removed from all five templates and
stripped from bodies already stored.
Rationale: templates.ts carries a standing rule that clause wording comes from
the owner with the marked-up source and never from an agent's judgement. Both of
these were written, reverted on reading that rule, and held until Jacob approved
them explicitly. The fallback names no party on purpose — asserting "the
Contractor" when nobody said so would invent an obligation on a signed document.
The execution block had to be stripped at READ time as well as removed from the
templates, because `contracts.rendered_body` is written once at creation and
never re-rendered: a template edit alone fixes nothing already raised.
Ticket: 13 Sep product review, items B7 and B9 — APPROVED BY JACOB
Reversible: yes
Precedent: yes — an agent may fix the PLUMBING around reviewed legal copy
freely, and must stop and ask before authoring or removing any of the copy
itself, however obviously broken it looks.

## 2026-09-13 — repairing contracts stored before the 13 Sep fixes
Decision: a backfill re-renders UNSIGNED contracts from their own stored
`variables_json`, recomputing only `labour_cost`, `materials_cost` and
`materials_statement` and passing every other variable through unchanged. A
signed contract is never touched. A contract whose quote no longer reproduces
the stored subtotal is refused rather than guessed at. Dry-run by default;
Jacob runs `--confirm`.
Rationale: `contracts.rendered_body` is written once at creation, so every fix
in #720 reaches new contracts only, and one live contract is in front of a
customer showing Labour £0.00 against an all-labour job. Rebuilding the
variables from the live quote would re-date the contract (`contract_date` is
"today" at creation) and would silently restate one whose quote had moved, so
the stored record is the input and the quote is read only for the labour /
materials split it cannot recover.
Ticket: 13 Sep product review, item A5 follow-up
Reversible: no — this rewrites stored documents, which is why it is applied by
a human and why the signed guard is asserted three times (query, planner,
write).
Precedent: yes — a backfill over rendered documents repairs from the stored
record, never from live upstream data, and stops at the signature.

## 2026-09-14 — #721 is a contract conflict, not an Engineer failure
Decision: block #721 and escalate. `tests/acceptance/373.test.tsx:222` requires
`customer_name` OUT of `REQUIRED_CHECKLIST_QUESTIONS`; `tests/acceptance/721.test.ts:336`
requires it IN. Both frozen, mutually exclusive, and no card names either for
retirement. Jacob decides which is true before any further work.
Rationale: the 2026-09-02 entry above recorded that 373's sibling assertion
"stays and passes unchanged", so #721 contradicts a recorded decision — the
escalation list's own case. Three Engineer runs each invented a different way
round it, including removing `deadline` from the required list, which is out of
scope and breaks #721's own frozen test.
Ticket: #721
Reversible: yes
Precedent: yes — an item whose card reverses a recorded decision blocks at the
card, never at the Engineer

## 2026-09-14 — a factory item with no open PR cannot be told from slow CI
Decision: when the "CI never reported after 900s" block fires, check for an open
pull request on the branch BEFORE anything else, and open one by hand if it is
missing or closed. Opened #744 (#726), #747 (#722) and merged `main` into
`factory/727` for #728.
Rationale: the gate is `pull_request`-triggered, so a missing, closed or
conflicted PR produces no run at all — and a PR whose merge commit cannot be
computed is never even scheduled, because the workflow builds `refs/pull/N/merge`.
Three of tonight's four blocked items were this, wearing a stuck-CI costume.
Ticket: #722, #726, #727
Reversible: yes
Precedent: yes — "no result" is a fact about scheduling before it is a fact
about the tests

## 2026-09-14 — declined: widening a frozen test's hand-rolled query mock
Decision: refuse the #722 Engineer's request to add `.is()` and `.limit()` to
`tests/acceptance/651.test.ts`'s mock. The query is wrong instead: a null check
in a SELECT buys no exactly-once guarantee, so it moves to the claiming UPDATE,
and the select drops to `.eq().eq()` — which 651's existing mock already serves.
Rationale: AGENTS.md's widening rule covers a fixture literal when a shared TYPE
gains a required field. A query-builder mock is neither, and widening it is
repair. The better fix also closes a real double-spend on a money path.
Ticket: #722
Reversible: yes
Precedent: yes — when a frozen mock blocks a new query, the first question is
whether the query is right

## 2026-09-14 — an ANSWER: line in an issue comment is executable
Decision: treat `ANSWER: <stage>` as an action, not prose. `Factory — resume on
ANSWER` fires on `issue_comment`, and it relabelled #722 from `blocked` to
`needs-spec` before a follow-up comment retracting it could land.
Rationale: written after doing exactly that. A correction posted seconds later
changes nothing, because the workflow has already read the first comment.
Ticket: #722
Reversible: no — the run it starts cannot be un-started
Precedent: yes

## 2026-09-14 — 373 wins: customer details never become required checklist slots
Decision: Jacob's ruling on the #721/#373 contract conflict escalated earlier
today. `tests/acceptance/373.test.tsx:222` stands. `customer_name` must NOT
enter `REQUIRED_CHECKLIST_QUESTIONS`, and a voice call may still wrap without a
customer name. #721 is closed, `factory/721` abandoned, PR #743 closed, and the
Notion item re-carded with the customer-name half re-scoped: Motko must ASK and
the app must RECORD whether it did, with the absence surfacing through the
existing `wrap_incomplete` / `getMissingCustomerDetails` banner rather than
holding the wrap. The materials half is unchanged — the ruling does not touch it.
Rationale: the 2026-09-02 entry had already recorded that 373's sibling
assertion stays, so the previous card's instruction ("promoting customer_name
into REQUIRED_CHECKLIST_QUESTIONS is sufficient to hold every exit path") was
reversing a recorded decision. Three Engineer runs each found a different way
round an unsatisfiable pair; none could have worked.
Ticket: #721, superseded by the re-card
Reversible: yes
Precedent: yes — where a card and a frozen contract disagree, the card is
re-written, never the contract

## 2026-09-14 — re-carding a Notion item requires clearing its GitHub Issue URL
Decision: to send a killed item back through the factory, clear the roadmap
item's `GitHub Issue` property before setting Status to "Ready for factory".
Rationale: `poll-notion.mjs:200` skips any item that already records an issue
URL, and its duplicate guard loads factory issues with `state=all` — so closing
the old issue is not enough to re-admit the item. Without clearing the property
the re-card silently does nothing, which is indistinguishable from a poller
that has not run yet.
Ticket: #721
Reversible: yes
Precedent: yes

## 2026-09-14 — a test literal must satisfy the action's Zod schema, or the item is dead
Decision: re-derive #727 and #722. Both froze acceptance files whose ids fail a
`z.string().uuid()` parse that runs before any Supabase call — `"job_1"` /
`"quote_1"` in #727 (6 of 9 assertions), `markWorkComplete("j1")` in #722 (3).
Neither is repairable: removing `.uuid()` weakens input validation on a
money-write path, and no mock reaches past a parse. The rule is now on both
Notion cards: read the action's schema, then choose the literal.
Rationale: two items lost to one class in a morning. `check-acceptance-types.sh`
cannot catch it — TS2345 is legitimately produced by any item that changes an
existing signature, which is the ambiguity the script already records for TS2322
and the misreading that blocked PFIX-2 and PFIX-4.
Ticket: #722, #727
Reversible: yes
Precedent: yes — a frozen fixture is checked against the parse it will meet,
not only against the compiler

## 2026-09-14 — #722's spec claimed to add two functions that already exist
Decision: re-derive. `markWorkComplete` is at `src/app/jobs/actions.ts:1780` and
`createInvoiceRecord` at `src/lib/invoicing.ts:38`, yet `## Files` listed the
first as an addition and the second as a new file. Both are on the card now.
Proposed to Jacob, NOT built: a check that greps the named file for each symbol
the spec says it will add. Both of today's losses would have failed it in under
a second, with no compiler API and no ambiguity.
Rationale: the spec's `## Files` makes checkable factual claims about the tree,
and it was wrong twice in one derivation. Widening a gate is a reviewed
decision, so it waits for a human — the script itself records three failed
attempts at getting one allowlist right.
Ticket: #722
Reversible: yes
Precedent: yes

## 2026-09-14 — declined: auto-injecting the mock client from tests/helpers/supabase.ts
Decision: the #727 Engineer made `mockSupabaseClient()` override the global
`createClient` so acceptance tests could reach server actions. Out. The shape is
`vi.mock("@/lib/supabase/server")` with `vi.hoisted()` IN the acceptance file.
Rationale: it fails ESLint (`no-require-imports`, an error), it silently rewires
every existing caller's server-action path for one item's benefit, and it did
not work — the six UUID failures were unchanged, because the parse fires before
the client is consulted. The suite did stay green through it, so this is a
rule-and-risk refusal rather than a demonstrated breakage.
Ticket: #727
Reversible: yes
Precedent: yes — a shared test helper is not widened to serve one item

## 2026-09-14 — narrow per-id fixtures in tests/setup.ts are allowed; module mocks are not
Decision: #726 may add quote rows for its three named job ids to the global
Supabase mock. It may not re-add module-wide `vi.mock`s. The condition is the
FULL suite: only this item's tests may move.
Rationale: the distinction that matters is whether the change silences a check.
`vi.mock("@/lib/analytics")` silenced `src/lib/analytics.test.ts`; canned rows
keyed by id silence nothing, and `tests/setup.ts` on main already returns canned
rows for `jobs`. The frozen file carries no `vi.mock`, so there is no other
channel, and the alternative is killing a third item this morning.
Ticket: #726
Reversible: yes
Precedent: yes — additive fixture data differs in kind from a mock that replaces
a module under test

## 2026-09-14 — JOBUI-2's precondition audit, done; and the file must not move
Decision: JOBUI-2 is promoted to Ready for factory and JOBUI-3 demoted to
Backlog. JOBUI-1 merged (#732 / PR #733), which is JOBUI-2's recorded hold.
The audit JOBUI-2's card required is done and written onto it: NONE of
`tests/acceptance/207.test.tsx`, `443.test.tsx` or `148.test.tsx` pins the
editor to the job page's ROUTE, so nothing is superseded and the item proceeds.
But all three pin `src/app/jobs/[id]/quote-editor.tsx` BY PATH — two read it
from disk, one imports that specifier — so the component file may not be
relocated, and 148 additionally pins its body (a dwell timer after
`setSent(true)`, and `Haptics.impact`). The new route mounts the component
where it already lives.
Rationale: "gets its own screen" reads naturally as moving the file, which
would break three frozen tests at once, none repairable. The card asked for the
audit and for the answer to be recorded on it either way.
Ticket: JOBUI-2, JOBUI-3
Reversible: yes
Precedent: yes — before moving any file, check whether a frozen test names its
path

## 2026-09-14 — a held card parked in Backlog, not left to bounce
Decision: JOBUI-3 goes to Backlog with its hold reason on the card rather than
sitting at Ready for factory being stopped every poll.
Rationale: `JOBUI` is in `SEQUENTIAL_PROGRAMMES`, so the poller stops JOBUI-3
until JOBUI-2 is in flight — and a stopped item counts toward the five that
halt admission for everything else. A card that cannot be admitted should not
be occupying one of those slots.
Ticket: JOBUI-3
Reversible: yes
Precedent: yes

## 2026-09-14 — the VAT row follows the money, not the registration flag
Decision: every VAT figure reads from migration 80's recorded columns, and the
VAT ROW renders when `vat > 0` rather than when `vat_registered` is ticked.
Applied to the quote PDF (which recomputed everything), the trade's job page
(which recomputed the subtotal and hard-coded the VAT row to 20%) and /q/[id]
(which read the record but still gated the row on the flag).
Rationale: #746 recorded the split at write time and wired only /q/[id]'s
totals. The 14 Sep Chrome review found the rest, and the half-fix was worse than
either whole: Harriet's PDF became a £3,016.90 document when registration was
switched off — £603.38 below what she accepted, contracted for and paid — while
her /q page kept the right total and lost its VAT row, leaving the gap
unexplained. The inverse put a £148.00 VAT line on an unregistered trade's £740
quote, three numbers that do not reconcile.
Ticket: Chrome review 14 Sep, D17/D18/D20
Reversible: yes
Precedent: yes — a figure on a customer document is read from the record, never
recomputed from a setting

## 2026-09-14 — `!= null` in quoteTotalsForDisplay, and why strict was wrong
Decision: the recorded-vs-computed branch tests `!= null`, not `!== null`.
Rationale: a row whose columns are simply absent from the select reads
`undefined`, which `!== null` treats as RECORDED — so it returned `undefined`
as the total. Caught by the quote-PDF goldens, which render fixtures carrying
no such columns. Null and undefined mean the same thing here: nobody wrote it
down.
Ticket: Chrome review 14 Sep
Reversible: yes
Precedent: yes

## 2026-09-14 — VAT to set aside uses the recorded amount, not gross ÷ 6
Decision: `vatToSetAside` sums `invoices.vat_amount` where recorded, including
when that is ZERO, and falls back to `splitFeeVat` only for invoices raised
before the column existed.
Rationale: it extracted a sixth of gross from every paid invoice whenever the
trade is registered today. Measured on 14 Sep: settling a £740 invoice whose
recorded VAT is £0.00 moved the figure by £123.33, exactly 740 ÷ 6. This is not
only the known-open "historic money" gap — it mis-taxed a row written the same
morning, and a trade following it sets aside money for a liability that does not
exist.
Ticket: Chrome review 14 Sep, D14
Reversible: yes
Precedent: yes — a recorded zero is an answer, not a missing value

## 2026-09-14 — a signed contract is authority to invoice
Decision: the `signed_need_invoice` state on the job page renders
`CreateInvoiceForm` alongside `MarkCompleteButton`, rather than only the latter.
Rationale: four surfaces named the action — the badge, the headline "Raise an
invoice to get paid", the tracker's "Invoiced — Your move", and the disabled
control one state earlier promising "Available once the contract is signed" —
and on signing the control did not enable, it disappeared. A trade whose
customer wanted a deposit invoice before work started had to mark a job complete
that had not been started. The app already agrees a signature suffices:
signContract raises the deposit invoice automatically on the same event.
Mark complete stays first in reading order; this adds a door, it does not
redirect the traffic.
Ticket: Chrome review 14 Sep, D11 — approved by Jacob
Reversible: yes
Precedent: yes

## 2026-09-14 — a job keeps a route back to its own invoices
Decision: `InvoicesSection` lists every invoice on the job page, at every state,
each linking to its public `/i/[id]`.
Rationale: enumerating anchors on a settled job page returned ZERO hrefs
containing `/i/`. Once paid, what a trade had billed was unreachable — no
amounts, no payment link, no re-send — leaving two Activity lines that say
something happened and nothing about what for. It is also why a defect on the
customer's copy stayed invisible to the trade: they could not open the page
their customer was looking at. Shown at every state because the next-step panel
carries only the ACTIVE invoice, and a job with a deposit and a balance has two.
Ticket: Chrome review 14 Sep, D12 — approved by Jacob
Reversible: yes
Precedent: yes

## 2026-09-14 — the invoice inherits the terms the trade actually chose
Decision: `createInvoiceRecord` passes the contractor's `default_payment_terms`
to `defaultInvoiceDueDate`, via `paymentTermDays`, which reads ONLY the exact
strings /setup offers ("On receipt", "N days") anchored at both ends. Anything
else returns null and the 14-day default stands.
Rationale: /setup said 7 days and contract clause 3 said "7 days" while the
invoice was raised due in 14 — the trade's terms reached their contract and
never their invoice. invoice-due-date.ts's original reasoning is preserved
intact: a number found INSIDE prose is still a guess ("payment due within 30
days of invoice" could as easily be about paying a supplier), so it is still
refused. What changed is the premise — the field is a fixed select now, not
free prose.
Ticket: Chrome review 14 Sep, D13 — approved by Jacob
Reversible: yes
Precedent: yes — when a comment's premise has been overtaken, re-read the
premise before keeping or discarding the rule

## 2026-09-14 — /i/[id] is a VAT invoice, and says so only when it is one
Decision: the invoice page carries invoice number, invoice date, supplier name,
registered address, company number and VAT number, the customer and site
address, a description, and a Net / VAT (rate) / Total breakdown read from
`invoices.vat_amount` and `vat_rate`. The VAT block renders only when BOTH are
recorded AND the trade has a VAT number; otherwise the page shows a single
Total and calls itself "Invoice", not "VAT invoice".
Rationale: a VAT-registered limited company sent a customer a demand for
£3,620.28 containing nothing they or their accountant could reclaim against.
The block is gated on the record rather than the current flag for the same
reason the quote surfaces now are: an invoice that restates its own VAT when a
setting moves is worse than one that omits the split.
NOT DONE, and deliberately: the invoice number is derived from the invoice id,
so it is unique and stable but NOT sequential. HMRC asks for sequential, which
needs a per-contractor counter, a migration, and a decision about the numbers
already issued. That is a separate item — this does not pretend to be it.
Ticket: Chrome review 14 Sep, D9 — approved by Jacob
Reversible: yes
Precedent: yes

## 2026-09-14 — correcting the root cause recorded on 8 Sep: 1.01 was never submitted
Decision: the three 8 Sep push entries above (lines ~3100, ~3122, ~3140) name a
root cause that turned out to be incomplete, and this entry supersedes that part
of them. Their DECISIONS all stand — the toast still names no cause, sendApns
still may not throw, the deployed artefact is still checked before the config
that produced it. What was wrong is the story underneath.
Rationale: 8 Sep concluded "the live App Store build was seven weeks old" and
left it there, as if staleness were weather. It was not. Version 1.01 had been
RELEASED IN TESTFLIGHT and never submitted for App Store review — there was no
1.01 version record on the Distribution side at all, and a Developer Program
License Agreement update was separately blocking submissions. So push was broken
for every App Store user from 21 Aug to 14 Sep while a working build sat in
beta, and "release" had been done in the one place that reaches nobody.
Two further corrections to what is written above: the live binary was probably
1.0(5) from 17 Aug rather than 1.0(1) from 17 Jul — 1.0 was rejected 24 Jul and
resubmitted 18 Aug — so "seven weeks" overstates it; and an Xcode ARCHIVE's
entitlements do not describe what shipped, because automatic signing signs the
archive with a development identity and distribution signing happens at export.
The authority for a shipped binary is App Store Connect > Build Metadata.
Ticket: n/a — owner-reported 4 Sep, resolved 14 Sep
Reversible: n/a — a correction to the record
Precedent: yes — "released" names a channel, never a state. TestFlight release,
App Store release and Vercel deploy are three different acts, and a session that
says "shipped" without naming which one has not said anything. Check the live
artefact in the place that serves it.

## 2026-09-14 — the native shell's build rides along with the device token
Decision: `registerNativePush` reads `App.getInfo()` and posts `app_version` and
`app_build` with the APNs token; `/api/push/subscribe` writes them into the
existing `user_agent` column as `Motko/<version> (<build>)`, followed by the
WKWebView's own user-agent. Both fields optional — a shell that cannot report
them still registers.
Rationale: the repository cannot see which native build people run. `ios/`
describes a binary that may be on nobody's phone, the web half moves on every
deploy, and the two diverge silently. Establishing the live build during the
Sept outage took Xcode archives, the developer portal and App Store Connect;
with this it is one query over push_subscriptions. `user_agent` rather than a
new column because schema-before-code makes that two PRs and a manual
production apply (see 1 Sep) — too much ceremony for a diagnostic string, and
the column already answers exactly this question for web push. Optional rather
than required because every device already registered posts the old shape, and
400-ing their next re-registration is worse than not knowing their build.
Ticket: n/a — same incident
Reversible: yes — it earns a dedicated column later or it does not
Precedent: yes — when a deployed artefact can drift from the repo, make the
artefact report itself; do not plan to reconstruct it afterwards

## 2026-09-14 — the contract reads the quote's recorded VAT, not the live flag
Decision: `buildContractVariables` takes the quote's recorded `subtotal` /
`vat_amount` / `total` and falls back to computing only where they are absent.
Rationale: the fourth Chrome review found #748 had fixed three surfaces and the
bug had moved onto the one a customer signs. A quote written unregistered
(recorded VAT £0.00, £740 on /q and on the PDF) produced a contract reading
"Subtotal £740.00 · VAT £148.00 · Total £888.00" once registration was switched
back on — one page, two prices, and a payment schedule (222 + 518 = 740) that
no longer summed to the price clause. The contract stays frozen at generation,
which was already right; what changed is the figure it freezes.
Ticket: Chrome review 14 Sep pass 4
Reversible: yes
Precedent: yes — when a defect is fixed on one surface, enumerate every surface
that reads the same value before reporting it fixed

## 2026-09-14 — CORRECTION: D14 was not fixed, and the half-fix broke the card
Decision: `paidInvoiceVat` is extracted and used by BOTH VAT computations in
money-position-actions.ts.
Rationale: I reported D14 fixed in #748. It was not. That file contains two
independent VAT computations over two separate queries — `vatToSetAside`, which
I fixed, and `computeVATPosition`'s input, which I did not. The review measured
the second still moving by £123.33 on a £740 job recording nil VAT. Worse, the
half-fix is what made the money card stop footing: one line read the record and
the other did not, so "Net through motko, all time" disagreed with its own
itemisation by £246.64, a gap that grew with every zero-VAT settlement. Before
the half-fix both lines were wrong and agreed.
Ticket: Chrome review 14 Sep pass 4, D14
Reversible: yes
Precedent: yes — grep for every caller of the value, not the first one that
matches the symptom

## 2026-09-14 — a VAT invoice is one that charged VAT
Decision: `/i/[id]` titles itself "VAT invoice", prints the supplier's VAT
number and shows a Net/VAT/Total split only when the recorded VAT is greater
than zero. Otherwise it is an "Invoice" with a single Total and no VAT number.
Rationale: the D9 work gated on "the columns are recorded AND the supplier has
a VAT number", so an unregistered trade's £222 deposit came out headed "VAT
invoice", citing GB123456789, stating "VAT (20%) £0.00". A VAT number above a
zero rate tells a customer's accountant there is input tax to reclaim when
there is none. Same rule as the quote surfaces: the row follows the money.
Ticket: Chrome review 14 Sep pass 4
Reversible: yes
Precedent: yes

## 2026-09-14 — the invoice form seeds its due date from the trade's terms
Decision: `CreateInvoiceForm` takes `termDays` and seeds the date picker with
it; the job page derives it from `default_payment_terms` via `paymentTermDays`.
Rationale: the server default was fixed and the manual path never reached it —
the form pre-filled `defaultInvoiceDueDate()` with no argument and then SENT
that date, which overrides the server. Measured: /setup at 7 days, then 30,
then "On receipt", all three producing an invoice due in 14, while the
auto-raised deposit on the same job correctly honoured 7. A default that is
also submitted is not a default.
Ticket: Chrome review 14 Sep pass 4, D13
Reversible: yes
Precedent: yes — a client-side default that is sent as an explicit value
silently outranks the server's

## 2026-09-14 — customer-field edits count as unsaved work
Decision: `unsavedCount` counts the four customer fields against a saved
baseline, and a save refreshes that baseline.
Rationale: `setDirty(true)` already fired on those fields, but the amber banner
is gated on `dirty && unsavedCount > 0` and `unsavedCount` only ever compared
line items — so a customer-only edit set the flag, showed nothing, raised no
navigation prompt, and was discarded on reload. Isolated on 14 Sep: the voice
hint clears (React registered the edit), and the field reads its old value
after a refresh. The earlier fix addressed the flag and not the counter that
gates it.
Ticket: Chrome review 14 Sep pass 4, D2
Reversible: yes
Precedent: yes

## 2026-09-14 — a P&L may not invent the VAT it is missing
Decision: `getJobPnL` derives "Invoiced (net)" from each invoice's recorded
`vat_amount`; a row that records none contributes its GROSS and clears a
`netIsExact` flag, and the card then drops the "(net)" from the label rather
than estimating a sixth of gross.
Rationale: the card read "Invoiced (net) £3,620.28" against a net of
£3,016.90, setting gross revenue against net costs and asserting the wrong
number was the right kind. Taking a sixth for unrecorded rows is the same
invention D14 was about, and migration 80 deliberately did not backfill — so
the honest answer for those is a plain label, not a guessed figure.
Ticket: Chrome review 14 Sep pass 4, D15
Reversible: yes
Precedent: yes — where a figure's kind cannot be established from the record,
drop the claim, never estimate the figure

## 2026-09-14 — an invoice describes the supply, unpriced
Decision: `/i/[id]` and its receipt itemise the quote's line items with their
extent ("Reskim hallway ceiling — 12 m2") under a heading naming what the
amount is against ("For" / "Deposit against"). No line carries a price.
Rationale: the first pass put `extracted_json.job_type` under "For", which
names a trade, not a supply — a VAT invoice must identify the services and
their extent, and an accountant bounces "For: Plastering" on £3,620.28.
Pricing the lines would put arithmetic on a deposit invoice that does not
reach its own total; the amount is stated once, in the totals block.
Ticket: Chrome review 14 Sep pass 4, D9 (second half)
Reversible: yes
Precedent: yes

## 2026-09-14 — retiring tests/acceptance/457.test.tsx's vat_amount assertion
Decision: the assertion that `getJobPnL`'s invoices select must not read
`vat_amount` is retired; the `quote_id` half of the same test keeps running.
Rationale: #457 wrote it when no such column existed. Migration 80 created
`invoices.vat_amount` and D15 requires the P&L to read it — the two contracts
are mutually exclusive. Authorised by Jacob, 14 Sep. A second frozen assertion
in the same file pins the literal "Invoiced (net)" label; that one is NOT
named on the card, so per condition 4 the implementation was narrowed to
satisfy it (only an explicit `netIsExact: false` drops the label) rather than
retired.
Ticket: Chrome review 14 Sep pass 4, D15
Reversible: no — a retired assertion is gone
Precedent: no

## 2026-09-14 — a legacy quote shows its stored total and asserts no VAT
Decision: `quoteTotalsForDisplay`'s fallback no longer recomputes from
`vat_registered`. A row with no recorded split returns `{subtotal: total,
vat: 0, total}`. Only a row with NO stored total at all (an unsaved draft)
computes from line items.
Rationale: the fallback was the last path by which a quote still moved on a
checkbox — the whole defect migration 80 exists to end. Measured 14 Sep on a
signed job: headline £450.00 beside a quote block reading £540.00 on the same
screen, /q/[id] and the PDF agreeing with £540, and the invoice billing £450.
The divergence guard then told the customer the trade had "since updated this
quote to £540.00, which is … the one that applies". Nobody touched the quote.
Ticket: Chrome review 14 Sep pass 5, the single named next fix
Reversible: yes
Precedent: yes — where a split is unknown, show the total and assert nothing;
never compute a historical figure from a current setting

## 2026-09-14 — a recorded payment is not a settlement
Decision: `buildSentBanner` takes `jobClosed` (deriveJobState's own verdict) and
only claims closure when it is true. Absent is treated as not closed.
Rationale: recording a £118.80 deposit on a £475.20 job announced "The job is
now closed and reminders have been stopped. Nothing else needs you." with
£356.40 outstanding and uninvoiced — contradicting, within one interaction, a
confirmation dialog that had correctly said the balance stays open. The banner
is the half that survives on the page.
Ticket: Chrome review 14 Sep pass 5
Reversible: yes
Precedent: yes — a banner that reports state takes the state from the deriver,
never from the fact that an action just succeeded

## 2026-09-14 — clause 2 asserts a split only where one was stated
Decision: the Labour/Materials rows render only when something is categorised
as materials; the VAT row only when VAT was charged. Both templates that carry
the table (standard_project, large_staged_project) are gated.
Rationale: `other` falls into labour, which is the right assignment — but the
editor's Kind field DEFAULTS to Other, so a hand-typed quote lands 100% labour.
Three lines left as Other printed "Labour £740.00 · Materials £0.00" on a job
containing £180 of bonding: more misleading than the unlabelled row it
replaced, because it names the wrong thing confidently. On an all-labour job,
"Materials £0.00" is noise. Retroactive by construction — it fixes every
contract rendered from here, including from quotes already stored, which is why
it lands before making Kind a required choice.
Ticket: Chrome review 14 Sep, D10 — approved by Jacob
Reversible: yes
Precedent: yes — same rule as the recorded-VAT columns; an unknown split is not
a zero one, and a document asserts only what it knows

## 2026-09-14 — a date on the tracker means the row happened
Decision: `buildJobTimeline` carries a row's date only when its state is
complete or forced. `deriveStages` still returns a date for any stage with
evidence behind it; the timeline gates on state, as the pipeline stepper
already did.
Rationale: on a part-paid job the Paid row rendered an empty circle carrying
"14 Sept 2026" while Invoiced above it was the unticked current action — a
dated row below an outstanding one says the job was paid before it was
invoiced. `paid.date` is the FIRST settled invoice's paid_at, which on a job
that took a deposit is the deposit.
Ticket: Chrome review 14 Sep pass 5 — approved by Jacob
Reversible: yes
Precedent: yes
## 2026-09-14 — the invoice that settles a quote takes the VAT remainder
Decision: `invoiceVatFor` accepts the invoices already raised against the quote.
When this one settles it, its VAT is the recorded total minus what is already
allocated, rather than its own rounded share. It falls back to the share when a
sibling recorded no VAT at all, since there is nothing honest to subtract from.
Rationale: quote 3e6de1ad recorded £603.38 and its 25/75 split landed both
shares on a half-penny, so both rounded up and two receipts headed VAT INVOICE
claimed £603.39 between them. It propagated into "Invoiced (net) £3,016.89"
against a contract subtotal of £3,016.90, and left the deposit's VAT not quite
20% of its own net. Apportion the parts and let the last absorb the rounding —
the standard rule, and it makes "the parts sum to the whole" true by
construction rather than by luck of the split.
Ticket: Chrome review 14 Sep pass 6, SERIOUS — "Harriet's penny survives"
Reversible: yes
Precedent: yes — any figure allocated across rows from a recorded total
reconciles to that total, with the final row taking the remainder

## 2026-09-14 — how a legacy quote's missing VAT split is recovered
Decision: `total / sum(line items)` is either 1.2 or 1.0, and that decides it:
1.2 means the old code grossed the total up while registered, so subtotal is the
line sum and VAT is the difference; 1.0 means no VAT was charged, so VAT is zero.
Anything matching neither is SKIPPED and named, never apportioned. Nothing
already recorded is overwritten, and `quotes.total` is never written.
Rationale: pass 5 rightly stopped asserting a split nobody recorded, but on the
26 rows the old code had grossed up that leaves line items not summing to the
total on a customer page with a live Accept button, and leaves the money card
guessing a sixth of gross — right for 13 quotes and an invention of ~£1,760 on
the other 7. The two hypotheses are 20% apart, so no rounding window can confuse
them; this restates what the old code did rather than deciding anything new. The
`net` branch looked like a tax judgement and is not: every contract carries a
`vat_registered` snapshot from generation, and all seven matching rows were
generated while the trade was unregistered.
Ticket: Chrome review 14 Sep pass 6, CRITICAL 3 / D14 / "Owed (net)"
Reversible: no — a data backfill. Written and dry-runnable; applied by a human.
Precedent: yes — recover a historical figure from what the code demonstrably
did, or refuse; never from what a current setting says

## 2026-09-14 — a conditional row's label is a variable, never a nested section
Decision: `render-template.ts` stays a single non-recursive pass, and any value
inside a conditional row is precomputed into a plain variable
(`priceTableControls` in build-variables.ts, shared by the builder and the
repair path). Sections are never nested.
Rationale: #757 gated the clause 2 VAT row with `{{#charged_vat}}` while leaving
`{{#vat_registered}}` inside it. The outer match consumes its inner text
wholesale and `String.replace` never rescans a substitution, so every contract by
a registered trade that charged VAT PRINTED
`| VAT{{#vat_registered}} (VAT no. GB123456789){{/vat_registered}} | £148.00 |`
— template source on the document the customer signs. Two gates should have
caught it and neither did: the row only renders when `charged_vat` is set and
the golden fixture never set it, so the golden was re-baselined on a table with
no VAT row; and the branch test asserted `toContain("GB123456789")`, which stays
true with the tags leaked. The same absent-control trap deleted Labour,
Materials and VAT from every contract the repair script touched, because stored
rows carry none of the three.
Ticket: found rebasing pass-6 work onto #757, 14 Sep
Reversible: yes
Precedent: yes — a fixture for a golden populates every control in its
rendered-ON state, and "no template source survives rendering" is pinned as a
standing property over every branch rather than case by case

## 2026-09-15 — clause 2 withholds the split unless it accounts for every line
Decision: the Labour/Materials pair renders only when every charged line is
`labour` or `materials` and none is provisional. Any `travel`, `callout` or
`other` line, or any provisional sum, and clause 2 shows Subtotal and Total and
says nothing about composition.
Rationale: `labourCost` is `subtotal - materialsCost`, so everything that is not
materials was reported to the customer as labour. A hand-priced job with one
line of each kind put `LABOUR £1,000 · TRAVEL £50 · CALLOUT £100 · OTHER
(provisional) £150` on the quote PDF and `Labour £1,300.00` on the contract —
two documents in one inbox, £300 apart on the number a day-rate dispute turns
on, with the signed one governing. #757 stopped the table asserting a split when
it knew nothing; this stops it mis-asserting when it knows something.
Deliberately the conservative fix: it can only withdraw a claim, never add one.
Giving the table a row per category would tell the customer more and would match
what the quote PDF already shows them, but that changes what a signed document
asserts and is Jacob's to decide, not the code's.
Ticket: Chrome review 15 Sep pass 7, CRITICAL 1
Reversible: yes
Precedent: yes — a derived summary may only be shown where the derivation
accounts for everything it is summarising

## 2026-09-15 — a provisional sum may not repeat the stated fixed price
Decision: when pricing mode is `fixed`, a provisional line whose total EQUALS the
stated amount is flagged and blocks the send. It is not deleted and not
auto-corrected.
Rationale: provisionals are excluded from every reconciliation in
stated-price-guard — correctly, since a fixed price covers the defined works and
not the allowance beside it — but they are NOT excluded from what the customer
pays. Quote 09F065E5 went out at £1,248 for a job priced at "£520 plus VAT"
because the draft marked the defined works provisional and priced it at £520;
reconcileStatedPrice compared £520 stated against £520 of defined works and
agreed, and the double-charge check skips provisional lines outright. Wrong, and
self-consistently wrong. Jacob, asked drop-vs-flag: "a warning against deleting
priced work" — so the contractor resolves it, the code never removes a priced
line on its own judgement (quote 46E3D510 lost £555.98 that way). Exact equality
is the duplicate's signature and all this claims; a larger allowance beside a
small fixed price is unusual but coherent and is left alone. The send block is
DERIVED at the point of the check, not read from contractor_flags_json, so
quotes saved before this shipped are covered without a backfill.
Ticket: Chrome review 15 Sep pass 7, CRITICAL 2
Reversible: yes
Precedent: yes — anything included in what the customer pays must be inside at
least one reconciliation; "excluded by design" is only safe for figures that are
also excluded from the total

## 2026-09-15 — archived is its own situation, and a stage row may not un-tick
Decision: three changes to what a job page reads from the record.
  - `archived` is an explicit terminal situation (`quote_archived`, status
    "Archived", move "none"). It used to match none of draft/sent/declined and
    fall through to "accepted from here on".
  - `quote_sent` ticks on EVIDENCE (`sent_at`), or on a status that is itself
    downstream of sending — never on "not draft" alone.
  - `depositOnly` no longer depends on the deposit being PAID, and a 100%
    deposit is not "deposit only" at all.
Rationale: job 30FAEF2A — archived, with sent_at, accepted_at and declined_at all
null — showed "✓ Accepted — Send a contract to sign" in the banner, "Accepted &
signed — Your move" in the tracker, "Declined" in the quote panel, and live
Accept/Decline buttons on /q/. Four surfaces, four answers, each landing in a
different default. And because `depositOnly` required a settled deposit, paying
one FLIPPED Invoiced from ticked to unticked — the headline reverting to "Raise
an invoice to get paid" on a job already invoiced and part-paid. Whether a job is
only-a-deposit is a fact about which invoices exist, not about whether money has
arrived. The 100% carve-out uses `deposit_pct`, already on the contract, and is
what lets a job settled entirely by deposit finally close.
Ticket: Chrome review 15 Sep pass 7, CRITICAL 3 and SERIOUS 1
Reversible: yes
Precedent: yes — a pipeline row is a record of something that happened, so it
settles once and never goes backwards; and every status a column can hold gets
an explicit branch rather than a fall-through

## 2026-09-15 — a quote response reports whether it applied
Decision: `acceptQuote` and `declineQuote` return "applied" | "not_open", and
/q/ offers the buttons only while the quote is `sent`.
Rationale: both actions correctly guard on `.eq("status", "sent")`, but returned
undefined indistinguishably from success, and the page ran
`setCurrentStatus("accepted")` on the next line. On archived quote B3112196 — out
of the contractor's pipeline, still fully public — a customer could press Accept,
be told "You accepted this quote.", and have nothing written anywhere. The
contractor would never learn they had said yes. Reported as "Accept silently
no-opped", which is what it looks like from outside.
Ticket: Chrome review 15 Sep pass 7, CRITICAL 3 / cosmetic "silently no-opped"
Reversible: yes
Precedent: yes — an action whose guard can legitimately match no row reports
that to its caller; the caller never assumes success

## 2026-09-15 — a VAT position belongs to the invoices, not to the checkbox
Decision: `showsVatPosition({ vatRegistered, hasChargedVat })` gates every VAT
figure on the money card. A trade that deregisters keeps its VAT position while
any paid invoice records VAT above zero; a trade that has never charged any still
sees nothing. `hasChargedVat` reads the RECORDED column only — never
`paidInvoiceVat`, whose sixth-of-gross fallback is a guess and must not be what
keeps a liability on screen.
Rationale: all three VAT figures were gated on `vat_registered` alone, so
unticking the box did not move them, it deleted them. Measured 15 Sep: "VAT to
set aside −£3,075.36" and "VAT collected (all time) £3,075.36" both GONE on
reload, on invoices that still display GB123456789 to the customer. A trade that
deregisters was shown it owes HMRC nothing on VAT it genuinely charged.
The fetch that answers the question now runs unconditionally, because the rows
are what decide the gate. It uses only `.eq()`: the frozen contract in
tests/acceptance/364 builds its Supabase stub by hand and implements nothing
else, and a first attempt using `.gt()` broke 27 of its assertions — the file's
own comment warns about exactly that, and nothing downstream may repair it.
Ticket: Chrome review 15 Sep pass 7, SERIOUS 2
Reversible: yes
Precedent: yes — a historical liability is shown from the record that created it,
never from a current setting; and a derived fact needed by a gate is computed
from rows already fetched rather than by a new query a frozen stub cannot answer

## 2026-09-15 — clause 2 shows one row per kind of charge
Decision: the price table renders a row for each of labour, materials, travel,
call-out, other works and provisional sums, showing only the ones present, and
withholding the breakdown entirely when every line falls in one bucket.
Provisional sums get their own row out of whatever category they carry.
Rationale: supersedes the same-day conservative fix, at Jacob's direction. The
two-row table took labour as `subtotal - materials`, so travel, call-out, `other`
and provisional sums were all reported to the customer as labour — £1,300.00 on a
job with £1,000 of it, contradicting the quote PDF in the same inbox. Withholding
the split fixed the falsehood but lost information the app already had: the quote
PDF groups by these exact categories, so the contract now shows the same ones and
the two documents agree. The one-bucket case keeps #757's rule because the row
would only restate the subtotal — which is also the honest answer for a quote
where Kind was never touched. Every charged line lands in exactly one bucket, so
the rows foot to the subtotal.
Ticket: Chrome review 15 Sep pass 7, CRITICAL 1 (richer form)
Reversible: yes
Precedent: yes — where the data already carries a distinction the customer is
shown elsewhere, the document shows it too rather than flattening it

## 2026-09-15 — the fee line says when the fee applies
Decision: both fee sentences state the condition. The mark-as-paid line reads "A
£X Motko service fee applies when a customer pays through motko. Recorded as
paid another way, nothing is taken from this one."; the projected line reads "…
will apply if they pay through motko. Paid another way, there is no fee."
Rationale: the mark-as-paid dialog records money that arrived OUTSIDE motko, so
settlement writes fee_status not_applicable and the job page reads "£0.00 —
nothing charged on this payment". Announcing £9.90 twice and then charging £0.00
on the same job is a contradiction the contractor cannot resolve. The rates were
never wrong. The FIGURE stays in both sentences: tests/acceptance/467 is frozen
and pins the two lines to the same fee for the same job, so a contractor is
never shown two numbers for one charge — and that contract is satisfied rather
than retired, which an implementer may not do anyway.
Ticket: Chrome review 15 Sep pass 7, SERIOUS 4
Reversible: yes
Precedent: yes — copy that promises a charge names the condition under which it
is taken

## 2026-09-15 — a part-invoice says what it is a part of
Decision: a VAT invoice raised after an earlier one against the same quote shows
"Job total (net)" and "Less already invoiced" above its own net. Silent when it
is the only invoice, and silent whenever the quote's or an earlier invoice's VAT
was never recorded — `invoiceNet` returns null there rather than guessing.
Rationale: a final invoice describes the whole scope and charges only the
balance. Invoice FCE6A164 listed the full scope then "Net £693.00" against a
quote whose lines come to £990.00 net, with nothing reconciling the £297.00, on a
document a bookkeeper files. Structurally the same complaint the legacy-quote fix
repaired: items that do not sum to the net with nothing explaining why.
Ticket: Chrome review 15 Sep pass 7, SERIOUS 6
Reversible: yes
Precedent: yes — where a document's figure is a part of a larger one, it names
the whole and the deduction, or it says nothing at all; never a guessed net

## 2026-09-15 — a number the extractor rejects is refused, not deleted
Decision: the stated-price extractor drops a candidate outright only when it is
not a price at all — a bare number with no currency marker sitting in front of a
unit of measure or packaging ("148 square metres", "26 bags"). Anything that is
a price but cannot be locked — a rate, a range, a hedge — stays on the record as
`refused: true`. Time units are therefore deliberately outside the quantity
guard: "two fifty a day" is a rate, and `containsRateUnit` refuses it visibly.
Rationale: the two are different claims and only one of them is safe to make
silently. A refused price still reaches the run view and the unattached-price
flag, so the contractor learns what became of a number they said; a deleted one
teaches them nothing. Voice runs 01 and 05 quoted a phantom £148 and £110 read
out of wall areas, which is the case that has to disappear entirely — nobody
stated a price there to account for.
Ticket: voice harness runs 01–05, 15 Sep
Reversible: yes
Precedent: yes — silence is reserved for input that was never a price; every
rejected price is recorded as rejected

## 2026-09-15 — an invented day count is labelled, not zeroed
Decision: where intake captured no duration (and no crew, once a line carries
more than one person), the labour line comes out `assumed: true` with
`provenance: system-generated`, an assumption note, and an editor flag — but
keeps its figure. `CompileContext.labour_plan` is OPTIONAL and its ABSENT form
takes the strict branch, which is the opposite shape to `has_pricing_history`:
that one had to be required because forgetting it was permissive (PFIX-4), and
here forgetting it is conservative. Made required first; that broke seventeen
literals across two frozen acceptance files, one of which another open branch
also edits, and `cross-branch-collisions` refused it — correctly, since a frozen
contract cannot be reconciled by whoever merges second.
Rationale: the rate was always the contractor's; the day count is the model's,
and nothing told the two apart. Voice run 05 billed three people at eight days
each off a null labour_plan, at real rates, attributed to the contractor. D16
already refuses to invent a material price — this closes the same hole on the
largest line of most quotes. Labelled rather than zeroed because, unlike a
material with no price behind it, a labour line has a real rate and a defensible
figure: a £0 there reads as "included at no charge", which is a worse claim than
a number worth checking.
Ticket: voice harness runs 01-05, 15 Sep
Reversible: yes
Precedent: yes — provenance describes the half of a figure the model supplies,
not the half the contractor's account supplies; where only one half is sourced,
the line says so rather than inheriting the sourced half's credibility

## 2026-09-15 — the sow's material prose is not a second pricing channel
Decision: material prices are recovered from the TRANSCRIPT via
`extractStatedPrices`, not by parsing `materials_supply.contractor_supplied`
prose into `known_material_prices`. The sow prose is left as a record of what
was captured, with no pricing authority.
Rationale: the plan was to read the prose because captured prices never reached
compile. Checked against the three harness jobs first: every material price is
in the contractor's own transcript turn, and after the extractor fix (#761) all
of them extract. The prose was never the only copy. Adding it as a second
channel would also override a deliberate refusal — a hedged "around £10" is
refused on purpose, while the voice model's prose records a firm figure, so the
prose would silently outrank the guard. The real breaks were downstream: a
sentence-wide `each`, an item name carrying its preposition, and `unpriced`
surviving a stated price.
Ticket: voice harness runs 01-05, 15 Sep
Reversible: yes
Precedent: yes — one authority per fact. A summary written by a model is not
evidence about what was said; the transcript is.
## 2026-09-14 — #727's five decisions, recorded so QA cannot re-raise them
Decision: Jacob's ruling of 13 Sep, verbatim. (1) An edit voids the acceptance,
and only up to the point of the contract — once a contract exists the quote is
not editable at all, signed or unsigned. (2) Re-acceptance is required. (3) The
old quote is overwritten, not retained as a superseded version. (4) The
contractor triggers the re-issue; the customer is told by email AND SMS. (5) No
downstream reversal — the gate at the contract means nothing downstream exists.
Rationale: the card carries these and AGENTS.md requires the implementing
commit to record them here, because QA cannot see the card and has re-raised
settled questions before. The premise for (5) was verified and holds: deposits
are raised on contract signature, payment stages lazily inside the
invoice-raising path, and chase state hangs off invoices and stages — so none
can exist before a contract. If any of those three ever moves earlier, this
decision needs revisiting rather than working around.
Ticket: #727
Reversible: yes
Precedent: yes — a rule about what may be edited takes its inputs from the
state that actually decides it, not from a status list that approximates it

## 2026-09-14 — the re-issue copy is approved and may not be varied
Decision: the email and SMS strings in `src/lib/reissue-notice.ts` are Jacob's,
approved 13 Sep, including the scope-only variant for an edit that changes the
SoW without moving the total. The sentence "Because the quote has changed, your
earlier acceptance no longer stands" is identical in every variant.
Rationale: customer-facing copy is on the AGENTS.md escalation list, so this
approval IS the human decision that unblocks the item. That sentence is the
only place the customer learns their agreement is gone; anything gentler leaves
them believing they are still covered, which is the failure the item exists to
prevent. `src/lib/sent-quote-copy.ts`'s "PROPOSED, NOT APPROVED" banner is
updated in the same commit — leaving it above approved strings is how the next
agent concludes it may rewrite them.
Ticket: #727
Reversible: no — varying approved customer copy needs Jacob again
Precedent: yes

## 2026-09-15 — the job page keeps a read-only quote summary in every state
Decision: #750 moves the quote EDITOR to /jobs/[id]/quote, but the job page
goes on showing the quote's line items and total in all four states (draft,
sent, accepted, declined), with the "Price it up" / "Review the quote" link
inside that same card. The editor is what moves; the figures are not.
Rationale: CLAUDE.md makes the job page the single source of truth for what has
happened on a job, and a job page that cannot tell you what the quote came to
does not meet that — the branch's first shape hid the figures entirely on a
draft or sent job. Showing the card unconditionally also removes a branch
rather than adding one, and keeps two frozen assertions in 732.test.tsx alive
that would otherwise have been retired to accommodate a behaviour nobody asked
for.
Ticket: #750
Reversible: yes
Precedent: yes — moving a form to its own route never takes the record of what
the form produced with it

## 2026-09-15 — a route reachable by id authorises the row, not just the session
Decision: /jobs/[id]/quote scopes its job read with
`.eq("contractor_id", contractor.id)`, as /jobs/[id] always has, and 404s
indistinguishably for a stranger's job and a nonexistent one.
Rationale: the route's first shape authenticated on getUser() alone, so any
signed-in contractor could open /jobs/<someone-else's-id>/quote and both read
and re-price a stranger's quote — the editor's server actions take the ids the
page hands them. Authenticating the user is not authorising the row. Bound by
tests/regression/quote-route-scopes-to-its-contractor.test.tsx, which asserts
the FILTER rather than the rendered output: a stub returns whatever it was
handed, so asserting the output would pass with the predicate deleted.
Ticket: #750
Reversible: no — this is a live exposure if it regresses
Precedent: yes — every new route that takes an id in its path scopes the read
by owner, and is tested on the predicate
## 2026-09-15 — an unattached stated price is flagged, never turned into a line
Decision: when a stated price matches no line item, it stays a contractor flag.
It is NOT added to the quote as a line of its own, even though that would stop
the figure disappearing.
Rationale: tried it, and the pipeline fixture caught a double charge. An
unattached price cannot be told apart from one the model already charged under
a different name — scenario-1's "£3,200 for the two of us for five days"
matches no line by description, and recovering it added £3,200 on top of a
labour line that already billed those days. Both cases look identical from
inside the compiler, and one of them overcharges a customer. Voice run 10 loses
£620 and £240 this way and that is the lesser harm; the real fix is the
drafting prompt not itemising a stated lump sum into invented components, which
needs the pipeline recordings re-made against the live model.
Ticket: voice harness runs 06-10, 15 Sep
Reversible: yes
Precedent: yes — where two causes are indistinguishable and one overcharges,
the compiler reports rather than acts

## 2026-09-15 — the quote's deposit is the deposit, everywhere
Decision: `quotes.deposit_pennies` wins; `contracts.deposit_pct` applies only
where the quote records none; a recorded zero means no deposit and is never
overridden. One resolver (`resolveDeposit`) is used by the contract body, the
/c/ page, the contract PDF and the signature trigger, and the contract form
states the quote's figure rather than offering a second editable field.
Rationale: approved by Jacob after the pass-7 review found a customer signing a
contract that said £3,600 was due on completion and nothing up front, then
receiving a £900 deposit invoice seconds later with automated chasing attached.
The trigger read the quote; the document read only `deposit_pct`, in three
separate copies of the arithmetic. Two sources that do not talk to each other
is the defect; the symptoms were downstream of it.
Ticket: pass-7 review, CRITICAL 1 / SERIOUS 4
Reversible: yes
Precedent: yes — where two columns can state one fact, exactly one function
resolves them and every surface calls it

## 2026-09-15 — the Invoiced row means an invoice was issued, nothing more
Decision: `invoiced.complete = invoices.length > 0`. A deposit invoice ticks it.
Whether the job is fully invoiced or settled is the Paid row's question and the
status panel's copy, not this row's.
Rationale: the row has now been wrong in BOTH directions in three days — it
ticked Paid on a settled deposit (13 Sep), then un-ticked on payment (15 Sep),
then denied a deposit invoice outright (pass-7). Every one of those came from
making Invoiced answer part of Paid's question. Independence from payment is
also what makes it monotonic, so it cannot flip. The full history and the rule
are in the header of
tests/regression/the-tracker-agrees-with-the-headline.test.ts — read it before
changing this a fourth time.
Ticket: pass-7 review, CRITICAL 4
Reversible: yes
Precedent: yes — a tracker row answers one question and never borrows another's

## 2026-09-15 — reconciliation is not a VAT question
Decision: "Job total" and "Less already invoiced" render on every invoice that
is part of a larger job, registered or not.
Rationale: they were nested inside the VAT branch, so an unregistered trade's
customer got a £682.50 bill for a £910 job with nothing accounting for the
difference. No new computation was needed — `invoicePartOfJob` was already
VAT-agnostic.
Ticket: pass-7 review, SERIOUS 3
Reversible: yes
Precedent: no
## 2026-09-15 — a stated crew plan is a ceiling the draft cannot exceed
Decision: where intake captured both `duration_days` and `people_count`, the
labour line may bill at most `duration_days × people_count` person-days. A draft
exceeding that by more than 5% is scaled back proportionally, marked
`assumed: true` with `provenance: system-generated`, and flagged to the
contractor naming both figures. The cap never scales a crew UP.
Rationale: #762 labels days nobody stated; this is the half that costs money.
Voice run 11 stated owner 3.5, Daniel 5, Liam 2 and the quote billed ten days
each — £6,200 against £2,275, with nothing flagged, because a duration and a
crew HAD been captured so the line looked sourced. `labour_plan` never records
the per-person split, so a ceiling is the most that can be derived: it
over-counts a staggered crew deliberately, because a guard must never pull an
honest quote down. Capped rather than refused because the rate and the work are
real and only the day count is wrong — a bounded figure the contractor is told
to check beats an unbounded one and beats no figure.
Ticket: voice harness run 11, 15 Sep
Reversible: yes
Precedent: yes — where the contractor stated a bound, the compiler enforces it
rather than trusting the model to have honoured it

## 2026-09-15 — a discount is not shipped as a negative line item
Decision: `unit_price` and `suggested_amount_pence` stay non-negative. A draft
line the model cannot express is dropped and reported to the contractor, not
coerced. A first-class discount is deferred to its own item.
Rationale: the drafting model reaches for a negative provisional whenever a
script mentions a discount, and that killed run 14's whole draft. Relaxing the
schema would let ANY line go negative, including a model-invented material at
minus £500 — a new invention surface on the one path D16 exists to close. A real
discount touches the quote total, VAT, the PDF, clause 2's price table, the
invoice and the P&L, and needs a decision about where it may come FROM: a
contractor who says so, never a model that infers one.
Ticket: voice harness run 14, 15 Sep
Reversible: yes
Precedent: yes — a shape the model keeps reaching for is a feature request, and
widening a schema to absorb it is how invention gets in

## 2026-09-15 — an unattached correction belongs to the nearest PRECEDING price
Decision: an amount stated with no item of its own joins the priced item whose
last mention is closest and earlier; a later item is considered only when
nothing precedes it in the window. The window itself is unchanged.
Rationale: the old rule took the first group created inside the window, and a
correction is spoken after several things have already been priced, so it
reached back past the item being corrected. Run 20's "Actually, no, £48" landed
on the finish price four sentences earlier, zeroing a correctly captured
£11.20 and leaving the superseded £60 delivery charged. A correction refers to
what was said most recently — that is a property of speech, not a heuristic.
Ticket: voice harness run 20, 15 Sep
Reversible: yes
Precedent: yes — where an extracted fact must be attached to one of several
candidates, proximity in the transcript decides, never iteration order

## 2026-09-15 — a bare number needs a reason to be money
Decision: a number carrying no currency marker, followed within three words by
a CAPITALISED street type, is a house number and is stepped over — not
recorded, not even as a refusal. Same treatment as a quantity followed by a
unit.
Rationale: run 20's opening put the customer's name and site address into one
breath and the house number reached production as a stated price of £2,020,
attributed to an item named from the customer's own name. Nothing between a
bare integer and a chargeable price asked whether the sentence was about money.
The capitalisation condition is load-bearing rather than incidental: half the
street-type list are ordinary job words, and "three hundred for the drive" is a
price while "40 Green Lane" is an address.
Ticket: voice harness run 20, 15 Sep
Reversible: yes
Precedent: yes — the default is being narrowed from "money unless proven a
quantity" towards "money where there is a reason to think so", one evidenced
pattern at a time

## 2026-09-15 — item names are matched on whole words, with a length floor
Decision: containment matching between item names requires the contained name
to be at least three characters and to sit on word boundaries (an optional
plural "s" still matches). Exact matching is unchanged at any length.
Rationale: containment was a bare `includes`, so `"waste".includes("s")` was
true. Run 19 produced the item name "s" — `\w` does not span an apostrophe, so
"The equipment's £45" took only the possessive — and £45 hire, £12 parking and
£165 waste then grouped as one item and superseded one another. Grouping by
item decides supersession, so a loose match does not merely mis-label a line,
it destroys prices that were captured correctly.
Ticket: voice harness run 19, 15 Sep
Reversible: yes
Precedent: yes — fuzzy matching on contractor-spoken text carries a minimum
length, because the short accidental token is the one that matches everything

## 2026-09-15 — the crew's days go in the plan, per person
Decision: `labour_plan` gains `crew_days` — a list of {name, days}. Where it is
recorded and the names cover the line's people one-to-one, those days SET the
labour line; where it is recorded at all, its sum is the crew-day ceiling.
`duration_days` keeps its meaning: how long the JOB runs, never the sum of
everyone's days.
Rationale: contractors say "me four days, Daniel five, Liam three", and there
was nowhere for it to go. Run 16's 2/3/1 was stored as people_count 3 /
duration_days 2 and billed two days each — the right total person-days at the
wrong rates, £1,240 against £1,310, which no ceiling could ever catch because
the total was correct. Runs 18 and 20 put the sum, and the owner's own days,
into duration_days and left people_count null, so #768's ceiling was inert in
both runs that overbilled.
Assignment is all-or-nothing: a plan that does not cover the line's crew
exactly is used only as a bound, because a partial assignment mixes two
accounts of the crew and can total what neither of them says.
Ticket: voice harness runs 16, 18, 20, 15 Sep
Reversible: yes
Precedent: yes — where the contractor stated a fact per person, the compiler
uses it per person rather than deriving an aggregate from it

## 2026-09-15 — a restated labour line is not an estimate
Decision: when stated crew days replace the draft's, the line's provenance is
`contractor` and `assumed` is false, with a note and a contractor flag naming
what moved. The capped case keeps `assumed: true`.
Rationale: the two are different facts and the contractor acts on them
differently. Capped means a bound was hit and the real split is unknown.
Restated means every day on the line was named by the contractor, person by
person — the compiler is more certain than the draft it was given, not less,
so an "Est." chip would be a false warning. The total may not have moved at
all, so the flag says what did: the split, and therefore the price.
Ticket: voice harness run 16, 15 Sep
Reversible: yes
Precedent: yes

## 2026-09-15 — work kept out of the price is not a payable line
Decision: a line that is UNPRICED, is not labour, and describes work the
statement of work recorded as `excluded` or `provisional_sum` is dropped from
the quote and named in a contractor flag. The scope narrative still carries it.
Rationale: an option the customer is still choosing between arrives from the
drafting model as an ordinary line with no price behind it, so it lands
unpriced — and an unpriced line blocks the quote from being accepted at all.
Run 16's quote could not be accepted because of Option A, Option B and a
curtain track, all three of which the contractor had explicitly kept OUT of the
price; run 20's cornice did the same. The treatment was captured correctly
every time and simply never reached the decision.
Two conditions bound it: only an unpriced line is eligible, so no total can
move whatever the match decides, and a labour line is never eligible. The
second is measured rather than cautious — at a two-word threshold run 16's own
labour line matched the Option A/B note on "skim" and "ceiling", and three
words separates every real case with room to spare.
Ticket: voice harness runs 16, 20, 15 Sep
Reversible: yes
Precedent: yes — where a fuzzy match can remove something, restrict it to
things that carry no money, so the worst case is visible rather than costly

## 2026-09-15 — the assistant never promises a reduction
Decision: the intake prompt states that Motko cannot apply a discount,
reduction or goodwill gesture, and that one mentioned in the call is captured
in `assumptions_and_unknowns` and named to the contractor as a note for them to
apply — not as something the assistant has done.
Rationale: run 18's contractor offered £80 off and the assistant said it would
take it off. Nothing downstream can: there is no discount field, a negative
line is refused on purpose, and PRICE-D1 is unresolved. The quote came out
undiscounted with no mention of it. That is the worst shape a wrong answer can
take here, because it is the one the contractor cannot catch — said out loud
and never written down. Saying what is being RECORDED rather than what is being
done to the price is the general form, and the prompt says that too.
Ticket: voice harness run 18, 15 Sep
Reversible: yes — superseded the day PRICE-D1 ships
Precedent: yes — the assistant states what it captures, never what it changes
about a figure it cannot change

## 2026-09-15 — a hand-typed line starts as Labour, not Other
Decision: "+ Add line item" in the quote editor creates `category: "labour"`.
Rationale: "other" is never the right answer, only the unanswered one, and as a
default it decided what most typed quotes actually said — "Other works
£1,000.00" on the contract clause the customer signs, a plastering quote filed
under "OTHER" in the PDF, and a single bucket in clause 2, which correctly
withholds the breakdown when only one is used (#757's rule, unchanged). Labour
is the ordinary first line of a trade's quote and the Kind field is in plain
view on the line, so a materials line is one click to correct.
Ticket: pass-8 review, gate 2
Reversible: yes
Precedent: yes — a default that is never correct is worse than one that is
usually correct, where the field is visible

## 2026-09-15 — a receipt states when the money arrived, not when it was wanted
Decision: `VatInvoiceDetails` takes `paidAt`; where it is set the document shows
"Paid <date>" in place of "Payment due <date>".
Rationale: the paid receipt showed "Payment received / You paid £300.00" above
"Payment due 22 Sept 2026" — one document making two claims, and the stale one
is the one a customer acts on.
Ticket: pass-8 review, gate 4
Reversible: yes
Precedent: no
## 2026-09-15 — a dismissed address list stays shut
Decision: the address autocomplete's outside-click listener is attached for the
component's whole life rather than only while the list is open, and every
deliberate close bumps a generation counter AND cancels any debounced lookup.
A response is applied only if its generation is still current.
Rationale: the stale guard compared the query string alone, which cannot see a
dismissal — clicking away does not change what was typed. Three distinct
windows existed: a response landing after the click, a click landing before the
debounced request was issued, and a click landing after the list rendered but
before the effect attached its listener. The third is the one that failed
`tests/acceptance/676.test.tsx` on CI on a docs-only PR: the state change came
from a resolved promise rather than an event, so React scheduled the effect
asynchronously and the click hit no listener at all.
Reported as "an address dropdown can reopen after you click away" since the
runs 06-10 round and carried on the known-open list ever since.
Ticket: CI failure on #779, 15 Sep
Reversible: yes
Precedent: yes — a guard against a stale async result keys on an explicit
generation, never on whether some input value happens to have changed

## 2026-09-16 — one surface may not answer a question differently from another
Decision: the dashboard's row-to-situation mapping moves into
`dashboard-sections.ts` as `sectionForQuoteRow`, taking the row whole, and the
page calls it. Adding an input is then one edit in a tested module rather than
an argument someone remembers to pass.
Rationale: `deriveSituation` was correct throughout. #780 taught it to settle a
100% deposit from the quote's own total, because `contracts.deposit_pct` is
null on every deposit agreed on the quote (16 of 42 on production carry one at
all; exactly one is >= 100). `/jobs/[id]` was taught to pass `total` and
`deposit_pennies`; the dashboard was not, so it fell back to that null
percentage and filed a job PAID IN FULL under "accepted quotes awaiting
invoice" — a Final invoice for the whole job value, pre-filled, one click from
billing the customer twice. The job page read "Paid — nothing else needs you"
at the same moment. It also never passed `work_completed_at`, which it fetches.
Ticket: production review pass 9, finding 1 and 6
Reversible: yes
Precedent: yes — where two surfaces read one pure function, the MAPPING is part
of the function's module, because that is the half that drifts

## 2026-09-16 — a contract states a balance only when one exists
Decision: clause 3's balance line is gated on money remaining after the
deposit; where the deposit is the whole price the contract says so in terms.
Payment terms become their own sentence rather than a fragment appended to the
balance line.
Rationale: only the deposit line was conditional, so a 100% deposit rendered
both — the header said "Balance on completion £0.00" and twelve lines below it
the contract told the customer the remainder was due on completion. A customer
who has paid for the whole job in advance then signs a document saying they owe
more. Copy approved by Jacob, 16 Sep.
The terms field is free prose ("7 days", "Net 30", "payment on completion"), so
it cannot be wrapped in "payable within X" — hence a sentence of its own, which
also removes the bare "7 days." fragment.
Ticket: production review pass 9, finding 2
Reversible: yes
Precedent: no

## 2026-09-16 — a refusal says what it refused, and never blames the connection
Decision: the quote editor renders the authored reason a write path threw, and
only offers "Try again" when the failure is one retrying could fix. A new
`authoredMessage` reads the digest alone, so a raw error can never be presented
as the product's own words.
Rationale: both write paths said "check your connection and try again" for
every failure, including a quote locked by a contract and one already declined.
The contractor blames their signal and retries what cannot work, while the
editor keeps displaying the rejected figures beside a total that is really
something else. The server had thrown the reason all along.
`actionableMessage` falls through to `err.message` for anything React did not
redact — correct for logging, wrong for a screen, because outside a production
build a Supabase error would be shown as an explanation.
Ticket: production review pass 9, findings 8 and 9
Reversible: yes
Precedent: yes — a message that reaches a contractor as an explanation comes
from the digest, never from an error's own text

## 2026-09-16 — "from the call" requires a call
Decision: the customer-detail spelling hints render only where a transcript
exists. The gate moves into `captured-detail.ts` as `voiceHintFields`.
Rationale: the hints keyed on "is this field filled in", which is true of a
quote the contractor typed themselves — so after the first send their own
customer's name, email and address came back in warning red saying they came
from a call that never happened. Reproduced on three typed jobs. Without a
transcript there is nothing to check against either: the support lookup answers
"unsupported" for every field, which would print "This isn't in the call" under
a name typed a minute earlier.
Ticket: production review pass 9, finding 7
Reversible: yes
Precedent: yes — a condition that decides what the product CLAIMS lives in a
tested module, not in a useState initialiser

## 2026-09-16 — a stale tab finds out it is stale
Decision: `deploymentId` is set in next.config.ts from `VERCEL_DEPLOYMENT_ID`,
falling back to `VERCEL_GIT_COMMIT_SHA`, and undefined off Vercel.
Rationale: the same URL served two different deployments during the pass-9
review — assets from one `dpl_` on the first two loads and another after a
cache-busting query string, with no service worker registered. Reading a new
field twice and getting the old answer both times is indistinguishable from
"the deploy did not land", which is why "is the deploy live?" has opened
several reviews. Outside a review the cost is larger: a contractor with the app
open keeps running whatever build they loaded, so a fix shipped this morning
need not reach the person it was shipped for.
Next's own mechanism: a mismatch between the tab's build and the server's turns
the next client-side navigation into a hard one, and `data-dpl-id` on <html>
makes the running build readable rather than inferred from asset URLs.
Two limits, stated so nobody reads more into it: the reload happens on the next
NAVIGATION, not on a tab left sitting; and it does not change how the HTML
document itself is cached.
Ticket: production review pass 9, build gate
Reversible: yes
Precedent: yes — where the framework has a mechanism for a problem, use it
before writing one

## 2026-09-16 — the money does reach their bank, and Settings now says so
Decision: the Stripe Connect panel states that Stripe pays the balance out to
the trade's bank automatically, and points at the Stripe dashboard for the
schedule rather than naming one. "Paying it out to your bank isn't switched on
yet" is retired, along with the two regression assertions that pinned it.
Rationale: the sentence was untrue. `createConnectedAccount` has always set
`settings.payouts.schedule.interval: "daily"` — `git log -S 'interval:
"manual"'` finds no commit where it was manual — and an automatic schedule is
run by Stripe itself, so the absent `stripe.payouts.create` call proved
nothing. The transfer leg was there too: the payment intent carries
`transfer_data.destination`. Jacob confirmed against the Stripe dashboard on
16 Sep: payouts_enabled true, payouts made.
Both the earlier error ("Connected ✓", read as money arriving) and this one
came from reasoning about `stripe_payouts_enabled` from its NAME. It holds
`capabilities.transfers`; the gap between that and Stripe's real
`account.payouts_enabled` was read first as "payouts happen" and then as
"payouts do not happen", and neither followed.
No speed is claimed: `check-forbidden-copy.sh` rejects settlement-speed copy
(RAIL-3), and when money lands is Stripe's to state.
NOT renamed: `stripe_payouts_enabled` stays misnamed, per the owner decision of
2026-08-25 — renaming breaks frozen acceptance contracts in
tests/acceptance/216.test.tsx and bank-details-rail-gating.test.tsx, moves no
money and changes no behaviour. The documentation at its declaration now says
what may NOT be inferred from it, which is the part that kept going wrong.
Ticket: production review pass 9, finding 15
Reversible: yes
Precedent: yes — a claim about where someone's money is gets verified against
the payment provider, never against a field name

## 2026-09-16 — a crew plan that cannot be true does not set the labour line
Decision: `crew_days` is used only when the crew's TOTAL person-days fit
everyone working every day (`duration_days × head count`). A plan that exceeds
that is rejected whole, the line falls back to the ceiling, and the contractor
is told.
Rationale: #772 taught the compiler to SET the days from `crew_days`, which
fixed four of five runs and made the fifth much worse. Run 19's contractor
described three evening shifts of about five hours; intake wrote the HOURS into
crew_days (15/11/8 on a 5-day job), the guard trusted it, and a 15-person-day
draft became 34 — £7,370 against a correct £1,437.82. The mechanism built to
stop the model over-billing was handed a worse number than the model's and
preferred it.
The first version tested each person against `duration_days` and was too
strict: round 4 captured the same script as run 16 with duration_days 2 and a
correct 2/3/1 split, so a good plan would have been discarded. `duration_days`
is captured no more reliably than `crew_days`, and a guard that assumes one is
right will be wrong whenever it picks the wrong one. The sum against
duration × head count does not have to choose, and separates run 16 (6 of 6)
from run 19 (34 of 15) cleanly.
Ticket: voice harness round 5, run 19
Reversible: yes
Precedent: yes — a guard over two captured fields tests the relationship
between them, never one on the authority of the other

## 2026-09-16 — a voice cost keeps its VAT basis and its paid state, and asks when unsure
Decision: `draft_cost` reports `amount_basis`, `vat_amount_words`,
`vat_treatment` and `paid`; `resolveCostBasis` turns them into net, VAT and
treatment deterministically; and an ordinary VAT-bearing amount whose basis
nobody stated REFUSES to save, so the assistant asks "was that before or after
VAT?". Jacob's call, 16 Sep.
Rationale: the path carried one number. It parsed `amount_words` into
`amountNet`, hardcoded standard treatment and had no paid parameter, so "a
hundred plus twenty VAT, a hundred and twenty on the card" saved £120 as NET
and unpaid. Across five costs the money page showed £457.50 outstanding against
a true £177.50 — a double-payment risk if the contractor trusts it. The schema
has always had vatAmount, vatTreatment and paid; only this path never filled
them.
Splitting a gross figure at a known rate is arithmetic — VAT is defined as that
fraction. Assuming the basis, which is what shipped, is the invention. Asking
costs one turn; a wrong basis sits in the books silently. The question is not
asked where it cannot matter: zero-rated, exempt and reverse-charge costs have
the same net and gross, and a stated VAT amount already settles it.
Ticket: voice cost capture round 5, VOICE-COST-01 and 02
Reversible: yes
Precedent: yes — the model reports what was SAID and code does the arithmetic,
the same division of labour the amount parser already has

## 2026-09-16 — Does the unsourced-line rule spare a labour line whose DAYS are the model's but whose RATES are the contractor's?
Decision: yes. `compile-draft.ts`'s unsourced branch passes through a line with
`provenance.source === "contractor"` AND a labour line carrying real rates,
whatever its provenance says about the day count.
Rationale: for a labour line, provenance describes the DAY COUNT — the only half
the model supplies — while the rate is always the contractor's own, so a
`system-generated` labour line still has a defensible figure and zeroing it
replaces a number worth checking with no number at all (the compiler says so
itself at `compile-draft.ts:659-663`). `tests/acceptance/782.test.ts:324`
requires it, frozen; an implementation that narrows to contractor-provenance
alone fails the gate, which is what happened on `bc82238`.
The narrowing was proposed twice by QA, both times citing that the test's NAME
("…is still zeroed") disagrees with its body. The body is the contract. The name
is misleading and, being frozen, cannot be repaired — a note for the next PM,
not a defect in the implementation.
Ticket: #782
Reversible: yes
Precedent: yes — a QA finding that a test's name contradicts its body is a
finding about the name; never remove code a frozen acceptance test requires

## 2026-09-16 — The staged contract promises stage invoicing the product cannot do. Narrow the copy, or build it?
Decision: narrow the copy. `LARGE_STAGED_PROJECT` clause 3 becomes the deposit and
the balance on completion, in STANDARD_PROJECT's own sanctioned wording; clause 4
(retention) is removed and the clauses renumbered; the "Payment schedule (stages)"
box is removed from the contract form. Jacob's call, 16 Sep, escalated because it
is both customer-facing contractual copy and money.
Rationale: the clause said each stage becomes due once the Contractor has issued
an invoice for it, and Motko cannot issue one. There are two invoice types. A
second deposit is refused; a final requires the job marked complete and then bills
the WHOLE remaining balance. On a £24,000 four-stage schedule: stage 1 raises
£6,000, stage 2 is refused both ways, stage 3 raises £18,000. To get mid-job money
a contractor had to mark the work finished untruthfully and send one demand for
everything left — against a customer who signed for "25% at first fix".
Retention had no field and no mechanism anywhere; the word appeared only in that
clause. `payment_stages` is not a milestone system despite the name — it is a
Pay-by-Bank rail splitter, fixed 50/50, only above £10k, and all four signed
staged contracts on production have zero stage rows.
Building stage invoicing was the alternative and is the bigger, better product;
it was declined for now because it is substantial money work touching
`deriveInvoiceAmount`'s guards, and because all four live uses are £1.2k–£3.6k
jobs, which suggests the template is chosen for its programme, access, snagging
and Building Regs clauses rather than for staged billing.
Ticket: Chrome production review pass 9, finding 5
Reversible: yes — the copy can be widened again if stage invoicing is built
Precedent: yes — a contract clause may not promise a mechanism the product lacks,
and the fix is to narrow the clause unless the mechanism is built

## 2026-09-16 — one LIVE contract per quote, not one contract per quote
Decision: replace the UNIQUE constraint on `contracts.quote_id` (migration 11)
with a partial unique index excluding `withdrawn` and `declined`, so a contract
can be re-issued after one is taken back or refused while the old row survives
as history.
Rationale: pass-13 found withdraw and decline both end a job permanently — the
row holds the only slot, so no second contract can ever be inserted. Overwriting
the row in place needs no migration but destroys a document the customer may
have opened, which is the erasure migration 82 was written a day earlier to
stop. A history table preserves the to-one embeds but needs two tables held in
step.
Ticket: pass-13 CRITICAL 1
Reversible: yes — drop the index, re-add the constraint, provided no quote has
acquired a second contract by then
Precedent: yes — a uniqueness rule about a LIVE thing is a partial index over
its live statuses, never a plain UNIQUE on the foreign key

## 2026-09-16 — a guard is only as good as the query that feeds it
Decision: `quoteEditability`'s unknown-status fallback stays "blocking", and the
omission is caught by a regression test that asserts the SELECT, not by making
the guard permissive.
Rationale: CONTRACT-3 (#792) shipped as a complete no-op. The guard read
`contract.status` correctly; all three callers selected `contract:contracts(id)`
without it, so every contract took the `: true` branch and blocked exactly as
before. #792's test called the function directly with a status-bearing object,
proving the branch worked while saying nothing about whether any caller supplied
the field. Making the fallback permissive would unfreeze quotes with LIVE
contracts whenever a select is incomplete, which is the worse failure.
Ticket: pass-13 SERIOUS 2
Reversible: yes
Precedent: yes — where a guard reads a field the caller must remember to fetch,
the test asserts the QUERY; a test that calls the guard directly cannot see the
defect

## 2026-09-16 — a withdrawn contract's deposit may not be charged
Decision: `pickDepositPct`'s fallback ignores contracts whose status is
`withdrawn` or `declined`. A signed contract still wins outright, unchanged.
Rationale: migration 83 keeps dead contracts as history, so "any contract
carrying a percentage" can now land on one nobody is party to — a job withdrawn
at 25% and re-issued at 10% could invoice the 25%, and the embed's order is not
promised. This RESTORES the pre-migration invariant rather than changing a
price: while quote_id was UNIQUE a quote had exactly one contract, so "any
contract" was "the contract". Where every contract is dead there is no agreed
percentage and the derivation refuses, as it does for a quote with no contract.
Ticket: pass-13, follow-on from CRITICAL 1
Reversible: yes
Precedent: yes — after migration 83, every read of a quote's contract means the
LIVE contract; "any contract" is no longer a safe synonym anywhere

## 2026-09-16 — the 23505 recovery read stays un-narrowed, deliberately
Decision: `createContract`'s duplicate-key recovery keeps
`select().eq().maybeSingle()` and does NOT filter to live contracts.
Rationale: on a re-issued quote that read now sees several rows and errors, so
`existingContract` is null and the code falls through to the throw — which says
a contract has already been sent, and that is true, since only a live contract
can raise a 23505. The correct narrowing (`.not/.order/.limit`) is unmergeable:
`tests/acceptance/581.test.tsx` is frozen and stubs exactly
`select().eq().maybeSingle()`, so any extra chain method throws in three of its
assertions and the item blocks for good. The cost is the navigate-to-job-page
convenience, not correctness.
Ticket: pass-13, follow-on from CRITICAL 1
Reversible: yes — it lands free whenever 581 is legitimately superseded
Precedent: yes — a frozen stub's chain is part of the contract; check it before
narrowing any query it covers

## 2026-09-16 — May a provisional sum carry the drafting model's own figure?
Decision: no. `suggested_amount_pence` is never charged; a provisional line is
saved unpriced, carrying its reason. `has_pricing_history` no longer gates it.
Rationale: the gate asked about the ACCOUNT when the question is about the ITEM —
a record of what this contractor pays for plaster grounds nothing about skip hire
or a bonding coat nobody mentioned. Two live quotes on 16 Sep, both £250 of
labour with the contractor saying there were no other charges, billed £336 and
£320 on model-invented provisional sums. "Provisional" is a label; what the
customer reads is the number. Unpricing them also hands the lines to the
out-of-scope filter, which only ever examines lines with no price — a priced
invention was invisible to the one guard built to strip excluded work.
Ticket: tranche-20 TR20-01
Reversible: yes
Precedent: yes — a figure the model authored is never a charge, whatever the
account's history

## 2026-09-16 — Does an unknown VAT treatment with an unknown basis need the question?
Decision: yes. `resolveCostBasis` refuses whenever the basis is unknown and no VAT
amount was stated, whether the treatment is "standard" or "unknown". A basis the
contractor DID give still saves, treatment unknown or not.
Rationale: reverses my own 16 Sep reasoning that unknown/unknown had "nothing to
separate and nothing to assume". It served the wrong case. A contractor who just
names a figure — the commonest way anyone says an amount — produces
unknown/unknown and NOT unknown/standard, so the refusal built for exactly that
person never ran and the assistant never asked. "A hundred and twenty" at a
merchant saved as £120.00 net with no VAT. Recording it as exact net is not
neutral: it claims the figure carries no VAT, on spending that usually does.
Ticket: tranche-20 TR20-04
Reversible: yes
Precedent: no

## 2026-09-16 — Where does the date a cost was incurred come from?
Decision: from the contractor's words, resolved by `resolveSpokenDate`, falling
back to today. The model reports `incurred_on_words` and never a date.
Rationale: there was no field at all, so `incurredOn` was the client's clock and
"I paid him in cash yesterday" saved today. A cost on the wrong day can land in
the wrong VAT quarter. The resolver answers null for anything it is not sure of,
because a wrong date is worse than today's date.
Ticket: tranche-20 TR20-03
Reversible: yes
Precedent: yes — the model supplies words, code decides, as with amounts and VAT

## 2026-09-16 — How should Motko price work described in hours or shifts?
Decision: it does not. Days remain the only unit. Where a contractor describes
shifts or hours the assistant asks them for it in days and the line is flagged.
Jacob's call, 16 Sep, choosing this over hours × (day rate ÷ 8) with an
out-of-hours uplift.
Rationale: the café job (three evening shifts of ~5 hours) prices as three whole
days and overcharges — £1,655 against £1,438 — so the gap is real and known. It
is accepted rather than closed: an hours model needs a new uplift rule, and a
wrong uplift moves money on every shift job. Asking the contractor to convert
puts the arithmetic with the person who knows the job.
Ticket: tranche-20 TR20-05
Reversible: yes
Precedent: yes — days are the pricing unit; no path may introduce a second one
without revisiting this

## 2026-09-16 — A rate and a cap stated for the same item
Decision: charge the LESSER of rate × count and the cap. "£45 a shift, capped at
£120 for the job" over three shifts is £120, not £135 and not £45. The extractor
must recognise cap language ("capped at", "no more than", "the most") and tie it
to the rate it qualifies. Jacob's call, 16 Sep.
Rationale: it is what the contractor said, and both figures are real. Today the
£45 wins and the job undercharges by £75 with only a flag to show for it. Taking
the cap as a flat job line instead would lose the rate and overcharge a job that
runs short.
Ticket: tranche-20 / CAFE-HIRE
Reversible: yes
Precedent: yes — where two stated figures qualify one item, apply the
relationship the contractor described rather than picking one

## 2026-09-16 — May the drafting model add lines the contractor never mentioned?
Decision: no. Past-quote tendencies become editor-only suggestions, never draft
lines. Jacob's call, 16 Sep.
Rationale: nearly every quote gained "scrim tape and consumables", "waste
removal" and "protective sheeting" from past jobs, including on jobs where the
contractor had said there were no other charges. They no longer carry a price
(TR20-01) but they still reach the customer's document and each raises an
unsourced-line flag that blocks the send. The accepted cost is that a contractor
who always adds waste removal must now remember it.
Ticket: tranche-20 TR20-06 (invented-lines half)
Reversible: yes
Precedent: yes — a tendency is a prompt to the contractor, never a line on a
customer's quote

## 2026-09-16 — Does the wrap-up force the customer's name and contact?
Decision: no. The 21 Aug "infer rather than interrogate" decision STANDS. Name
and contact stay an editor step before sending. Jacob's call, 16 Sep, asked
because forcing the question would have contradicted a recorded decision.
Rationale: all 20 runs of the tranche blocked on "Missing customer details", so
the pressure to ask in-call is real, but two more questions on every call is
exactly what the 21 Aug decision was avoiding. QA runs will keep reporting a
send-blocked quote for this reason, and the readiness bar must be scored
excluding it rather than counting it as a defect.
Ticket: tranche-20, customer identity
Reversible: yes
Precedent: no — this reaffirms 2026-08-21 rather than establishing anything new

## 2026-09-16 — What may an unauthenticated build endpoint disclose?
Decision: the running deployment's commit SHA, and nothing else. Not the branch,
the deploy URL, the environment, or who deployed it. Jacob asked for the route;
the disclosure boundary is mine, and `/api/build` is registered in
PUBLIC_API_ROUTES and in tests/acceptance/99.test.ts so the unauthenticated
surface is visible to a human rather than quietly added.
Rationale: four voice-QA reports in a row carried "source/commit version is not
asserted", and the 16 Sep tranche filed a regression introduced that morning as
a pre-existing defect because nothing tied a run to a commit. The SHA is already
in every page Next serves and names a commit an outsider cannot read, so this
adds a parseable place to read an existing fact. Each of the excluded fields is
a fact about the organisation rather than the artefact, and none is needed to
attribute a test run.
Ticket: QA attribution, tranche-20 follow-up
Reversible: yes
Precedent: yes — a diagnostic endpoint discloses the artefact, never the
organisation, and is registered rather than merely added

## 2026-09-17 — Does withdrawing a live contract confirm first?
Decision: yes. "Withdraw contract" opens the page's existing bottom-sheet
confirm (the mark-as-paid / refund idiom) stating the consequence above the
confirm button; the destructive action moves inside it. The sheet also says
Motko emails nobody, because the contractor cannot see that from this screen.
Rationale: the control renders only while the contract's status is `sent` — the
one window where the customer could sign at any moment — and sat directly under
"Copy contract link" and "Download contract", two buttons that do nothing. A
mis-tap voided the agreement silently; `withdrawContract` notifies no one, so
the customer's next act would have been opening a link telling them it was gone.
Ticket: pass-13 MINOR, withdraw single-click
Reversible: yes
Precedent: yes — a control that ends an agreement confirms, and the
confirmation states what is NOT sent as well as what is

## 2026-09-17 — What does a job do after its contract is declined?
Decision: exactly what it does after a withdrawal. The job page offers the
contract form, and the dashboard files the job under "Accepted quotes awaiting
contract". The situation stays `contract_declined`, so the red badge and the
"X declined the contract" headline are unchanged — only the body and the
section membership move.
Rationale: declining a CONTRACT does not un-accept the QUOTE, `deriveJobState`
has returned `move: "contractor"` since pass 12, and migration 83's partial
index excludes 'declined' exactly as it excludes 'withdrawn', so a replacement
inserts cleanly. The panel said "Nothing needs you here." with no form, which
contradicted the derivation and won. Pass 14 measured the cost: CONTRACT-3 made
the quote editable after a decline, so the contractor edits, the job says
"Waiting on X to accept", the customer accepts a SECOND time, and the job lands
back on "Nothing needs you here" — a wall turned into a trap, with £1,320 of
accepted work invisible in the pipeline.
Ticket: pass-14 CRITICAL 1
Reversible: yes
Precedent: yes — a dead contract never holds a job; withdrawn and declined are
the same state as far as "can another contract be sent" is concerned

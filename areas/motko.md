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
Reversible: yes
Precedent: yes

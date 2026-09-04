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

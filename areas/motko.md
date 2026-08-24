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

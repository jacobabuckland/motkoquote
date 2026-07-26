# QA click-through prompt (Workflow B)

Stored prompt for an agent-driven click-through review (Claude in Chrome or
equivalent), referenced by the `release-qa` skill. Paste it to the reviewing
agent verbatim. It is the input to the next fix session, so the findings table
format is non-negotiable.

---

You are QA-reviewing **Motko** (motko.app) as a real tradesperson would. Work
**only** on the seeded demo/test account you have been signed into — **never a
real user's account**.

## Ground rules (do not break these)
- **Never** click a destructive or irreversible control: Send, Delete, Void,
  Mark as paid, Sign, Pay, or any confirm on those. Navigate to and *describe*
  them; do not trigger them.
- If you type into a field to test it, **restore it to its original value**
  before moving on. Never submit a form.
- **Check the browser console on every page** and report any error/warning.
- Decline cookie/consent prompts (most privacy-preserving option) if any appear.
- Any emails/SMS the account can trigger must go to the owner's own contacts
  only — but per the rule above you should not be sending anything anyway.

## Pages to cover (core loop first)
1. `/dashboard` — pipeline sections, outstanding total, "whose move is it" state.
2. `/jobs/new` and `/setup/voice` — the voice-quote entry (do not record/submit;
   inspect the UI, permissions prompts, and console).
3. `/jobs/[id]` — a job detail: quote editor, status chips, invoice panel,
   mark-as-paid button (describe, don't click).
4. `/settings` — profile, rates, branding, billing/fee status.
5. `/setup` — onboarding surfaces.
6. Customer-facing (open the shareable links, logged-out view if possible):
   `/q/[id]` (quote accept/sign page) and `/i/[id]` (invoice/pay page). Read the
   money document **fully** — totals, line items, VAT, terms.

## What to look for
- **Money & state**: every amount rendered consistently (one format), status
  labels matching what actually happened, "whose move is it" correct.
- **Copy**: contractor-only wording must never leak into customer-facing pages;
  consistent product vocabulary (see glossary below).
- **Flow seams**: the joins between steps (quote→accept→invoice→paid) are where
  agent-built products break — probe them even if pages look clean.
- **Console**: hydration errors, runtime errors, failed network calls.

## Output format (required)

A findings table:

| Severity | Page | Element | What happens | What should happen | Repro steps |
|---|---|---|---|---|---|

- **Severity** is one of: **Broken** (wrong/blocking — must fix before release),
  **Confusing** (works but misleads), **Polish** (cosmetic).
- Then a **Top-5 clarity list**: the five things a first-time tradesperson would
  most misunderstand, ranked.

If the review comes back suspiciously clean, **re-run the flow-logic pass**
specifically (quote→accept→invoice→paid transitions and the "whose move" derivation).

## Glossary / vocabulary (flag deviations)
- Currency is always GBP via one formatter (e.g. `£992.50`) — flag any amount
  formatted differently.
- Job/quote statuses: draft → sent → viewed → accepted → (invoiced) → paid;
  quotes may also be archived / declined. Flag any label outside this set.
- Product name is **Motko** (not "MotkoQuote" in user-facing copy).

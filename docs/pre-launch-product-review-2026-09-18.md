# Pre-launch product review — 18 Sep 2026

Reviewing `main` @ `be67211` ("A lost decimal point is not a correction", #824).

**Baseline.** `tsc --noEmit` clean. `eslint` 0 errors, 147 warnings. Full suite
**558 files / 6,535 tests, zero failures**, 117s. The tree is green, and every
finding below is something green does not catch.

**Scope.** The money path from invoice to settlement, the unauthenticated
surface, the two defect *classes* found this week (PostgREST embed cardinality
after migration 83, and server-action refusals that reach no screen), and the
standing-check layer. Not reviewed: the voice pipeline — fifteen QA passes cover
it and a sixteenth is queued; the iOS build; the marketing site.

Graded by what a contractor or customer would suffer, not by how hard it is to
fix.

---

## CRITICAL 1 — a Connect-only contractor's customer cannot pay an invoice over £10,000

**Reachable on the promoted onboarding path, on the live code path, today.**

`buildPayPanel` (`src/app/i/[id]/pay-panel.ts:172`) returns `button_only` when a
Connect-complete contractor has no manual bank details — *including on the two
paths where the button provably cannot work*. Probed against the real module,
with the exact inputs `src/app/i/[id]/page.tsx:118` passes:

| invoice | panel mode | `/api/invoices/[id]/transfer-details` |
|---|---|---|
| £5,000 | `button_only` | 404 |
| £10,000 | `button_only` | 404 |
| £12,500 | `button_only` | **404** |
| £5,000, rails down | `button_only` | **404** |

The dead end, in three steps:

1. The page renders a pay button and **no** transfer details.
2. The customer taps it. `create-payment-intent:127` refuses with
   **422 `AMOUNT_TOO_HIGH`** — `PAY_BY_BANK_LIMIT_PENNIES` is £10,000.
3. The fallback endpoint, which exists for exactly this ("so a customer can
   still pay when an available Stripe rail fails them"), gates on
   `hasPayoutDetails` — which requires `payout_details_complete` **and** all
   three manual fields — and **404s**.

No working button, no transfer details, no fallback. The invoice cannot be paid
from the page by any route.

**This is a regression against a requirement that is already written down.**
`tests/acceptance/bank-details-rail-gating.test.tsx` states it in its own header
— *"a £15k invoice must remain payable, so above-ceiling and no-rail invoices
keep the details"* — and asserts it. It passes because its fixture carries full
manual bank details. CONN-6 added a contractor class the fixture does not
describe, and silently exempted it.

**Reachability is the part that makes this CRITICAL rather than SERIOUS.** Both
conditions are the normal case at launch, not a corner:

- *No manual bank details* is the **expected** state for a Connect-onboarded
  contractor. The code says so itself: the manual form "is now optional", and
  `account_number is NULL because Stripe doesn't provide it`.
- *Over £10,000* is an ordinary job for a trade — a rewire, an extension, a full
  bathroom. Note the asymmetry it produces on a large job: a 30% deposit on
  £30,000 is £9,000 and **is** payable, so the contractor sees the rail work,
  starts the job, and discovers on the £21,000 final invoice that their customer
  cannot pay. And during any pay-by-bank outage the same dead end appears at
  **every** amount.

Nothing in the suite covers the combination: no test sets an over-ceiling amount
against a Connect-complete contractor with null manual fields.

**I have not fixed this, and it should not be fixed by widening the button.**
The honest options differ in what the customer is told and where the account
details come from, and Stripe does not expose the destination account number —
so "just show the transfer block" is not available without the contractor typing
it. That is a money decision, which AGENTS.md puts on the escalation list. My
recommendation, cheapest first:

1. **Require the manual payout form before an invoice can be sent above the
   ceiling.** Blocks the dead end at the only point where a human can still act,
   and needs no new surface.
2. Make the `mode` honest — a fourth mode that says the trade must be contacted
   directly, and flags it to the contractor. Still a bad customer moment, but
   not a silent one.

Option 1 is what I would ship.

---

## SERIOUS 1 — a frozen test is holding a correct fix hostage on the re-issue path

`src/app/dashboard/actions.ts:379` queries `contracts` by `quote_id` and ends in
`.maybeSingle()`. After migration 83 a quote may carry several contracts, so on
a re-issued quote this errors with "multiple rows returned".

The code knows. There is a 25-line comment explaining that the fix
(`.not(...).order(...).limit(1)`) is unmergeable because
`tests/acceptance/581.test.tsx` is frozen and hand-rolls a stub whose chain is
exactly `select().eq().maybeSingle()` — any narrowing throws `.not is not a
function` in three of its assertions.

The reasoning is sound and the degraded path is honest: the contractor loses a
navigate-to-the-job convenience, not the truth. **But the conclusion that
nothing can be done is wrong.** AGENTS.md has a route for precisely this —
*"Retiring an assertion a later item deliberately supersedes"* — and its four
conditions are all satisfiable here: name the three assertions on a card, retire
them in the superseding item's first commit, say why in the commit message,
leave the rest of the file running. It needs a card, which is yours to write; it
does not need the constraint to be permanent.

Not a launch blocker. Worth a card before the workaround calcifies into an
assumption.

---

## What I checked and found sound

Stated so the coverage of this review is legible, and so these are not
re-reviewed.

- **The unauthenticated surface.** Sixteen public API routes, every one
  registered in `tests/acceptance/99.test.ts` with a written rationale, and the
  inventory fails on any route that is in neither list. `ALLOWED_EXPOSURES` is
  empty and intended to stay empty. There is no `middleware.ts` — auth is
  per-route — and the registry is what makes that safe.
- **Money integrity.** No client-supplied amount can reach a charge or an
  invoice write (`money-source.check.test.ts`), exactly one route creates a
  payment intent and it calls `canAcceptStripePayment` first
  (`payment-gate.check.test.ts`). Both are standing checks, so they cover routes
  that do not exist yet.
- **The embed-cardinality class** (migration 83) **is closed.** Four
  `embeddedOne` call sites remain, all on genuinely to-one relations; no bare
  `[0]` on an embed anywhere in `src/`; every `contracts` query but the one in
  SERIOUS 1 filters on the primary key.
- **The silent-refusal class is closed.** Every `haptics.error()` in the tree is
  paired with a visible surface — `setError`, a toast, or a failed state. The
  pattern that produced "the button does nothing, five times" survives nowhere.
- **The chase cron.** Authorised before any client is built, run-locked,
  claim-before-send against a unique index, drops archived and declined quotes,
  honours `sms_opt_out`, and halts the moment an invoice flips to paid. Jacob's
  standing warning about it is about testing on production, not a defect.
- **The contract's `{{bank_details}}`.** Gated on rail capability rather than
  account existence, and consistent with the invoice page. A Connect-only
  contractor with the rail down renders an empty section rather than a wrong
  one — the same root cause as CRITICAL 1, degrading safely.

---

## Standing, not found by this review

- **#797 (KNOW-1)** is red only on the pipeline prompt hashes and needs one
  `RECORD_PIPELINE=1 npx vitest run tests/pipeline/harness.test.ts`. It is the
  only thing between #788 and shipped.
- **The iOS build ("App | Default") has been red on every commit for days.** App
  Store submission surface — deliberately untouched.
- **The contract copy escalation is still open**: `maintenance_recurring` states
  no payment timing at no-deposit, and three templates say "the remainder" with
  no antecedent.

---

## Launch verdict

**Not yet — one thing, and it is CRITICAL 1.**

Everything else here is a card, not a blocker. The engine is in good order: the
green suite is real, the check layer covers the classes that have actually
burned this project, and both defect classes found this week are genuinely
closed rather than patched at the reported site.

But a contractor who onboards the way the product tells them to, and sends the
kind of invoice the product exists to send, has a customer who cannot pay. That
is the one finding that would put a real trade on the phone to a real customer
to arrange a bank transfer the app was supposed to handle — on day one, on the
largest invoice they have.

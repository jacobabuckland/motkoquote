# Motko — test round 2 root cause analysis (rev 2)

**Test:** Buckland Plastering, 9 September 2026 — second full test after the rev 3 remediation plan.
**Audited:** `main` @ `119345d`, clean tree, in sync with `origin/main`.
**Contract:** investigation only. No code was written or changed.

## What changed in this revision

The Supabase connector came back mid-session, so the three items previously left
open on missing observability are now closed against production data. Two of them
turned out **worse** than reported, and one of my own conclusions was wrong.

| Change | Effect |
|---|---|
| Item 1 closed against the actual quote row | Worse than reported — a live **accepted** quote is under-charged |
| Item 5 (Stripe) analysed and closed against production | Root cause confirmed; it was unanalysed in rev 1 |
| Item 11 closed against production | My "one field is empty" conclusion was right; my reasoning about *why you'd believe otherwise* was wrong |
| Item 6 conditional resolved | Email **does** fire alongside push — notifications are **not** launch-blocking |
| Item 12 corrected | The copy is **not** hardcoded; rev 1 accepted that premise without checking |
| Pattern section rewritten | A fourth instance, predating the rev 3 plan by months, changes the conclusion |

**Still not closed:** the invoice 500 needs the Vercel function log, which is not
reachable from this session. Everything else is closed.

---

## Launch-blocking list

The agreed standard is *"blocks a trade sending a quote or getting paid"*.
Rev 1 applied it wrongly — it demoted the invoice 500 because the **cause** was
unknown, which is not the same as the **impact** being unknown. Corrected:

| # | Item | Why it blocks |
|---|---|---|
| 1 | **Pricing defect** | Under-charges VAT and silently deletes revenue. A live accepted quote is already wrong |
| 2 | **Contract signature block** | 17 contracts sent, 15 signed, across 6 trades — all carry it |
| 3 | **Invoice send 500** | Blocks getting paid. Cause unknown, impact certain |
| 4 | **Sign-in safe-area inset** | At launch every user is a fresh install; a reinstall locks a trade out with no recovery |

**Item 5 — notifications — resolved to NOT blocking, with evidence.**

`notifyContractorOfCustomerAction` (`src/lib/notify-contractor.ts:55-110`) sends on
**two** channels, not one: `sendContractorNotificationEmail` (`:85-95`) and
`sendPushToUser` (`:107`). Push is not the only path. The email goes to
`business_profile.business_email`, and production confirms that field is populated
for Buckland Plastering. A trade whose push is broken still learns of an
acceptance by email.

That leaves push as degraded, not silent — a P1, not a launch blocker. The
qualifier worth keeping: a trade with **no** `business_email` falls to
`outcome.email = "no_address"` and push becomes the only channel. Worth a
one-line check that `business_email` is required at setup before launch.

Everything else ships behind a known-issues line.

---

## Classification summary

(a) new · (b) planned, not shipped · (c) shipped and still failing · (d) shipped and working

| # | Item | Class | Note |
|---|---|---|---|
| 1 | Fixed price drops materials, VAT under-charged | **(a)** | Predates rev 3, never in it |
| 2 | Reconciler error is a dead end | **(a)** | |
| 3 | Quote edit doesn't regenerate SoW | **(c)** | Reclassified — see the pattern section |
| 4 | Invoice send 500 | **(c)** | P0·4 shipped boundaries for `/q` `/c` `/i`; this fired on `/jobs` |
| 5 | Stripe onboarding re-prompts after completion | **(a)** | Now analysed |
| 6 | APNs "all devices rejected" | **(c)** | Gateway mismatch already fixed; P0·2's persisted status did not ship |
| 7 | Sign-in behind battery on iPhone 17 | **(a)** | |
| 8 | Voice ends before required fields | **(c)** | For site address, (d)-by-design |
| 9 | Deposit displayed, never asked | **(c)** | P2·13 shipped; its own escape hatch defeats it |
| 10 | Contract validity / contractor signature | **(a)** | |
| 11 | Business details "missing" | **(d)** | Fix shipped and is working — see below |
| 12 | Contract channel UI backwards | **(a)** | Reclassified — the copy is not hardcoded |
| 13 | SoW materials + provisional sum | **(d)** | Closes P2·15 |
| 14 | Contract sent by SMS | **(d)** | Closes P2·11 |

---

## Group 1 — the fixed price has three owners and none of them agree

**Blocking. And the production row is worse than the test report.**

### What actually happened, from the row

Quote `46e3d510-6867-4f9f-9909-4488e04facb9`, created 06:37:56Z on 9 Sep,
**status: `accepted`**:

| Field | Value |
|---|---|
| `sow_json.pricing` | `{mode: "fixed", fixed_amount: 1800}` |
| `drafted_line_items_json` | **4 lines, £2,355.98** |
| `line_items_json` | **1 line, £1,800** — "General works — see Scope of work", `provenance.source: system-generated` |
| `total` | **£2,160.00** (£1,800 + 20% VAT) |
| `contractor_flags_json` | 3 flags, **none of them a price mismatch** |

The four drafted lines were:

| Line | Total |
|---|---|
| Plastering labour — re-skim walls and ceilings | £1,099.98 |
| Finishing plaster (multi-finish) — four rooms | £900.00 |
| PVA bonding agent | £216.00 |
| Scrim tape and consumables | £140.00 |

**Three separate defects compound here, and only one was in the test report.**

**1. The £400 never became a line at all.** The first stored flag reads:

> The job notes reference a provisional materials sum of £400. The material lines
> above are estimated from similar past jobs — review quantities and costs before
> issuing…

The stated £400 was captured as a **note**, and the model then invented
**£1,256** of material lines "estimated from similar past jobs" in its place. So
the materials figure was not dropped from a line — it never was one, and £1,256
of unstated material pricing was substituted for the £400 the contractor said.

**2. Then the fixed-mode collapse deleted all four lines.**
`applyPricingMode` (`src/lib/pricing-mode.ts:89-96`) replaced £2,355.98 of
calculated lines with one £1,800 works line. Non-provisional lines are discarded,
not scaled, not merged.

**3. VAT was then charged on what survived.** `computeQuoteTotals`
(`src/lib/quote-math.ts:50-59`) → £1,800 × 1.2 = **£2,160**, which is the stored
total, on an **accepted** quote.

### The three-way disagreement

| Consumer | Which lines count |
|---|---|
| VAT / total (`computeQuoteTotals`) | all lines, **including** provisional |
| Reconciler (`reconcileStatedPrice`, `stated-price-guard.ts:83-99`) | **excluding** provisional |
| `applyPricingMode` fixed collapse | keeps provisional, **deletes** non-provisional |

Three consumers, three answers, no owner. **Confidence: Confirmed** — reads plus
the production row.

### Why the fixed price captured a component

`src/lib/schemas/sow.ts:449` asks the model for the wrong thing:

> `'fixed'` = they gave you a single total for the whole job, e.g. 'call it two
> grand' — set mode to `'fixed'` AND put that number in `fixed_amount`.

The test supplied two components. There is no schema shape for that, so the model
selected one and called it the total.

There is also a **second fixed-price field** with opposite semantics:
`sow.agreed_costs.fixed_price`, consumed by `applyAgreedFixedPrice`
(`src/lib/agreed-costs.ts`), which *scales* every line to hit the target. Two
fields called fixed-price, fed from the same conversation, one deleting lines and
one scaling them.

### The PRICE-1…5 apparatus was inert on this job

`stated_prices` on this SoW is an **empty array**. `extractStatedPrices`
(`src/app/jobs/actions.ts:462`) ran and found nothing, so PRICE-4's per-amount
reconciliation — the guard built precisely to catch "a stated amount with no
matching line" — never fired. And even had it been populated, it is explicitly
skipped in fixed mode when a system-generated line is present
(`stated-price-guard.ts:171-176`), which is exactly this quote's shape.

### One thing I could not reproduce

The message quoted in the brief — *"you set 1800 but the price lines come to
2200"* — is unambiguously `statedPriceMismatchFlag`
(`stated-price-guard.ts:50-52`); the narrative guard emits a machine token, not
prose, so it is not that one.

But this job has **one** quote, its stored flags do not include a mismatch, and
1800 vs 1800 cannot produce it. The figures that exist are £1,800 stated against
£2,355.98 drafted. The mechanism that produces that exact message is
`switchPricingMode` (`src/app/jobs/actions.ts:924-950`), which recomputes flags
against `drafted_line_items_json` — so toggling out of fixed mode would flag
£1,800 against £2,355.98 and toggling back would clear it.

**Confidence: Needs more evidence** for the precise trigger. It does not change
the diagnosis: the stored outcome is worse than a blocked send, because nothing
blocked at all and the customer accepted.

### Item 2 — the reconciler dead end

`src/app/jobs/actions.ts:1319-1349` throws `actionableError` and nothing in
`sendQuoteSchema` lets the contractor say which figure is right, so every retry
recomputes the same result from unchanged data. **Confirmed.**

The codebase already has this pattern three times — `confirmZeroTotal`,
`confirmNarrativeMismatch`, `confirmOverCeiling`. Reconciliation is the only money
guard without one. But a bare confirm is the wrong shape: the two figures
genuinely disagree and one is wrong, so the resolution is a **choice**:

> Your stated price says £1,800. Your lines come to £2,355.98.
> → **Update the fixed price** (writes `sow_json.pricing.fixed_amount`)
> → **Rescale the lines** (runs `applyAgreedFixedPrice`)

Both operations exist as functions. Neither is reachable from the error.

### Item 3 — quote edit does not regenerate the SoW

`src/app/jobs/actions.ts:1139-1155`. `updateQuoteLineItems` writes
`line_items_json`, `total` and `contractor_flags_json`. It *reads* `sow_json` to
recompute flags and never writes it. `sow_json` is written in exactly three
places: the voice delta path (`:371`), conversation end (`:515`), and the
pricing-mode switch (`:976`). A quote edit is none of them.

**There is no regeneration hook to find — it does not exist. Confirmed.**

---

## Item 5 — Stripe onboarding re-prompts after completion

**Blocking-adjacent (it is on the get-paid path). Not analysed in rev 1 — that was
an omission.**

### The state machine has three states; the domain has four

`src/app/settings/stripe-connect-section.tsx:75-84`:

```js
const notStarted = !stripeAccountId;
const inProgress = stripeAccountId && !stripePayByBankEnabled;
const complete   = stripePayByBankEnabled;
```

Completion is gated on **one** flag: `stripe_pay_by_bank_enabled`, which
`refreshAccountStatus` (`src/lib/stripe-connect.ts:164`) derives from
`account.capabilities.pay_by_bank_payments === "active"`.

### Production says onboarding is finished and the UI says it isn't

Buckland Plastering's contractor row:

| Field | Value |
|---|---|
| `stripe_account_id` | present |
| `stripe_payouts_enabled` (transfers capability) | **true** |
| `stripe_requirements_due` | **false** |
| `payout_details_complete` | **true** |
| `stripe_pay_by_bank_enabled` | **false** |

`requirements_due: false` is Stripe saying **it wants nothing further**. Transfers
are already active. The only thing outstanding is the `pay_by_bank_payments`
capability moving from `pending` to `active`, which is Stripe's own verification
review — the 24 hours their UI mentions.

Because `complete` gates on that capability alone, the entire verification window
renders as `inProgress`, and `inProgress` renders the button *"Complete
onboarding"* (`:269`) above *"Your Stripe onboarding is in progress. Complete the
setup to…"* (`:260`).

**Root cause: the UI cannot distinguish "the trade has not finished" from "the
trade has finished and Stripe is reviewing".** Both are `inProgress`. The trade is
told to complete something already complete, that no action of theirs can advance,
and the button re-launches an onboarding flow Stripe will immediately end because
there is nothing to collect. **Confidence: Confirmed.**

### Why the return lands with the button unchanged

Two paths refresh the status: `refreshAccountStatus` on Settings page load
(`src/app/settings/page.tsx:140`), and a `browserFinished` listener on native
(`stripe-connect-section.tsx:88-104`). Both work. They refresh a value that is
**still false** and will stay false until Stripe's review completes — so a correct
refresh returns the same wrong-looking screen.

### The two missing UI states

1. **Submitted, awaiting verification.** The data to render it already exists:
   `stripe_requirements_due === false && stripe_pay_by_bank_enabled === false`
   with an account present is exactly this state, and it currently renders as
   "incomplete". Copy should state that Stripe is reviewing and can take up to 24
   hours, with **no** call to action, because there is nothing for the trade to do.
2. **Complete.** There is no affirmative confirmation that setup succeeded — the
   section simply stops prompting.

This is the same failure family as Group 2: a fact that exists in the data
(`requirements_due: false`) is not read by the surface that needs it.

---

## Group 2 — a signal that must change behaviour ends in telemetry

`AGENTS.md`:

> A signal that must change behaviour cannot terminate in telemetry… Writing it to
> an events or analytics sink is not delivery.

### Item 6 — APNs: the prime suspect is already fixed

**The sandbox/production gateway mismatch is not the cause.**
`src/lib/push/apns.ts:63-88`: `attemptOrder` tries **both** gateways; `APNS_ENV`
only orders the attempts. A token is reported `gone` only when **both** reject it
(`:28-34`). The header comment (`:10-27`) documents this as the already-fixed bug,
including the subscription-deletion loop it caused.

"All devices rejected" therefore means both gateways rejected — a **token** fact,
not a routing one. Candidates, in order: tokens minted by the July App Store build
that #684 identified as live and invalidated by a reinstall; `APNS_BUNDLE_ID` not
matching `app.motko.ios`; `APNS_TEAM_ID` mismatch.

**Confirmed** that routing is excluded. **Needs the reason string** to choose
among the three — and that is the next finding.

### P0·2 did not ship as decided

The recorded decision:

> A persisted delivered/failed status is a hard condition on the notifier
> hardening and ships in the same PR.

What exists: `sendPushToUser` builds a summary carrying `failures[]` with Apple's
reason per device, then `console.log`s it (`src/lib/push/index.ts:135`).
`recordDelivery` (`src/lib/notify-contractor.ts:134-148`) calls `track(...)`, which
writes to the **`events`** table. `notification-health.ts` reads the same table
(`:68`, `:109`).

**No per-notification delivery status is persisted** — no column on
`push_subscriptions`, no deliveries table in any migration. The hardening shipped;
its hard condition did not.

**What the fix assumed that turned out false:** that non-throwing notifiers plus
an events row equals observability. It converted a loud failure into a quiet one
and filed the evidence where nothing reads it back.

**And the UI discards it again.** `src/app/settings/settings-client.tsx:135`
renders *"All devices rejected the notification. Check the server logs."* while the
API response it has just received contains `failures[]` with the reason. That dead
end is self-inflicted — the answer was in the payload.

### Item 4 — invoice send 500

P0·4 shipped `error.tsx` and `not-found.tsx` for `/q`, `/c` and `/i` — all six
files present. **Invoice send is not on those routes**; it is a server action from
`/jobs/[id]`, falling to the generic root boundary `src/app/error.tsx`. The split
shipped and would not have helped. **Confirmed** for the classification.

The underlying error still needs the **Vercel function log** for that request —
the only item in this document still open, and the reason it is open is the same
observability gap this section is about.

---

## Group 3 — the voice gate is narrower than the prompt

### The prompt and the code disagree

**The prompt** (`src/lib/voice/job-intake-prompt.ts:45-47`): required slots are
*"crew, pricing mode, materials supply, and the working dates"*.

**The code** (`src/lib/schemas/sow.ts:1072-1097`):
`REQUIRED_CHECKLIST_QUESTIONS = [crew, duration, materials_supply, working_dates,
agreed_costs]`.

**`pricing` is not a checklist slot at all** — absent from
`CHECKLIST_QUESTION_IDS` (`:9-16`). The gate can never hold a wrap for it, which is
how a fixed-price job reaches quote generation with `fixed_amount` set to a
component figure. **This connects Group 3 directly to Group 1.**

### Production confirms the gate was defeated

The test job's `sow_json`:

| Field | Value |
|---|---|
| `unasked_required` | `["customer_name", "customer_contact"]` |
| `wrap_incomplete` | **true** |
| `declined_slots` | `[]` |
| `agreed_costs` | **null** |
| `customer_name` | null |

So the call ended with two required-by-report slots never put to the contractor,
`agreed_costs` never answered and never declined — and the quote was drafted,
sent, and **accepted** anyway. `wrap_incomplete: true` is a flag, not a gate.

### Customer name and site address can never hold a wrap

They appear in `UNASKED_REQUIRED_IDS` (`sow.ts:30-35`) — the *reporting* list —
but not in `CHECKLIST_QUESTION_IDS`, and
`getUnansweredRequiredChecklistQuestions` filters to the checklist. Note that
`site_address` is absent even from the report above: rev 3's P1·6 decided

> `site_address` stays out of `unasked_required` and out of `wrap_incomplete`.

So a call ending without it is the shipped decision working as designed —
**(d)-by-design, and the design is wrong.**

### Two further escape hatches

`src/components/voice/job-intake.tsx:668-700`:

- **Asked-once counts as done.** Unanswered slots are filtered by
  `askedRequiredSlotsRef`, and the wrap detour marks slots asked *up front* "so it
  counts as put-to-the-contractor even if the answer never lands". `agreed_costs`
  being `null` with `declined_slots` empty is this hatch firing.
- **No data channel, no ask.** If `dc` is falsy the code records the slots and
  calls `finishConversation` regardless.

The comment at `:660` still says *"the three REQUIRED slots"* — stale by two.

### Item 9 — the deposit

`sow.ts:1090-1096`: `agreed_costs` was promoted to required by P2·13, but
"answered" is satisfied by **the object's presence, not any figure being set**,
and the tool description tells the model to "set this even if nothing was agreed
(all fields empty)". `deposit_amount` lives inside that object.

**This is the displayed-vs-asked mechanism.** The question renders because the slot
is unanswered; the slot becomes "answered" by data appearing, not by an ask
happening. **What the fix assumed that turned out false:** that presence of the
object implies the question was put.

### The misspelled customer name

**A confirmation step exists, and it is model-discretionary rather than enforced.**
`job-intake-prompt.ts:205-211` (D13) instructs the model to *infer and read back*
rather than interrogate, consolidating several details into one sentence, and
`:264-266` adds:

> …'got that right?' — and only that once, not every time. If they correct you,
> ask them to spell the […]. Don't turn this into a spelling test; it's a single
> quick check per detail.

So the model is told to read a name back once and to request spelling **only after
a correction**. Nothing in code verifies that the read-back happened, and there is
no post-call confirmation of the captured name anywhere.

**Should there be?** For the name specifically, yes — but as a cheap typed
confirmation, not more voice. The name is already blocked at send
(`"Missing customer details: name and a phone number or email. The quote can't be
sent until these are filled in."` was one of the three stored flags on this very
job), so the contractor is *already* typing it in the editor for most jobs. The
gap is that a name captured **successfully but wrongly** never surfaces for review,
because a populated field looks identical to a correct one. Showing the captured
spelling in the send confirmation, editable, costs one field and closes it.

---

## Group 4 — documents assert things the app cannot do

### Item 10 — contract validity

**Confirmed, systemic, and quantified.**

All five templates carry an unfilled contractor signature line —
`src/lib/contracts/templates.ts:121, 280, 443, 593, 733`:

```
**Signed by the Contractor:** ______________________  Date: __________
```

And the app tells the customer the opposite —
`src/app/c/[id]/contract-response.tsx:36`:

> This contract is fully signed — it only needs one signature.

There is no contractor signing step anywhere in the product.

**How many are already out there:**

| | Count |
|---|---|
| Contracts created | 17 |
| Ever sent (`sent_at` set) | **17** |
| Signed by a customer | **15** |
| Distinct trades affected | **6** |

Every contract the product has ever sent carries this state — the block is in the
template, not in per-job data.

#### This needs legal review, and I am not recommending an option

Both options are drafting decisions about whether the result binds under English
law, not engineering conveniences. Specced, not recommended:

**Option A — remove the contractor block.** Delete the line from five templates and
state that the contractor's issuing of the contract constitutes their acceptance.
Engineering cost: hours. **Legal question: does an unsigned issued document form a
binding contract on the contractor's side, and does removing a signature line the
customer has already seen on 15 signed contracts change their status?**

**Option B — build contractor signing.** A signing step before send, a
`contractor_signed_at` column, template variables for the signature block, and a
status model that distinguishes partially from fully signed. Engineering cost:
days, plus a migration. **Legal question: does this need to be in place before the
15 already-signed contracts are relied on, and do those need re-issuing?**

The second question under each option is the one that matters and neither is mine
to answer. **Flagging clearly: this must go to legal review before either change
touches five templates.**

### Item 11 — business details: closed, and the fix is working

**Classification: (d).** Production settles it.

`missingContractProfileFields` (`src/lib/business-profile-gaps.ts:39-56`) checks
three fields: `registered_address`, `business_structure`, `default_payment_terms`.
Company number and VAT are not checked, and neither is Companies House
verification — that mechanism does not exist.

Buckland Plastering's `business_profile` keys:

```
business_email, business_phone, default_payment_terms,
default_warranty_period, insurer_name, public_liability_cover,
registered_address
```

**`business_structure` is absent** — the key is not present at all. Both other
Buckland contractors have it. The validator is correct and P1·8's fix is working.

**Why "every field is populated" was a reasonable thing to believe, and the real
finding:** `business_structure` lives in the *"Legal & contract details"*
Disclosure, which is **closed by default** — precisely the trap the P1·8 comment
documents ("a trade followed that link, found the details he had gone looking for
already present, and concluded the app was broken"). Every field visible without
opening a collapsed section *was* populated. The remaining defect is not the
validator and not the copy; it is that the destination link lands on a section the
reader must still open, on a page where five other sections are also closed.

**The (c)-or-(d) question:** the fix is on `main` and the banner now reads
*"Contracts you send won't state your business structure. Add it here:"*. Since
`business_structure` is genuinely absent, that banner is **correct and should still
be showing**. This is a working feature reporting a real gap.

**The Companies House 401 is separate and real.**
`src/lib/companies-house.ts:36-38` reads `COMPANIES_HOUSE_API_KEY`; a 401 is an
invalid or expired key — an environment problem, not code. It blocks nothing: the
manually-entered number reaches the contract.

### Item 7 — sign-in unreachable on a fresh install

`src/app/login/page.tsx:171`:

```jsx
<main className="flex flex-1 items-center justify-center p-6">
```

A flat `p-6`, no safe-area inset. `pt-safe` exists (`globals.css:515`) and is used
in exactly **two** places: `toast.tsx:77` and `start/quote/page.tsx:303`. Login and
signup use neither it nor `PageHeader`.

With `items-center justify-center`, content taller than the viewport overflows
**both** directions, pushing the top under the status bar with no way to scroll to
it.

**Confirmed** for the missing inset; **Likely** for the overflow being what puts
the button under the battery specifically — that needs a device measurement.

**Shares the path:** `src/app/signup/page.tsx`, and any screen not rendering
`PageHeader` or `status-bar-backdrop`. Those two plus `offline-banner` are the only
consumers of the inset tokens in the tree.

### Item 12 — contract channel UI: the premise was wrong

**Reclassified (a), and the copy is not hardcoded.**

`src/app/jobs/[id]/page.tsx:318-323` builds the banner **from data**:

```js
const sentChannelLabels = { email: "email", sms: "text" };
const sentChannels = (channels ?? "").split(",").map(c => sentChannelLabels[c]).filter(Boolean);
```

`channels` is a query parameter on the post-send redirect. And the send itself is
genuinely dual-channel: `src/lib/notify-customer.ts` imports both
`sendContractEmail` and `sendContractSms`, with `contract_sent` handled in the
email switch (`:90-95`) and an SMS switch alongside it. The header comment (`:11`)
records that the contract path *used* to be `if (email) { … }` and was fixed.

So the send is right and the banner is data-driven. **The defect is in what the
contract send passes as `channels` on its redirect** — a wrong or partial value
there produces exactly the reported symptom.

**Confidence: Needs more evidence** — I could not locate the contract send's
redirect call site (there is no `sendContract` symbol; the senders are reached via
`notifyCustomer`). Rev 1 accepted "the copy is hardcoded" without checking, which
was wrong; naming the button that triggers the send would close this in one pass.

---

## Cross-cutting questions

**1. What ends a voice session, and why is "required fields answered" not one?**
It *is* one, for five checklist slots — defeated three ways: asked-once counts as
answered, a closed data channel skips the ask, and `agreed_costs` is satisfied by
an empty object. The gate's vocabulary is also narrower than the prompt's: pricing
mode is not a slot, and customer name and site address are reported-only, the
latter by explicit decision. Production shows all of this firing on one job.

**2. The mechanism that lets a question render without being spoken.** Rendering is
driven by `getUnansweredChecklistQuestions`; asking is driven by the model
receiving `buildQuestionInstructions`. Nothing ties them. A slot flips to
"answered" when its *field* is populated — by an empty object, or by a delta from
unrelated conversation — with no record that a question was spoken. It is a class
because answered-ness is tested on data presence rather than on an ask having
happened.

**3. Fixed price vs line items — which is authoritative?** Neither, and that is the
defect. Three consumers apply three different line filters. VAT can be computed
from one while the total comes from the other because no layer owns the question.

**4. Document propagation — one layer or several?** Several, and one direction is
missing: SoW → quote at compile; quote → contract via `contractPrefillFromJob`;
quote → documents at send; **quote → SoW does not exist**. Rev 3 fixed dates
(P1·9) and site address (P1·6) by adding fields to `contractPrefillFromJob` — one
direction, one hop, per field. There is no propagation layer to fix, which is why
each field needs its own ticket.

**5. Error dead ends — did the P0·4 split ship, and would it have helped?** It
shipped, and it would not have. It added boundaries to `/q`, `/c`, `/i` — the three
**customer-facing** routes. All of this round's dead ends are **contractor-facing**:
a server action on `/jobs`, a Settings toast that discards the reason it was
handed, and a Stripe button with no state vocabulary. The split was drawn along the
wrong axis — it protected where a stranger sees a crash, not where the operator
needs a next action.

---

## The pattern: this is not a rev 3 problem

Rev 1 of this document concluded the rev 3 plan was sloppy. That was too narrow,
and the fourth instance is the one that reframes it.

### The fourth instance predates the plan by months

`src/lib/stated-price-guard.ts:9-21` documents a real production incident in its
own header:

> production carried the proof: a quote whose SoW said £5,000 and whose single
> works line read £5.00, sent unguarded and ACCEPTED at £6.00 gross. The mechanism
> was mundane — a switch to fixed seeded fixed_amount from the calculated
> subtotal, then the works line was edited directly, and updateQuoteLineItems
> writes line_items_json and total while never touching sow_json.

The response to that incident was **`reconcileStatedPrice` — a guard that DETECTS
the divergence.** The divergence itself was never fixed. `updateQuoteLineItems`
still writes `line_items_json` without touching `sow_json` today
(`src/app/jobs/actions.ts:1139-1155`), which is **why item 3 exists in this
document**, months later.

So item 3 is not (a) new. It is **(c)** — the same defect, previously responded
to, still present, because what shipped was detection.

### Four instances of one habit

| | Defect | What shipped | What was left undone |
|---|---|---|---|
| **£5,000/£5.00** (pre-plan) | Two stored figures free to diverge | A guard that detects divergence | The divergence |
| **P0·2** | A trade never learns they were accepted | Non-throwing notifiers + an `events` row | A delivery status anything reads back |
| **P1·6** | Site address missing from documents | It reaches the contract when captured | Anything that makes it get captured |
| **P2·13** | The money question never asked | `agreed_costs` marked required | An "answered" test that means *asked* |

The habit: **when a money or data-integrity bug is found, this codebase ships the
thing that would have told you about it, and records that as the fix.** Every one
of those four is defensible in isolation and every one leaves the original defect
in place.

### Why the reframe changes what to do about it

If this were a rev 3 quality problem, the remedy would be a more careful plan.
It is not. It is a **standing disposition**, visible before the plan existed, and
the plan inherited it rather than introduced it. Three consequences:

1. **A rev 4 written the same way will produce a rev 3 outcome.** Every item needs
   an explicit answer to "does this *prevent* the defect, or *report* it?" — and
   where the answer is report, that must be stated as a deliberate, costed choice
   rather than recorded as the fix.
2. **The existing guards are load-bearing and should not be trusted as fixes.**
   `reconcileStatedPrice`, `wrap_incomplete`, `unasked_required` and
   `notification-health` are all detection layers over live defects. Their presence
   makes the codebase look better covered than it is, which is how item 3 survived
   months of attention.
3. **`AGENTS.md` already forbids this** — "a signal that must change behaviour
   cannot terminate in telemetry" — and it was violated three times in one week by
   a plan written against that file. A rule that is documented and not enforced is
   itself an instance of the pattern.

---

## Combined C-class list

Contractual decisions requiring human sign-off, carried forward from rev 3 plus
this round.

| Source | Item | Scope |
|---|---|---|
| rev 3 | Accepted document — liability wording | 3 documents, 3 trades |
| rev 3 | Accepted document — remediation question | as above |
| rev 3 | Accepted document — contractor-directed exposure | as above |
| **round 2** | **Contractor signature block vs "fully signed"** | **17 contracts sent, 15 signed, 6 trades** |

The round-2 item is materially larger than the three it joins: it affects every
contract the product has ever sent, and unlike the rev 3 items it is a
**structural** contradiction — the document requests a signature the product
cannot capture and then declares itself complete — rather than a wording exposure.

I have deliberately not recommended between removing the block and building
contractor signing. Both need legal review first.

---

## Still open

| Item | What is needed |
|---|---|
| Invoice send 500 (blocking) | The Vercel function log for that request |
| Group 1 exact reconciler trigger | Not blocking — the stored outcome is already worse than the reported one |
| Item 12 redirect | The name of the button that sends the contract |

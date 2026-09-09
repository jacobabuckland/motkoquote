# Motko — test round 2 root cause analysis

**Test:** Buckland Plastering, 9 September 2026 — second full test after the rev 3 remediation plan.
**Audited:** `main` @ `6f12cca`, clean tree, in sync with `origin/main`.
**Contract:** investigation only. No code was written or changed.

## Scope and limits

Every claim below is traced to the source tree with a file and line. Where a
diagnosis needs a database row or a server log to close, that is stated rather
than inferred.

**What I could not read.** Production database and server logs were unavailable
from this session — the Supabase connector needs re-authorising, and an
interactive session is required to complete that OAuth flow. Two items below are
consequently marked *Needs more evidence* rather than guessed at.

**Where the rev 3 plan lives.** Not in `docs/`. The plan's decisions are recorded
in `areas/motko.md` (entries dated 2026-09-08, tickets `P0-1` … `P2-15`), which is
what the classification column is checked against.

---

## Classification summary

Per the round-2 brief: (a) new, not in the rev 3 plan · (b) planned, not yet
shipped · (c) shipped and still failing · (d) shipped and working.

| # | Item | Class | Note |
|---|---|---|---|
| 1 | Fixed price drops materials, VAT under-charged | **(a)** | Mechanism predates rev 3 but was never in it |
| 2 | Reconciler error is a dead end | **(a)** | |
| 3 | Quote edit doesn't regenerate SoW | **(a)** | |
| 4 | Invoice send 500 | **(c)** | P0·4 shipped boundaries for `/q` `/c` `/i` — not for `/jobs`, where this fired |
| 5 | Stripe onboarding state + missing UI states | **(a)** | |
| 6 | APNs "all devices rejected" | **(c)** | P0·2's persisted status did not ship; gateway mismatch already ruled out |
| 7 | Sign-in behind battery on iPhone 17 | **(a)** | |
| 8 | Voice ends before required fields | **(c)** | For site address, (d)-by-design — rev 3 decided this deliberately |
| 9 | Deposit displayed, never asked | **(c)** | P2·13 shipped; its own escape hatch defeats it |
| 10 | Contract validity / contractor signature | **(a)** | |
| 11 | Business details still "missing" | **(c)** | Fix shipped; the reported cause is not the actual one |
| 12 | Contract channel UI backwards | **(b)** | Not in rev 3 |
| 13 | SoW materials + provisional sum | **(d)** | Closes P2·15 |
| 14 | Contract sent by SMS | **(d)** | Closes P2·11 |

---

## Group 1 — one fixed-price field, three different opinions about what it means

**Severity: highest. Must be true before launch.**

Three code paths disagree about which line items count, and the disagreement is
silent.

### The mechanism

**`applyPricingMode` deletes lines** — `src/lib/pricing-mode.ts:89-96`. When
`pricing.mode === "fixed"` and `fixed_amount` is set, it returns
`[worksLine@fixed_amount, ...provisionals]`. Every **non-provisional** calculated
line is discarded — not scaled, not merged, dropped. A £400 materials line that
is not flagged provisional ceases to exist.

**VAT then derives from whatever survived** — `src/lib/quote-math.ts:50-59`.
`computeQuoteTotals` sums all remaining lines and multiplies by 0.2. VAT is
charged on the stated figure alone, and the £400 is absent from both the subtotal
and the VAT base. This is exactly the reported "VAT on the labour only, £400
dropped".

**The reconciler counts a third set** — `src/lib/stated-price-guard.ts:83-99`. It
compares `fixed_amount` against non-provisional lines *only*.

| Consumer | Provisional lines |
|---|---|
| VAT / total base (`computeQuoteTotals`) | **included** |
| Reconciler base (`reconcileStatedPrice`) | **excluded** |
| `applyPricingMode` fixed collapse | **preserved** (non-provisional deleted) |

Three consumers, three answers.

**Confidence: Confirmed** — all three are plain reads of the cited lines.

### Why the materials figure never reached the fixed price

The tool schema asks the model for the wrong thing —
`src/lib/schemas/sow.ts:449`:

> `'fixed'` = they gave you a single total for the whole job, e.g. 'call it two
> grand' — set mode to `'fixed'` AND put that number in `fixed_amount`.

The test did not supply a single total. It supplied two components (£1800 labour,
£400 materials). There is no schema shape for that, so the model selected one
number and called it the total. `fixed_amount` is documented as "net, before VAT"
for "the whole job"; it captured a part.

### A second fixed-price field with opposite semantics

`sow.agreed_costs.fixed_price` is consumed by `applyAgreedFixedPrice`
(`src/lib/agreed-costs.ts`), which **scales every line proportionally** to hit the
target and absorbs the rounding residual into the largest line.

So the codebase has two fields named fixed-price, fed from the same conversation,
with opposite behaviour — one deletes lines, one scales them.

### Confidence on the exact sequence observed: Likely

The collapse explains the dropped £400 and the VAT base. It does **not** by itself
explain the reconciler reporting "lines come to 2200" — after a collapse the lines
sum to 1800 and no flag fires.

For both observations to hold, `line_items_json` must have reached 2200 *after*
compile. That is what `updateQuoteLineItems` does on a save: it writes
`line_items_json` and `total` and never touches `sow_json`. The file's own header
comment (`src/lib/stated-price-guard.ts:9-21`) documents this precise divergence
as a past production incident — a £5,000 SoW against a £5.00 works line, sent and
accepted at £6.00 gross.

**To close this:** the `quotes` row — `line_items_json`, `drafted_line_items_json`
— and `jobs.sow_json.pricing` for that job.

### Item 2 — the reconciler dead end

`src/app/jobs/actions.ts:1319-1349`. The gate computes `reconcileStatedPrice` and
on failure does `throw actionableError(...)`. Nothing in `sendQuoteSchema` lets a
contractor say which figure is right, so every retry recomputes the same result
from unchanged data.

**Confidence: Confirmed.**

**What resolving it looks like.** The codebase already has this pattern three
times: `sendQuoteSchema` carries `confirmZeroTotal`, `confirmNarrativeMismatch`
and `confirmOverCeiling` — each an explicit "I have seen this, proceed" flag.
Reconciliation is the only money guard with no counterpart.

But a bare confirm is the wrong shape here. The two figures genuinely disagree and
one of them is wrong, so the resolution is a choice, not an acknowledgement:

> Your stated price says £1,800. Your lines come to £2,200.
> → **Update the fixed price to £2,200** (writes `sow_json.pricing.fixed_amount`)
> → **Rescale the lines to £1,800** (runs `applyAgreedFixedPrice`)

Both operations already exist as functions. Neither is reachable from the error.

### Item 3 — quote edit does not regenerate the SoW

`src/app/jobs/actions.ts:1139-1155`. `updateQuoteLineItems` writes
`line_items_json`, `total` and `contractor_flags_json`. It *reads* `sow_json` to
recompute flags and never writes it.

There is no regeneration hook to find — **it does not exist**. `sow_json` is
written in exactly three places: the voice delta path (`:371`), conversation end
(`:515`), and the pricing-mode switch (`:976`). A quote edit is none of them.

**Confidence: Confirmed.**

---

## Group 2 — a signal that must change behaviour ends in telemetry

`AGENTS.md` states the rule:

> A signal that must change behaviour cannot terminate in telemetry. If a computed
> check needs to reach a human or gate an action, it must be routed to a surface
> that does so. Writing it to an events or analytics sink is not delivery.

Three of this round's failures are that rule being broken.

### Item 6 — APNs: the prime suspect is already fixed

**The sandbox/production gateway mismatch is not the cause.**
`src/lib/push/apns.ts:63-88`: `attemptOrder` tries **both** gateways, likeliest
first, and `APNS_ENV` only orders the attempts. A token is reported `gone` only
when *both* gateways reject it (`:28-34`). The header comment (`:10-27`) documents
this as the already-fixed bug, including the subscription-deletion loop it caused
— enable notifications, first send bounces, row deleted, Settings reverts to "No
devices registered yet".

So "all devices rejected" means both gateways rejected, which points at the
**token**, not the routing. Remaining candidates, in order:

1. Tokens minted by the July App Store build that #684 identified as live,
   invalidated by a reinstall.
2. `APNS_BUNDLE_ID` not matching the app's `app.motko.ios`.
3. `APNS_TEAM_ID` mismatch.

**Confidence: Confirmed** that the gateway mismatch is excluded. **Needs more
evidence** to choose among the three above — which requires the reason string.

### And the reason string is thrown away, twice

**P0·2 did not ship as decided.** The recorded decision reads:

> A persisted delivered/failed status is a hard condition on the notifier
> hardening and ships in the same PR.

What actually exists: `sendPushToUser` builds a `summary` carrying `failures[]`
with Apple's reason per device, then `console.log`s it
(`src/lib/push/index.ts:135`). `notification-health.ts` writes to the `events`
table (`:68`, `:109`). **No per-notification delivery status is persisted
anywhere** — no column on `push_subscriptions`, no deliveries table in any
migration.

The hardening shipped. Its hard condition did not.

**What the fix assumed that turned out false:** that making notifiers
non-throwing, plus an events row, equals observability. It converted a loud
failure into a quiet one and put the evidence somewhere nothing reads back.

**Then the UI discards it again.** `src/app/settings/settings-client.tsx:135`
renders `"All devices rejected the notification. Check the server logs."` — while
the API response it has just received contains `failures[]` with the reason. The
dead end is self-inflicted: the answer was in the payload.

**Confidence: Confirmed.**

### Item 4 — invoice send 500: P0·4 shipped, but not where this fired

P0·4 shipped `error.tsx` and `not-found.tsx` for `/q`, `/c` and `/i` — all six
files are present in the tree.

**Invoice send is not on those routes.** It is a server action from
`/jobs/[id]`, and `src/app/error.tsx` is the generic root boundary. The split
shipped and would not have helped here.

**Confidence: Confirmed** for the classification. The underlying error cannot be
named without the logs — the generic message is Next.js redacting a
server-component throw, and bank details being set rules out the obvious guard.

**To close this:** the Vercel function log for that request.

---

## Group 3 — the voice gate is narrower than the prompt

### Items 8 and 9 — required slots, and the deposit

The prompt and the code disagree about what "required" means.

**The prompt** (`src/lib/voice/job-intake-prompt.ts:45-47`) tells the model the
required slots are *"crew, pricing mode, materials supply, and the working
dates"*.

**The code** (`src/lib/schemas/sow.ts:1072-1097`) defines
`REQUIRED_CHECKLIST_QUESTIONS` as `crew, duration, materials_supply,
working_dates, agreed_costs`.

#### `pricing` is not a checklist slot at all

It is absent from `CHECKLIST_QUESTION_IDS` (`src/lib/schemas/sow.ts:9-16`). The
gate can never hold a wrap for it — which is how a fixed-price job reaches quote
generation with `fixed_amount` set to a component figure. **This connects Group 3
directly to Group 1.**

#### Customer name and site address can never hold a wrap

They appear in `UNASKED_REQUIRED_IDS` (`:30-35`) — the *reporting* list — but not
in `CHECKLIST_QUESTION_IDS`, and `getUnansweredRequiredChecklistQuestions` filters
to the checklist. They are recorded after the fact, never gated.

For site address this was **deliberate**. Rev 3's P1·6 decision reads:

> `site_address` stays out of `unasked_required` and out of `wrap_incomplete`.

So a call ending without it is the shipped decision working as designed —
**(d)-by-design, and the design is wrong.**

#### Two further escape hatches

`src/components/voice/job-intake.tsx:668-700`:

- **Asked-once counts as done.** Unanswered slots are filtered by
  `askedRequiredSlotsRef`, and the wrap detour marks slots asked *up front* "so it
  counts as put-to-the-contractor even if the answer never lands". One detour
  marks all of them; if the answers never land, the next wrap passes straight
  through.
- **No data channel, no ask.** If `dc` is falsy the code records the slots into
  `wrapIncompleteSlotsRef` and calls `finishConversation` regardless.

The comment at `:660` still reads *"the three REQUIRED slots (crew, duration,
materials_supply)"* — stale by two.

#### The deposit specifically

`src/lib/schemas/sow.ts:1090-1096`. `agreed_costs` was promoted to required by
P2·13, but "answered" is satisfied by **the object's presence, not any figure
being set** — and the tool description instructs the model to "set this even if
nothing was agreed (all fields empty), so it's clear you asked".

`deposit_amount` lives inside that object. So `agreed_costs: {}` satisfies the
gate without a word being spoken.

**This is the displayed-vs-asked mechanism.** The question renders because the
slot is unanswered; the slot becomes "answered" by an empty object rather than by
being asked.

**What the fix assumed that turned out false:** that presence of the object
implies the question was put.

**Confidence: Confirmed.**

---

## Group 4 — documents assert things the app cannot do

### Item 10 — contract validity

**Confirmed, and systemic.**

All five templates carry an unfilled contractor signature line —
`src/lib/contracts/templates.ts:121, 280, 443, 593, 733`:

```
**Signed by the Contractor:** ______________________  Date: __________
```

And the app tells the customer the opposite —
`src/app/c/[id]/contract-response.tsx:36`:

> This contract is fully signed — it only needs one signature.

There is no contractor signing step anywhere in the product. The document requests
a signature the app cannot capture, then declares itself complete.

**Do any contracts already sent carry this state?** All of them do. The block is
in the template, not in per-job data.

**This needs a decision, and it is contractual.** The cheap correct fix is
removing the contractor block and having the templates state that the
contractor's issuing of the contract constitutes their acceptance. The expensive
one is building contractor signing.

### Item 11 — business details: the reported cause is not the actual one

`missingContractProfileFields` (`src/lib/business-profile-gaps.ts:39-56`) checks
exactly three fields:

- `registered_address`
- `business_structure`
- `default_payment_terms`

**Company number and VAT number are not checked at all**, and neither is Companies
House verification status. There is no validator treating an
unverified-but-manually-entered field as missing — that mechanism does not exist.

One of those three fields is therefore genuinely empty or whitespace.

P1·8's fix shipped. The banner now reads *"Contracts you send won't state your
business address. Add it here:"* with a link to the `#setup-legal` section. If the
wording seen in test was *"business details are missing"*, that deploy predates
`6f12cca`.

**Classification is (c) or (d)** depending on which deploy was under test —
determinable from the deploy timestamp.

**The Companies House 401 is separate and real.**
`src/lib/companies-house.ts:36-38` reads `COMPANIES_HOUSE_API_KEY`; a 401 from the
API is an invalid or expired key — an environment problem, not a code one. It
blocks nothing: as observed, the manually-entered number reaches the contract.

### Item 7 — sign-in unreachable on a fresh install

`src/app/login/page.tsx:171`:

```jsx
<main className="flex flex-1 items-center justify-center p-6">
```

A flat `p-6`, no safe-area inset. The `pt-safe` utility exists
(`src/app/globals.css:515`) and is used in exactly **two** places:
`src/components/ui/toast.tsx:77` and `src/app/start/quote/page.tsx:303`. The login
and signup screens use neither it nor `PageHeader`.

With `items-center justify-center`, content taller than the viewport overflows
*both* directions, pushing the top under the status bar with no way to scroll to
it.

**Confidence: Confirmed** for the missing inset. **Likely** for the overflow being
what puts the button specifically under the battery indicator — that needs a
viewport measurement on the device.

**What else shares the path:** `src/app/signup/page.tsx`, and any screen not
rendering `PageHeader` or `status-bar-backdrop`. Those two components plus
`offline-banner` are the only consumers of the inset tokens in the entire tree.

### Item 12 — contract channel UI

The hardcoded "sent to email" string was not located. It is not in
`jobs/actions.ts` or `dashboard/actions.ts`, and `sendContract` is not a symbol in
the tree — the senders are `notify-customer.ts`, `email.ts` and `sms.ts`.

**Confidence: Needs more evidence.** Naming the screen would close this in one
pass. Classification is **(b)** either way — it was not in rev 3.

---

## Cross-cutting questions

### 1. What conditions end a voice session, and why is "required fields answered" not one?

It *is* one, for five checklist slots — but the gate is defeated three ways:
asked-once counts as answered, a closed data channel skips the ask entirely, and
`agreed_costs` is satisfied by an empty object.

And the gate's vocabulary is narrower than the prompt's: pricing mode is not a
slot at all, and customer name and site address are reported-only by explicit rev
3 decision.

### 2. The mechanism that lets a question render without being spoken

Rendering is driven by `getUnansweredChecklistQuestions`. Asking is driven by the
model receiving `buildQuestionInstructions`. **Nothing ties the two together.**

A slot flips to "answered" when its *field* is populated — by the model writing an
empty object, or by a delta from unrelated conversation — with no record that a
question was ever spoken. The box disappears; nobody was asked.

It is a class rather than two bugs because the answered-ness test is on data
presence rather than on an ask having happened.

### 3. Fixed price vs line items — which is authoritative?

**Neither. That is the defect.** `applyPricingMode` treats `fixed_amount` as
authoritative and deletes lines. `computeQuoteTotals` treats the lines as
authoritative for VAT. The reconciler treats a third set — non-provisional only —
as the comparison basis.

VAT can be computed from one while the total comes from the other because no layer
owns the question.

### 4. Document propagation — one layer or several?

**Several, and one direction is missing entirely.**

- SoW → quote at compile (`compileQuote`)
- quote → contract via `contractPrefillFromJob`
- quote → documents at send
- **quote → SoW: does not exist**

Rev 3 fixed date carry-over (P1·9) and site address (P1·6) by adding fields to
`contractPrefillFromJob` — one direction, one hop, per field. There is no
propagation layer to fix, which is why each field needs its own ticket, and why
scope and pricing still do not propagate on edit.

### 5. Error dead ends — did the P0·4 boundary split ship, and would it have helped?

It shipped, and it would not have helped.

P0·4 added boundaries to `/q`, `/c` and `/i` — the three **customer-facing**
routes. All three of this round's dead ends are **contractor-facing**: a server
action on `/jobs`, a Settings toast that discards the reason it was handed, and a
Stripe button with no state vocabulary.

The split was drawn along the wrong axis. It protected the routes where a stranger
sees a crash, not the ones where the operator needs a next action.

---

## What the rev 3 plan got wrong about this codebase

Two rounds is enough to see the pattern, and it is the same one four times.

### It fixed reporting and called it fixing behaviour

- **P0·2** decided a persisted delivery status was "a hard condition" and shipped
  a `console.log` and an `events` row.
- **P1·6** decided site address reaches the contract and explicitly left it out of
  the wrap gate — so it reaches the contract when captured, and nothing makes it
  get captured.
- **P2·13** made `agreed_costs` required and defined answered as the object
  existing.

In each case the plan identified the right field, then made it *observable* or
*nominally required* rather than *enforced*. `AGENTS.md` names this exact failure
mode. The plan committed it three times in one week.

### It underestimated how many writers each fact has

The plan reads as though each field has one producer and one consumer. In reality
"the fixed price" has two fields with opposite semantics, three consumers with
three different line-item filters, and four writers of `line_items_json`, one of
which never touches `sow_json`.

Fixes were scoped per symptom — carry the date over, carry the address over —
where the actual defect is that no layer owns the value. That is why P1·9 and P1·6
both shipped and this round still shows scope and pricing not propagating.

### It classified by surface, not by who is stuck

P0·4's route split protected customer-facing pages. Every dead end hit this round
was contractor-facing.

The plan's severity model asks "who sees the error" when the useful question is
"who is blocked, and what can they do next". That is also why the reconciler
error, the Stripe onboarding button and the invoice 500 all shipped as terminal
states with no next action.

---

## Launch ranking

Ranked by "must be true before we launch", not by urgency.

**Blocking:**

1. **Group 1 — the pricing defect.** It under-charges VAT and silently deletes
   revenue from a quote. Nothing else on this list costs the trade money without
   telling them.
2. **Item 10 — the contract signature block.** Every contract sent to date asserts
   a signature that the product cannot capture and then declares itself fully
   signed.

Everything else can ship behind a known-issues line.

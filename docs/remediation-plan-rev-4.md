# Motko — launch remediation plan, rev 4

**Supersedes:** the rev 3 plan (8 Sep), whose decisions are recorded in `areas/motko.md` as tickets `P0-1`…`P2-15`.
**Evidence base:** `docs/test-round-2-rca-2026-09-09.md` (rev 2), audited against `main` @ `119345d` and production.
**Status:** proposed. Nothing here is approved; fix order is Jacob's call.

---

## How this plan differs from rev 3

Rev 3 failed in a specific, repeatable way, and it inherited the habit rather than
inventing it — the same pattern is visible in a pre-plan incident from months
earlier. Four instances:

| Defect | What shipped | What was left undone |
|---|---|---|
| £5,000 SoW vs £5.00 works line, accepted at £6.00 (pre-plan) | A guard that **detects** divergence | The divergence |
| P0·2 — a trade never learns they were accepted | Non-throwing notifiers + an `events` row | A delivery status anything reads back |
| P1·6 — site address missing from documents | It reaches the contract **when captured** | Anything that makes it get captured |
| P2·13 — the money question never asked | `agreed_costs` marked required | An "answered" test that means *asked* |

**The rule this plan runs on.** Every item below is labelled:

- **PREVENT** — the defect cannot occur after this ships.
- **REPORT** — the defect can still occur; someone is now told. Legitimate, but
  only as a **deliberate, costed choice**, never recorded as the fix.
- **REMEDIATE** — cleans up damage already done.

An item whose only label is REPORT does not close its defect, and the defect stays
on the list.

---

## 0. Live remediation — needs Jacob, not code

Two **accepted** quotes lost value in the fixed-mode collapse. Neither is
automatically a defect: a contractor genuinely saying "call it £1,800" for £2,356
of work is a discount, and the product is right to honour it. The two cannot be
told apart from the data, so both need a human look.

| Quote | Trade | Stated | Drafted work | Removed | Charged gross | Date |
|---|---|---|---|---|---|---|
| `46e3d510` | Buckland Plastering | £1,800 | £2,355.98 | £555.98 | **£2,160.00** | 9 Sep |
| `252d9951` | Aspire Plastering | £1 | £1,124.01 | £1,123.01 | **£1.20** | 27 Jul |

`46e3d510` is the round-2 test job, and its £400 stated materials never became a
line at all — the model substituted £1,256 of invented material lines, then the
collapse deleted all four. `252d9951` may well be a test row; it is listed because
a £1 fixed price against £1,124 of work is the same shape as the £5,000/£5.00
incident and should be confirmed as deliberate rather than assumed.

**Action:** confirm each was intended. **REMEDIATE. Cost: minutes. No dependency.**

---

## 1. Blocking — must be true before launch

Standard: *blocks a trade sending a quote or getting paid.*

### B1 · Invoice send returns a 500 — diagnose first

**Do this first: it is the cheapest blocking item and its cause is unknown.**

The generic message is Next.js redacting a server-component throw from a
`/jobs/[id]` server action. P0·4's boundaries cover `/q`, `/c`, `/i` only, so this
fell to the root boundary.

| | |
|---|---|
| Step 1 | Read the Vercel function log for the failing request. **REPORT — cost: minutes** |
| Step 2 | Fix whatever it names. **PREVENT — cost: unknown until step 1** |
| Step 3 | An error boundary for `/jobs` that states what failed and offers a next action. **REPORT — cost: S** |

Step 3 is explicitly a REPORT item and does not close B1. It is worth doing anyway
because it converts every future contractor-facing throw from a dead end into a
recoverable one — which is the axis P0·4 got wrong.

**Dependency:** none. **Start here.**

### B2 · The fixed price has three owners

The largest item, and the one that would embarrass us most. Four sub-items; B2.1
and B2.2 are the minimum that closes the defect.

**B2.1 — One layer owns "what does this quote cost".**
Today `applyPricingMode` deletes non-provisional lines, `computeQuoteTotals` sums
everything including provisional, and `reconcileStatedPrice` compares against
non-provisional only. Collapse the three filters into one documented function that
every consumer calls.
**PREVENT · Cost: M · No migration.**

**B2.2 — A fixed price must not silently delete priced work.**
`applyPricingMode` (`src/lib/pricing-mode.ts:89-96`) replaces the breakdown with a
single works line. Whatever the final shape — keep the breakdown and scale it, as
`applyAgreedFixedPrice` already does; or keep the collapse and surface the removed
lines for confirmation — the deletion must not be silent.
**PREVENT · Cost: M · Depends on B2.1.**

**B2.3 — The reconciler error must offer a resolution.**
`src/app/jobs/actions.ts:1319-1349` throws and every retry recomputes the same
result. `sendQuoteSchema` already carries `confirmZeroTotal`,
`confirmNarrativeMismatch` and `confirmOverCeiling`; reconciliation is the only
money guard without one. A bare confirm is the wrong shape — the resolution is a
**choice** between updating `sow_json.pricing.fixed_amount` and rescaling the lines
via `applyAgreedFixedPrice`. Both functions exist; neither is reachable.
**PREVENT · Cost: S · Depends on B2.1.**

**B2.4 — Two fields named fixed-price with opposite semantics.**
`sow.pricing.fixed_amount` deletes lines; `sow.agreed_costs.fixed_price` scales
them. Both fed from the same conversation. Pick one, migrate the other.
**PREVENT · Cost: M, plus a migration · Depends on B2.1.**

**Not sufficient on its own, and named so it isn't mistaken for a fix:** the tool
schema (`src/lib/schemas/sow.ts:449`) asks for "a single total for the whole job"
and the contractor gave two components. Widening the schema to accept components
is worth doing but is a **REPORT**-class improvement — the model can still pick
wrongly, and B2.1/B2.2 are what make that survivable.

**Dependency:** B2.1 gates the rest.

### B3 · Sign-in unreachable on a fresh install

`src/app/login/page.tsx:171` is a bare `p-6` with no safe-area inset. `pt-safe`
exists (`globals.css:515`) and is used in exactly two files. Login and signup use
neither it nor `PageHeader`.

| | |
|---|---|
| Fix | Apply the inset to login and signup. **PREVENT · Cost: S** |
| Guard | A test asserting every top-level route renders inside the inset system, so the next screen cannot miss it. **PREVENT · Cost: S** |

**Do this immediately — it is the cheapest blocking fix and at launch every user
is a fresh install.** **Dependency:** none.

### B4 · Contract asserts a signature it cannot capture

**Gated on legal review — see §3. No engineering should start until that returns.**

---

## 2. Non-blocking, ordered by cost-to-value

### N1 · Stripe onboarding re-prompts after completion

`complete` gates on `stripe_pay_by_bank_enabled` alone
(`stripe-connect-section.tsx:75-84`), so Stripe's verification window renders
identically to "you haven't finished". Production confirms:
`requirements_due: false`, `payouts_enabled: true`, `payout_details_complete:
true`, `pay_by_bank_enabled: false` — onboarding **is** done.

Add the fourth state. The data already exists, so no migration:

```
account present && !requirements_due && !pay_by_bank_enabled
  → "Submitted. Stripe is verifying — this can take up to 24 hours."
    No call to action, because there is nothing for the trade to do.
```

Plus an affirmative completed state, which currently just stops prompting.
**PREVENT · Cost: S · No dependency.** Good first item for someone else to pick up.

### N2 · The voice gate is narrower than the prompt

The prompt names four required slots; `REQUIRED_CHECKLIST_QUESTIONS` names five,
different ones. `pricing` is not a checklist slot at all, which is how a
fixed-price job reaches quote generation with a component figure — **this is why
N2 is upstream of B2**.

**N2.1 — "Answered" must mean *asked*.** `agreed_costs` is satisfied by the
object's presence (`sow.ts:1090-1096`), so `{}` closes the deposit question
without a word spoken. Record that a question was **put**, separately from whether
data arrived. Closes the displayed-vs-asked class, not just the deposit.
**PREVENT · Cost: M.**

**N2.2 — Close the two wrap escape hatches.** Asked-once-counts
(`job-intake.tsx:668-700`) and no-data-channel both end a call with required slots
unanswered. Production shows both firing: `agreed_costs: null`,
`declined_slots: []`, `wrap_incomplete: true`, quote sent and accepted.
**PREVENT · Cost: M · Depends on N2.1.**

**N2.3 — Add `pricing` to the required set.** **PREVENT · Cost: S.**

**N2.4 — Reopen the P1·6 decision on `site_address`.** Rev 3 deliberately kept it
out of `unasked_required` and `wrap_incomplete`. Round 2 shows a call ending
without it. That decision needs revisiting, not a new ticket around it.
**Decision, then PREVENT · Cost: S.**

**N2.5 — Confirm a captured customer name.** A read-back exists in the prompt
(D13, `job-intake-prompt.ts:205-211, 264-266`) but is model-discretionary and
unverified. A name captured *successfully but wrongly* never surfaces, because a
populated field looks identical to a correct one. Show the captured spelling in
the send confirmation, editable. **PREVENT · Cost: S.**

### N3 · Quote edits do not propagate to the SoW

`updateQuoteLineItems` (`src/app/jobs/actions.ts:1139-1155`) writes
`line_items_json` and `total` and never writes `sow_json`. **This is the
months-old defect** whose original incident produced `reconcileStatedPrice` — a
detector — while the divergence itself was left in place.

Fixing it is what stops this plan repeating the pattern a fifth time.
**PREVENT · Cost: M · Related to B2.1; can follow it.**

### N4 · Notification delivery status

P0·2 decided a persisted delivered/failed status was "a hard condition" and
shipped a `console.log` (`push/index.ts:135`) and an `events` row
(`notify-contractor.ts:134-148`). No per-notification status is persisted.

**N4.1 — Surface the reason that already exists.** The API returns `failures[]`
with Apple's reason; `settings-client.tsx:135` discards it and says "check the
server logs". **REPORT · Cost: S — but it is the entire diagnosis for the APNs
failure, so do it first.**

**N4.2 — Persist delivery status as P0·2 decided.** **REPORT · Cost: M, plus a
migration.**

**N4.3 — Then diagnose the APNs rejection.** The gateway mismatch is already fixed
(`apns.ts:63-88` tries both; `gone` requires both to reject), so it is a token
fact: stale tokens from the July build, `APNS_BUNDLE_ID`, or `APNS_TEAM_ID`.
**Depends on N4.1.**

Notifications are **not launch-blocking**: `notifyContractorOfCustomerAction` sends
email *and* push, and `business_email` is populated. One qualifier — a trade with
no `business_email` falls back to push alone. **Make `business_email` required at
setup. PREVENT · Cost: S.**

### N5 · Contract channel banner

The copy is **not** hardcoded: the banner reads a `channels` query param
(`jobs/[id]/page.tsx:318-323`) and the send is genuinely dual-channel. The defect
is in what the contract send passes on its redirect.
**PREVENT · Cost: S once the send site is identified — needs the button name.**

### N6 · Business details — no code change

`business_structure` is genuinely absent from Buckland Plastering's profile; the
validator and P1·8's copy are both correct and working. The remaining friction is
that the link lands on a section the reader must still open, among five other
closed sections. **Optional: auto-open the linked Disclosure. PREVENT · Cost: S.**

Separately, `COMPANIES_HOUSE_API_KEY` is returning 401 — an expired or invalid
key. **Environment fix, not code. Cost: minutes.** It blocks nothing.

---

## 3. C-class — contractual, requires human sign-off

Combined list, rev 3 items plus this round.

| Source | Item | Scope |
|---|---|---|
| rev 3 | Accepted document — liability wording | 3 documents, 3 trades |
| rev 3 | Accepted document — remediation question | as above |
| rev 3 | Accepted document — contractor-directed exposure | as above |
| **round 2** | **Contractor signature block vs "fully signed"** | **17 sent, 15 signed, 6 trades** |

The round-2 item is materially larger and structurally different: every contract
the product has ever sent requests a contractor signature the product cannot
capture (`templates.ts:121, 280, 443, 593, 733`) while telling the customer *"This
contract is fully signed — it only needs one signature"*
(`contract-response.tsx:36`).

**Two options, specced, neither recommended:**

**Option A — remove the contractor block.** Delete the line from five templates;
state that issuing constitutes the contractor's acceptance.
*Engineering: S.* **Legal question: does an unsigned issued document bind the
contractor, and does removing a signature line that 15 signed contracts already
carry change their status?**

**Option B — build contractor signing.** A signing step before send, a
`contractor_signed_at` column, template variables, and a status model
distinguishing partial from full signature.
*Engineering: L, plus a migration.* **Legal question: must this be in place before
the 15 signed contracts are relied on, and do those need re-issuing?**

The second question under each is the one that matters and neither is an
engineering call. **Nothing here starts until legal review returns.**

---

## 4. Proposed sequence

Ordered by dependency and by cost-to-unblock, not by severity alone.

| Order | Item | Why here |
|---|---|---|
| 1 | **§0** live quote review | Minutes. Two accepted quotes, one live |
| 2 | **B1** step 1 — read the log | Minutes. Cheapest blocking item, cause unknown |
| 3 | **B3** safe-area | S. Blocking, trivial, no dependency |
| 4 | **B4** → legal | Long lead time; start the clock now, engineering waits |
| 5 | **N4.1** surface the push reason | S. Unblocks the APNs diagnosis |
| 6 | **B2.1** one owner for quote cost | M. Gates B2.2–B2.4 and N3 |
| 7 | **B1** step 2 — the actual fix | Unknown until step 2 in this list |
| 8 | **B2.2, B2.3** | The rest of the pricing defect |
| 9 | **N2.1–N2.3** voice gate | M. Upstream of pricing capture |
| 10 | **N3** quote → SoW | M. Closes the months-old defect |
| 11 | **N1** Stripe fourth state | S. Independent throughout — good parallel work |
| 12 | Everything remaining | |

Items 3, 5 and 11 are independent of everything else and can run in parallel with
the B2 chain.

---

## 5. How to tell whether this plan worked

Rev 3 looked complete when it shipped. Three checks that would have caught it:

1. **Every closed item names its label.** An item closed with only REPORT work has
   not closed its defect. If the ratio of PREVENT to REPORT closures resembles rev
   3's, this plan has repeated the pattern.
2. **The existing detectors are not evidence of coverage.**
   `reconcileStatedPrice`, `wrap_incomplete`, `unasked_required` and
   `notification-health` all sit over live defects. Their presence is why N3
   survived months of attention. Do not count them as fixed.
3. **`AGENTS.md` already forbids this** — *"a signal that must change behaviour
   cannot terminate in telemetry"* — and rev 3 was written against that file and
   violated it three times in a week. A rule that is documented and not enforced is
   itself an instance of the pattern. If nothing in this plan makes that rule
   checkable, expect a rev 5.

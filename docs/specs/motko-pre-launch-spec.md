# motko — Pre-Launch Product Spec

**For:** Claude Code, running against `motkoquote` (+ Capacitor iOS shell)
**Owner:** Jacob
**Date:** 5 September 2026
**Status:** Decision-complete except Q-A (§9). Ready for ticket generation.

**Supersedes** five earlier drafts of the same date, archived under `docs/specs/archive/`. This is the only current document; do not reconcile a precedence chain.

**Supersedes on pricing:** the fee logic in `src/lib/motko-fee.ts`, applied live at `src/lib/stripe-payments.ts:62`, plus the ladder described in `pricing-review-aug-2026.md` and the FEE-1…FEE-9 series. Those two do not describe the same thing — the code implements a marginal percentage ladder (0.3% / 0.2% / 0.15%, £2 floor, no cap); the documents describe a flat banded ladder that was never fully built. **What is being replaced is the code.**

**Still current, unaffected:** `quote-flow-defects-aug-2026.md` §3 (price fidelity) and `motko-robustness-addendum-1-sep-2026.md`.

> **For the planning agent:** §3–§6 resolve to instructions. §9 holds one open question. Do not guess it, do not build against it, and do not raise clarifying questions against anything else.

---

## 1. What this covers

Voice quoting and price fidelity are being fixed under the robustness work. This document is everything else that must be true before marketing points strangers at the app.

**"Launch" means:** comfortable to start marketing and ask new trades to sign up. No date, no cohort target.

**Success measure:** a tradesperson who has never spoken to Jacob can sign up, get their Connect account ready, quote a job, get paid on the rail, and be correctly billed — with no manual intervention at any step. And if that job goes wrong, the money can be returned.

**The measured starting point**, 5 Sep 2026: 12 contractors, 6 external. **Zero external accounts have a Stripe Connect account.** One is active (23 jobs, last 30 Aug); the other five did 0–2 jobs and stopped within days. 37 quotes: median £992.50, mean £2,035, max £9,000, **none over the £10,000 ceiling**.

Connect onboarding is therefore not "the most likely cause of a trade being unable to take money" — it is a measured **0 for 6**. That is the single most important number in this document.

---

## 2. The strategic decision

The rail is optional and losing. Bank details render as a payment option, so the customer gets a free, familiar alternative to Pay by Bank. Trades who have never used Stripe keep doing what they always did, and every off-rail job earns motko nothing.

Pricing does not fix this. Nobody chooses friction over a bank transfer they already trust.

- **Stop offering the alternative by default.** Bank details leave the default invoice payload — but not the product, because a customer whose bank cannot do Pay by Bank still needs a way to pay (D6, RAIL-1).
- **Give the rail a capability bank transfer cannot match.** Automatic chasing already exists and works (`src/lib/chase-plan.ts`). Staged payments do not, and are the bigger differentiator.

**The cost of D6, stated plainly.** Routing every payment onto the rail removes the trade's ability to hand money back. Off-rail, the customer's transfer landed in the trade's own bank and they could simply send it back. On-rail the funds sit behind a destination charge and only the product can reverse them — and the product has no refund path. Pay by Bank has **no dispute mechanism** either, so a £5,000 payment would be irreversible inside motko. That is worse than the position being replaced. **REFUND-1 is launch-blocking and gates RAIL-1.**

---

## 3. Locked decisions

### 3.1 Commercial model

| # | Decision |
|---|---|
| D1 | **Two revenue lines only: a £9.99/month subscription, and a per-transaction payment fee on in-motko settlements.** No service fee, no off-rail fee, no accrual, netting or collection machinery. |
| D2 | **The transaction fee is Stripe's cost plus 65%.** See §3.5 for the resolved schedule. |
| D3 | **One *kind* of fee per job, and only on jobs that settle through motko.** A job marked paid manually incurs no transaction fee. D3 is about rail exclusivity — payment fee or service fee, never both. **It says nothing about how many charges a job may produce.** |
| D4 | **Three free jobs per account, waiving the transaction fee only.** Decremented on rail settlement only; a marked-paid job never decrements it. Motko absorbs Stripe's cost on these — up to £18 per signup, accepted as an acquisition cost. |
| D5 | **The subscription is the revenue model. The transaction fee is not.** No product decision is made to maximise transaction fee revenue. |
| D6b | **No grandfathering.** Every account, existing and new, is on these terms. Five of the six external accounts are dormant with no payment method; they will fail, dun, and go read-only harmlessly. The one active tester gets a call from Jacob, not a code path. |

### 3.2 The fee schedule — resolved

**Motko's actual Stripe cost today**, VAT-inclusive because motko is not yet VAT-registered and cannot reclaim it:

> **0.6% + 24p, capped at £6.00**

(Stripe's headline 0.5% + 20p capped at £5, plus 20% VAT.)

**Motko charges 1.65× that:**

> **0.99% + 39.6p, capped at £9.90**

| Job value | Stripe costs motko | Motko charges | Margin |
|---|---|---|---|
| £50 | £0.54 | £0.89 | £0.35 |
| £100 | £0.84 | £1.39 | £0.55 |
| £992.50 (median) | £6.00 | £9.90 | £3.90 |
| £9,000 (largest ever) | £6.00 | £9.90 | £3.90 |

**No job loses money, by construction** — margin is always 0.65 × cost, so it is positive at every value without needing a floor. Free jobs are the only exception and are a deliberate cost.

Three implementation rules follow:

1. **The schedule is fixed, not a live multiplication.** When motko registers for VAT its cost drops to 0.5% + 20p capped at £5; **the charged fee does not change** and the extra margin is retained. 1.65 is the derivation, not a runtime factor. Implement the schedule as named constants with the derivation in a comment.
2. **Never describe it to trades as "Stripe's fee plus 65%".** That becomes untrue the day motko registers, and a trade can check it. Describe the rate: *0.99% + 40p, capped at £9.90*.
3. **The fee-swallows-payment guard survives.** `stripe-payments.ts` already refuses a fee that would consume the payment — on a £1 job the fee is 41% of it. **A skipped fee must record `not_applicable`, never `accrued`.** Seven of 37 quotes are under £80, so this path is live, not theoretical.

**Known and accepted:** the £9.90 cap sits 9p from the £9.99 subscription. Raised and declined; the numbers hold. SUB-5's labelling therefore has to do real work so a trade does not read them as one charge or a duplicate.

### 3.3 Payment rail

| # | Decision |
|---|---|
| D7 | **Bank details are absent from the default public invoice payload** whenever the rail is available. **They remain reachable as a fallback** for three conditions only — Connect not ready, amount over the ceiling, or an outage — plus the post-failure on-demand path. |
| D8 | **No trade-facing setting re-enables bank details as a default payment option.** |
| D9 | **Mark-as-paid stays, unchanged and unpenalised.** Motko does not police how a trade gets paid; it stops doing the customer's work for them. |
| D10 | **Pay by Bank only on customer-facing surfaces. No card, ever.** |
| D11 | **Do not claim the rail is faster.** Copy sells scheduling and automatic chasing, never speed. |
| D12 | **The trade is merchant of record.** `on_behalf_of` is set on the PaymentIntent, so the customer's bank statement shows the trade's business, not motko. Taking a platform fee does not require motko to be merchant of record — destination charges exist precisely to separate the two. |

### 3.4 The £10,000 ceiling

| # | Decision |
|---|---|
| D13 | **Ask Stripe for the increase now; do not gate launch on the answer.** Pay by Bank defaults to £0.50–£10,000; higher limits require a support request. |
| D14 | **Jobs over the ceiling are detected at quote time**, never at payment-link generation and never at payment failure. |
| D15 | **The resolution offered is staged payment**, each stage under the ceiling. A capability, not an apology. |
| D16 | **Staged payment is Stripe-only.** |

**Not urgent, on the evidence.** No quote has ever exceeded £9,000 and none has approached the ceiling. STAGE-1 (detection) is cheap insurance and stays; STAGE-2 and STAGE-3 come off the launch path.

### 3.5 Fee behaviour on staged jobs

**The fee is charged per settlement, in full — percentage, fixed component and cap all per charge**, mirroring Stripe, whose own fee is per payment. There is no apportionment. That machinery only existed to defend reading D3 as "one charge per job", which D3 does not say.

- **A staged job consumes one free job**, not one per stage. The allowance is a job-level concept; the fee is not.
- **Above the ceiling there is no counterfactual.** A trade cannot pay in one payment, so two fees deny them nothing. Below the ceiling, staging is optional and chosen knowing there are two payments.

### 3.6 Subscription

| # | Decision |
|---|---|
| D17 | **£9.99/month.** State derived from Stripe Billing, never a local boolean. |
| D18 | **Billing starts when the three free jobs are used, not on a timer.** There is no time-based trial. A trade pays nothing until they have had value out of the product. |
| D19 | **A failed subscription payment leaves the account read-only.** Existing jobs, quotes and documents stay accessible; nothing new can be created. Locking a trade out of a signed contract over £9.99 is a support call and a bad story. |
| D20 | **Cancellation stops renewal; banked referral months play out.** A trade cancelling with three unconsumed months keeps using motko until they are gone. Not forfeited, not paid out. Mechanically this is the subscription continuing at full discount, not a cancel-at-period-end. |

### 3.7 Referral

| # | Decision |
|---|---|
| D21 | **One permanent, static referral code per trade.** Never regenerated, never expired — it will end up in old WhatsApp threads, on vans and on business cards. |
| D22 | **Attribution locks at signup and is never rewritten.** |
| D23 | **Five activated referrals credit one free month.** |
| D24 | **Activation requires the referee to complete a job**, not merely sign up. |
| D25 | **Credits are banked as discrete months and applied one at a time.** |
| D26 | **No cap on banked months.** The liability must be visible, not limited. |
| D27 | **The V1 surface is one line in Settings.** No page, no visualisation, no nudges. |

---

## 4. Hard constraints

| Constraint | Consequence if violated |
|---|---|
| Bank details leave the **default** payload only. `transfer_only` and the post-failure on-demand endpoint survive. | A customer whose bank does not support Pay by Bank, a trade mid-verification, or any outage leaves the customer with no way to pay at all. |
| **RAIL-1 may not ship before REFUND-1.** Payments already run on the rail; this constrains the change that makes the rail the default, not existing traffic. | An irreversible payment with no dispute mechanism and no way to hand it back, at the volume D7 creates. |
| **No live payment charges a fee under the superseded ladder.** CLEAN-6 zeroes it; SUB-3 replaces it. **Zeroing must cover both the Stripe call site and the settlement computation.** | `buildPaidJobSettlement` recomputes the fee independently via `motkoFeePennies` (`paid-job-settlement.ts:132`) and writes `fee_status: 'accrued'` when `application_fee_amount` is absent. Omitting the fee at the call site alone books the full old-ladder debt on every job — silently, because no money moves. |
| The over-ceiling `transfer_only` branch is not removed until STAGE-2 is live. | Jobs over £10,000 become unpayable in the gap. |
| STAGE-1 reads the existing `PAY_BY_BANK_LIMIT_PENNIES` (`pay-panel.ts:31`). No second constant. | The limit moves when Stripe grants the increase; two constants means one is silently wrong. |
| A skipped fee records `not_applicable`, never `accrued`. | Small jobs quietly accumulate a debt the trade never agreed to. |
| Referral activation is idempotent, once per referee, on first job completion only. | Repeat completions mint infinite free months. |
| A month credit is consumed atomically against a single invoice. | Concurrent invoice runs double-spend the credit. |
| Free-job consumption is not decremented by off-rail jobs. | The allowance evaporates without motko absorbing a cost. |
| Subscription state is derived from Stripe Billing, never a local boolean. | Same failure class as Connect readiness. |
| Connect readiness is keyed on `capabilities.pay_by_bank_payments == 'active'`. | Accounts onboard "successfully" and cannot take a payment. |
| Notification permission is requested device-side, after demonstrated value, behind an in-app pre-prompt. | On iOS the OS prompt is one-shot. A denial is permanent. |
| No ticket cites a document the factory cannot open — **and a failing citation is fixed by committing the document, never by removing the backticks.** | Evading the check is the failure the check exists to prevent. It has already happened once, in a draft of this document. |

---

## 5. Tickets

### DOCS — prerequisites

**DOCS-1 — Commit every referenced spec to `docs/specs/`.** Current documents at the top level; the five superseded drafts under `docs/specs/archive/`, each headed with a superseded-by line. Cross-references rewritten as repo paths.
*AC:* Every document cited by a live ticket resolves to a path in the tree, including the superseded ones cited here.

**DOCS-2 — Citation check in CI.** Extract backticked `*.md` references from specs and tickets, resolve each against the repo, fail on a miss.
*AC:* A ticket citing a missing document fails CI and names the path, verified by deliberately introducing one. **DOCS-1 lands first or this fails on the document that introduced it.**

### CONN — Stripe Connect guided onboarding

Zero of six external accounts have completed onboarding against the current passive Settings entry. This is the launch blocker.

**CONN-1 — Implement Epics A, B and D of `stripe-connect-activation-spec.md`.** Provisioning with prefill (B1–B2), the `account.updated` status projection (B4), the persistent status strip (D1), the expandable panel (D2), the post-first-quote trigger (D3), the hard gate at payment-link generation (D4).
*AC:* No code path produces a payment link for a non-`READY` account. All seven onboarding states render against fixture data.

**CONN-2 — Resolve the launch route and build the corresponding epic.** Check whether `@capacitor/browser` is present. Present → Epic C. Absent → Epic F. Record the outcome first.
*AC:* Onboarding opens in `SFSafariViewController` on a physical device, never in the Capacitor webview.

**CONN-3 — Request the Pay by Bank limit increase.** Operational, via Jacob's account manager. Does not block launch.
*AC:* Request submitted, outcome recorded. **The ticket states that a granted increase is a code change to `PAY_BY_BANK_LIMIT_PENNIES`, not a Stripe-side setting.**

**CONN-4 — Set `on_behalf_of` on the PaymentIntent.** `src/lib/stripe-payments.ts:91` uses `transfer_data: { destination }` alone, making motko merchant of record. D12 says the trade is.
*AC:* The connected account is merchant of record, **verified against a created PaymentIntent in test mode rather than assumed**.

### RAIL

**RAIL-1 — Audit bank-details exposure; remove from defaults, preserve the fallback.** *(gated on REFUND-1)*
`src/app/i/[id]/pay-panel.ts` already implements D7 correctly: three modes, and `button_only` carries no `transfer` property at all, so details are absent from the response body rather than hidden in it. `transfer_only` covers Connect-not-ready, over-ceiling and outage. `src/app/api/invoices/[id]/transfer-details/route.ts` serves details on demand only after a failed attempt. **All of that stays.** The work is an audit of every *other* surface.
*AC:* Bank details absent from the default payload; still reachable via `transfer_only` and the post-failure endpoint. No emailed variant, generated PDF, quote or contract renders them unconditionally. One rendering test per surface.

**RAIL-2 — Confirm mark-as-paid is unaffected and unpenalised.**
*AC:* A manually-paid job reaches the same terminal state as a rail-paid one, writes no fee record, and does not decrement the allowance.

**RAIL-3 — Rail-value copy on trade-facing payment surfaces.** Automatic chasing is **true today** — `chase-plan.ts` runs a 3/7/14/21-day wave with a hard contact cap, driven by `src/app/api/cron/chase/route.ts`, already excluding archived and declined quotes. Copy may claim it now.
*AC:* No shipped string asserts payment through motko arrives faster than a bank transfer. CI lint on a forbidden-phrase list. Only *stage-level* chasing claims are gated on STAGE-3.

### STAGE

**STAGE-1 — Detect over-ceiling quotes at quote level.** Reads `PAY_BY_BANK_LIMIT_PENNIES`.
*AC:* A £14,000 quote surfaces the staged path before the trade sends anything. No raw Stripe error reaches the customer.

**STAGE-2 — Staged payment schedule on a job.** *(not launch-blocking)* Deposit and balance minimum; each stage its own payment link, each under the ceiling; stages settle independently.
*AC:* A two-stage job pays deposit and balance separately, each producing its own settlement record. The job closes only when all stages settle. Fee behaviour follows §3.5 and lands with SUB-3.

**STAGE-3 — Extend automatic chasing to stages.** *(not launch-blocking)*
*AC:* An overdue stage produces a customer reminder and a trade-facing status without manual action, reusing the existing wave schedule and contact cap.

### SUB

**SUB-1 — Stripe Billing subscription at £9.99/month.** Created at signup with an **open-ended trial**, ended programmatically when the free-job allowance is exhausted (D18). State derived from Stripe.
*AC:* Subscription state survives webhook replay and out-of-order delivery. A trade with unused free jobs is never charged. The transition from trial to active is driven by allowance exhaustion, not elapsed time.

**SUB-2 — Free-job allowance.** Three per account (D4), decremented on rail settlement only.
*AC:* The first three rail-settled jobs take no transaction fee; the fourth does. Manually-paid jobs never decrement.

**SUB-3 — Transaction fee at the §3.2 schedule.** *(`risk:pricing`, hand-implemented)* Replaces `applicationFeeForPayment` at `stripe-payments.ts:62` and lifts CLEAN-6.
*AC:* The fee matches 0.99% + 39.6p capped at £9.90 exactly, per settlement, including on staged jobs. The fee-swallows-payment guard survives and records `not_applicable`. Unit-tested across the value range including £1, £50, £992.50 and £9,000.

**SUB-4 — Read-only on subscription payment failure** (D19).
*AC:* A trade with a failed subscription can open every existing job, quote, contract and invoice, and can create nothing new.

**SUB-5 — Fee visibility on the trade's payment receipt.** Job total → payment fee → you receive. This surface has never existed; its absence caused the 20 August incident where two live payments settled with the contractor seeing nothing. **Labelling must distinguish the £9.90 capped fee from the £9.99 subscription** (§3.2).
*AC:* A settled job shows the full breakdown. A free job shows the waiver and the remaining count. While CLEAN-6 holds, it says the fee is zero plainly.

**SUB-6 — Cancellation.** Stops renewal; banked referral months play out before access ends (D20).
*AC:* A trade cancelling with three banked months retains access for three months. Signed contracts, unpaid invoices and job history remain accessible throughout and after.

### REFUND — launch-blocking

`src/lib/settlement-reversal.ts` states there is no refund path, by design. Stripe supports Pay by Bank refunds, full and partial, for up to 730 days — and **no disputes at all**, so this is the only route by which money comes back.

**REFUND-1 — Full and partial refund on a settled job.** Reverses the transfer (money comes back out of the trade's connected account, possibly leaving it negative) and returns motko's fee. **The trade is warned explicitly before confirming.** Motko absorbs Stripe's processing fee, which Stripe does not return.
*AC:* A settled job refunds in full and in part. The trade sees the balance consequence before confirming. Post-refund state is unambiguous and distinct from both "paid" and "unpaid". Idempotent. A manually-marked-paid job has no settlement to reverse and is out of scope.

**REFUND-2 — Refund on a staged job.** *(not launch-blocking)*
*AC:* Deposit alone, balance alone, or both. Refunding one stage does not reopen the others.

### REF — minimum viable

**REF-1 — Attribution on signup.** *AC:* A second signup under a different code does not rewrite an existing attribution. Existing codes resolve indefinitely.
**REF-2 — Activation on first completed job.** *AC:* Idempotent. Signup without completion never activates.
**REF-3 — Five activations credit one banked month.** *AC:* Ten activations bank two months applied across two consecutive invoices. Concurrent runs cannot double-spend.
**REF-4 — One Settings line.** *AC:* Renders correctly at zero. No other referral surface exists.
**REF-5 — Liability query.** *AC:* Total unconsumed banked months across all accounts, readable without writing SQL.

### NOTIF

**NOTIF-1 — Diagnose before building.** Enumerate every trigger, determine which fire, locate the failure: permission, token registration, delivery, or trigger never called.
*AC:* A caller list and failure map before any patch is proposed.

**NOTIF-2 — Cover the launch-critical events.** Quote viewed, quote accepted, contract signed, payment received. "Payment stage overdue" is excluded — it does not exist until STAGE ships, and joins with STAGE-3.
*AC:* Each delivers on a physical device from a cold start.

**NOTIF-3 — Permission timing and pre-prompt.** Never at app open, never during signup. Trigger after demonstrated value — the trade's first quote sent — **evaluated device-side and held pending until the app is next opened**, since that is a server event and a trade may quote from the web. In-app explainer precedes the OS prompt; a soft decline leaves it unspent. Already-denied routes into iOS Settings.
*AC:* A fresh install reaching signup and abandoning has not consumed the OS prompt.

### CLEAN

**CLEAN-1 — Delete the retired mandate UI and blocking fee ladder.** `FeeBillingSection`, `FeeRunwayBanner`, `lib/fee-runway.ts`. *AC:* No route reaches a mandate CTA or a fee-runway block.
**CLEAN-2 — Delete `FEE_BILLING_ENABLED`.** *AC:* No reference remains in code or config.
**CLEAN-3 — Write off all accrued service fees unconditionally.** Eight jobs, £22.00. *AC:* No accrued balance influences any settlement, invoice or UI.
**CLEAN-4 — Remove `PLATFORM_APPLICATION_FEE_PENCE` from `.env.example`.**
**CLEAN-5 — Resolve `settlement-reversal.ts` against the new model.** *(sequenced with REFUND-1)* *AC:* No reversal logic references the retired service fee. **Escalation: the contractor terms quote this file's rules verbatim. Do not edit the terms — report the required change and stop.**

**CLEAN-6 — Take the transaction fee to zero until SUB-3 lands.** *(launch-blocking, `risk:pricing`, hand-implemented — NOT a factory ticket)*
Must zero **both** paths: the `application_fee_amount` at `stripe-payments.ts:62` **and** the independent recomputation in `buildPaidJobSettlement` (`paid-job-settlement.ts:132`). Zeroing the call site alone books the full old-ladder fee as `accrued` on every job. Lands after CLEAN-3, or CLEAN-3 writes off £22 while this accrues more behind it.
*AC:* No live payment carries an `application_fee_amount`, **and no settled job writes a non-zero `fee_amount_pennies` or a `fee_status` of `accrued`**. SUB-3 lifts this; the two are explicitly linked.

---

## 6. Sequencing

**Prerequisite:** DOCS-1 → DOCS-2.

**Launch-blocking:** CONN-1, CONN-2, CONN-4, RAIL-1, RAIL-2, RAIL-3, STAGE-1, SUB-1…6, REFUND-1, NOTIF-1…3, CLEAN-1…6.

**Ordering inside that set:** CLEAN-3 → CLEAN-6. REFUND-1 → RAIL-1.

**Not blocking:** REF, STAGE-2, STAGE-3, REFUND-2, CONN-3.

**Hand-implemented, outside the factory:** CLEAN-6, SUB-3. Both are money paths under `risk:pricing`.

---

## 7. Generate factory tickets for

DOCS-1, DOCS-2, CONN-1, CONN-2, CONN-3, CONN-4, RAIL-2, RAIL-3, STAGE-1, STAGE-2, STAGE-3, SUB-1, SUB-2, SUB-4, SUB-5, SUB-6, REFUND-1, REFUND-2, REF-1…5, NOTIF-1…3, CLEAN-1…5.

**RAIL-1 is generated with `awaiting-dependency` set from the start**, wake condition REFUND-1 merged. The factory has no "specced, hold implementation" state; an item that enters the queue runs to a merge, and RAIL-1 must not.

**CLEAN-6 and SUB-3 are not generated.** Hand-implemented per §6.

---

## 8. Out of scope

- **The marketing site**, including the "free while in early access" copy that contradicts a paid subscription.
- **Voice intake and price fidelity.** In flight under the robustness work.
- **Referral theatre** — visualisation, nudges, a dedicated page.
- **Card payments.** Pay by Bank only, permanently.
- **Separate charges and transfers.** Destination charges only.
- **A cross-account metrics surface.** None exists; `contractors.is_internal` (migration 63) has no reader in `src/`. Worth building, not before launch.

---

## 9. Open

**Q-A — What ends the free period for a trade who never settles on the rail?**

D18 starts billing when three free jobs are used. D4 decrements the allowance **on rail settlement only**. Together, a trade who never connects Stripe never exhausts the allowance and is **never billed at all**.

That is not hypothetical: no external account has a Connect account today, and five of six did two jobs or fewer. Under these rules, most signups would be free forever.

*Recommendation: the subscription trial ends on the third **completed** job however it settled, while the **fee waiver** stays rail-only. That keeps D4's cost logic intact — motko only absorbs a Stripe fee it actually paid — while the subscription engages for anyone getting value out of the product. This is money and subscription state, so it is not assumed.*

Also open from earlier work, unaffected: whether invoicing before completion is ever permitted, and whether the reconciliation gate blocks or warns.

---

## 10. Standing instructions

- **Cite file and line for every claim about existing behaviour.**
- **Where this document and the code disagree, the code wins** — say so explicitly rather than silently adjusting. Earlier drafts were wrong seven times on exactly that: an AC that would have deleted a deliberate payment fallback; a supersession note describing a ladder the code does not implement; copy cut for a chasing system that already ships; an existing-accounts crisis against a population thirteen times its real size; a migration proposed for a column that already exists; a launch set that would have charged the superseded ladder; and a fix for that which would have accrued it instead.
- **Anything touching money, fee calculation, subscription state or legal copy is halt-and-report, not a judgment call.**
- **Every ticket touching the pricing path carries `risk:pricing`** and is hand-implemented with the Verifier gating it.
- **No ticket may cite a document outside the repo**, and a failing citation is fixed by committing the document, never by removing the backticks.

---

## 11. Provenance

**Verified against the code:** the three-mode `pay-panel.ts` design and the on-demand transfer-details endpoint; `FREE_JOB_ALLOWANCE = 5` and the marginal ladder in `motko-fee.ts`; `applicationFeeForPayment` applied at `stripe-payments.ts:62`; the independent recomputation at `paid-job-settlement.ts:132` and `feeCollectedAtSource` at `webhook/route.ts:200`; `transfer_data: { destination }` without `on_behalf_of` at `stripe-payments.ts:91`; the absence of `reverse_transfer`; `PAY_BY_BANK_LIMIT_PENNIES` at `pay-panel.ts:31`; the "no refund path, by design" note in `settlement-reversal.ts`; the chase wave in `chase-plan.ts` and its cron driver; `contractors.is_internal` in migration 63 with no reader in `src/`.

**Verified against production**, 5 September 2026: 12 contractors, 6 external, none with a Stripe Connect account, one active; 37 quotes, median £992.50, mean £2,035, max £9,000, none over the ceiling, 7 under £80; 1 fee collected, 8 accrued totalling £22.00.

**Given by Jacob:** Stripe's Pay by Bank fee of 0.5% + 20p capped at £5; not VAT-registered; the 1.65 multiple; three free jobs; no grandfathering; £18 per signup accepted.

**Not verified:** the merchant-of-record behaviour CONN-4 asserts, which its own AC requires proving in test mode. The VAT-inclusive cost basis assumes Stripe's headline pricing is quoted ex-VAT — worth confirming against an actual Stripe invoice.

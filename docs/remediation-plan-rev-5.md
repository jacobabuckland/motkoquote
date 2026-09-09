# Motko — launch remediation plan, rev 5

**Supersedes:** rev 4 (`docs/remediation-plan-rev-4.md`) and the rev 3 plan recorded in `areas/motko.md` as `P0-1`…`P2-15`.
**Evidence:** `docs/test-round-2-rca-2026-09-09.md` (rev 2), `main` @ `119345d`, production database, and Sentry `motkoai`.
**Status:** proposed. Fix order is Jacob's call.

---

## What changed from rev 4

| # | Review point | Outcome |
|---|---|---|
| 1 | Hallucinated line items unlisted | **New item B2.0**, gating B2.2. Provenance exists but disables itself in the failure mode it exists for |
| 2 | §0 framing too generous | Corrected. `46e3d510` is not ambiguous. Both rows consolidated with §3 — **each carries three defects** |
| 3 | B1's log read not done | **Done. Root cause found, and it is not pricing-related — the sequence holds** |
| 4 | Re-test protocol missing | Restored as §4, with production evidence of what has never run |
| 5 | §5 diagnoses and leaves open | Made mechanical: a label in the `AGENTS.md` template, and a failing test required per PREVENT |
| 6 | B4 bundles two things | Split. The untrue assertion is now **B5**, a one-paragraph copy fix. Legal has an owner, a route and a date |

---

## §0 · Live damage — needs Jacob, not code

### The two under-charged quotes are the same two documents already on the C-class list

Rev 4 listed these separately in §0 and §3 without noticing they are the same
documents. Consolidated, with a correction: **neither is ambiguous, and each
carries three defects.**

**`46e3d510` — Buckland Plastering, 9 Sep. Accepted. Contract `6785a014` signed.**

| Defect | Evidence |
|---|---|
| £400 of stated materials lost | £1,800 + £400 was stated. Charged **£2,160 gross = £1,800 + VAT**. The £400 was not discounted, it was lost |
| Contract asserts a signature it cannot capture | Contract signed and sent |
| No site address | `sow_json.site_address` is null |

Rev 4 called this "a discount we cannot distinguish from a captured component".
That was wrong and too generous: the figures are known, £1,800 + £400 was said,
and £1,800 + VAT was charged. **Say it plainly — the £400 was lost.**

**`252d9951` — Aspire Plastering, 27 Jul. Accepted. Contract `a84491cb` signed.**

| Defect | Evidence |
|---|---|
| £1 stated against £1,124.01 of drafted work | Charged **£1.20 gross** |
| Contract asserts a signature it cannot capture | Contract signed and sent |
| No site address | Already on rev 3's C-class list as the 27 July document missing its site address |

Rev 4 called this "possibly a test row". It is not — it is a signed contract
behind an accepted quote, and it is the *same document* rev 3 already flagged.

### Re-checking for other documents on both lists

| | Count |
|---|---|
| Contracts sent | 17 |
| Signed | 15 |
| Sent with **no site address** | 13 |
| **Signed AND no site address** | **11** |
| Fixed-mode | 3 |
| Trades affected | 6 |

**The C-class overlap is far larger than rev 3's "3 documents across 3 trades".**
Eleven signed contracts lack a site address, and all 17 carry the signature-block
defect. §3 is corrected accordingly.

**Action:** review both quotes and confirm what was intended.
**REMEDIATE · Cost: minutes · No dependency.**

---

## §1 · Blocking

### B1 · Invoice send 500 — **root cause found**

The log read is done. **It is not pricing-related, so B1 and B2 do not share a
root cause and the rev 4 sequence stands.**

Sentry `JAVASCRIPT-NEXTJS-B`, release `6f12cca`, `handled: no`,
`route_type: action`, `POST /dashboard`, thrown from `deriveInvoiceAmount`:

> **Error: Mark the work complete before raising a final invoice. Until then you
> can raise a deposit invoice.**

The guard is correct and its wording is good. **The trade never sees it.** Two
independent causes, both confirmed:

**B1.1 — the message has no digest.** `actionableError`
(`src/lib/actionable-error.ts:49-53`) exists precisely so a message survives
Next.js's production redaction, by stamping `digest = "MOTKO_ACTIONABLE;" + message`.
**`src/lib/invoice-amount.ts` uses bare `new Error(...)` at all six of its
guards** — lines 48, 52, 57, 59, 82, 88. None carries the digest, so all six
redact to the generic server-component message.
**PREVENT · Cost: S (six call sites).**

**B1.2 — the precondition has never been met by anyone.** The guard tests
`job.workCompletedAt` → `jobs.work_completed_at`. Production:

| | |
|---|---|
| Jobs | **63** |
| With `work_completed_at` set | **0** |
| Final invoices already **paid** | **10**, latest 28 Aug |

Ten final invoices were raised and paid before this guard existed. Since it
landed, no job has ever satisfied it. `mark-complete-button.tsx` exists and
`actions.ts:1632` writes the column, so the mechanism is there — but nothing in
production has ever used it, which means the button is either unreachable from
where trades actually are, or not recognised as a prerequisite.
**PREVENT · Cost: S–M · Depends on B1.1 (fix the message first, then watch
whether trades find the button).**

**B1.3 — the class, not the instance.** `actionableErrorMessage`
(`actionable-error.ts:72`) has **no consumers anywhere in `src/`**. Nothing reads
the digest back. So even a correctly-thrown `actionableError` currently surfaces
as a generic 500. This is the whole contractor-facing dead-end class — the
reconciler error, the Stripe button and this invoice all sit on it.
**PREVENT · Cost: M.**

**Sequence impact:** B1.1 is now the cheapest blocking fix in the plan and should
run first.

### B2 · The fixed price has three owners

**B2.0 · Line-item provenance — NEW, and it gates B2.2**

Rev 4 mentioned in passing that `46e3d510`'s £400 became a flag while the model
invented £1,256 of material lines. That is its own defect: **hallucinated charges
in a priced customer-facing document.** The fixed-mode collapse is currently
concealing it by deleting those lines. **B2.2 without B2.0 makes the product
worse**, because the invented charges would then reach the customer.

*Does a provenance marker exist?* Yes — `src/lib/schemas/job.ts:83-86`:
`source: z.enum(["transcript", "contractor", "system-generated"])`. It is
**optional**, and `:150` records that absent provenance means "unknown, not
unsourced".

*Is it populated?* **Conditionally, and the condition is backwards.**
`src/lib/compile-draft.ts:676`:

```js
const provenanceChecksEnabled = statedPrices.length > 0;
```

Provenance is attached only when price extraction found something. On `46e3d510`
`stated_prices` was **empty**, so no line got provenance and
`reconcileStatedPrice`'s "Unsourced line" check — which also requires
`stated_prices` to be non-empty — never ran.

**The invention guard switches itself off in exactly the case where the model is
most free to invent.** That is the item.

The remedy is to make provenance mandatory on every line at compile, independent
of extraction: a model-drafted estimate is `system-generated` whether or not
anything was extracted from the transcript, and the customer-facing document must
be able to distinguish a figure the contractor said from one the model produced.
**PREVENT · Cost: M · Gates B2.2.**

**B2.1 · One layer owns "what does this quote cost".**
Three consumers, three filters: `computeQuoteTotals` sums everything including
provisional; `reconcileStatedPrice` excludes provisional; `applyPricingMode`
deletes non-provisional. Collapse into one documented function.
**PREVENT · Cost: M · Gates B2.2–B2.4 and N3.**

**B2.2 · A fixed price must not silently delete priced work.**
`src/lib/pricing-mode.ts:89-96`.
**PREVENT · Cost: M · Depends on B2.0 and B2.1.**

**B2.3 · The reconciler error must offer a resolution.**
Confirmed live: Sentry `JAVASCRIPT-NEXTJS-A` records
*"you set £1800.00, but the priced lines come to £2200.00"* at 06:47 on 9 Sep,
`POST /jobs/[id]`. **This resolves rev 2's open question** — the contractor had
edited the quote to £2,200, was blocked at send, and the stored end state is one
line at £1,800. **The correction was made and then thrown away.**

`sendQuoteSchema` already carries `confirmZeroTotal`, `confirmNarrativeMismatch`
and `confirmOverCeiling`. Reconciliation is the only money guard without an
escape, and a bare confirm is the wrong shape — the resolution is a **choice**
between writing `sow_json.pricing.fixed_amount` and rescaling via
`applyAgreedFixedPrice`. Both exist; neither is reachable.
**PREVENT · Cost: S · Depends on B2.1.**

**B2.4 · Two fields named fixed-price with opposite semantics.**
`pricing.fixed_amount` deletes lines; `agreed_costs.fixed_price` scales them.
**PREVENT · Cost: M + migration · Depends on B2.1.**

### B3 · Sign-in unreachable on a fresh install

`src/app/login/page.tsx:171` is a bare `p-6`. `pt-safe` (`globals.css:515`) is
used in two files; login and signup use neither it nor `PageHeader`.

Fix both screens, then add a test asserting every top-level route renders inside
the inset system. **PREVENT · Cost: S · No dependency · Run early.**

### B4 · Contract signature block — **legal decision, see §3**

Engineering does not start until review returns.

### B5 · The app makes a false statement to customers — **NEW, split from B4**

`src/app/c/[id]/contract-response.tsx:28-41` renders two paragraphs on a signed
contract. The first is true:

> Contract signed by {name} on {date}.

The second is not:

> This contract is fully signed — it only needs one signature. There's nothing
> more to sign here.

The templates request a contractor signature (`templates.ts:121, 280, 443, 593,
733`) that the product cannot capture. The app is asserting completeness it
cannot support, to 15 customers who have signed.

**Deleting the second paragraph leaves a true statement under both Option A and
Option B**, and asserts nothing about signature status either way. It needs no
legal advice because it *removes* a claim rather than making one.

**PREVENT · Cost: S (one paragraph) · No dependency · Ship this week, ahead of
the legal decision.**

---

## §2 · Non-blocking

Unchanged from rev 4 except where noted.

- **N1 · Stripe fourth state.** `complete` gates on `stripe_pay_by_bank_enabled`
  alone. Production: `requirements_due: false`, `payouts_enabled: true`,
  `payout_details_complete: true`, `pay_by_bank_enabled: false` — onboarding *is*
  done. Add the submitted-awaiting-verification state; the data exists, no
  migration. **PREVENT · S · Independent.**
- **N2 · The voice gate** (N2.1 answered-means-asked; N2.2 close both wrap escape
  hatches; N2.3 add `pricing` to the required set; N2.4 reopen the P1·6
  `site_address` decision — **11 signed contracts without one is the evidence**;
  N2.5 confirm a captured name). **PREVENT · M.**
- **N3 · Quote edits do not propagate to the SoW.** The months-old defect.
  **PREVENT · M.**
- **N4 · Notifications.** N4.1 surface the `failures[]` reason the API already
  returns (`settings-client.tsx:135` discards it) — do first, it is the entire
  APNs diagnosis. N4.2 persist delivery status as P0·2 decided. N4.3 then
  diagnose. Also: make `business_email` required at setup, since it is the only
  reason notifications are not blocking. **Note:** Sentry shows the APNs signing
  error (`JAVASCRIPT-NEXTJS-9`, `DECODER routines::unsupported` at `Sign.sign`)
  last occurring 8 Sep on release `cb9e571` and **not** on `6f12cca` — consistent
  with the key fix having landed.
- **N5 · Contract channel banner.** Not hardcoded; the defect is in what the send
  passes as `channels`. **PREVENT · S.**
- **N6 · Business details.** No code change — `business_structure` is genuinely
  absent and the validator is right. Optional: auto-open the linked Disclosure.
  Separately, `COMPANIES_HOUSE_API_KEY` returns 401 — an environment fix.

---

## §3 · C-class — contractual, requires sign-off

**Corrected scope.** Rev 3 recorded "3 documents across 3 trades". Production says
the exposure is larger and overlapping:

| Item | Scope |
|---|---|
| rev 3 — liability wording | 3 documents, 3 trades |
| rev 3 — remediation question | as above |
| rev 3 — contractor-directed exposure | as above |
| **round 2 — contractor signature block** | **17 sent, 15 signed, 6 trades — every contract ever sent** |
| **round 2 — no site address on a signed contract** | **11 of 15 signed** |

`252d9951` and `46e3d510` each appear under three of these rows.

### The decision, with an owner and a route

**Option A — remove the contractor block.** Delete from five templates; state that
issuing constitutes the contractor's acceptance. *Engineering: S.*
**Legal question:** does an unsigned issued document bind the contractor, and does
removing a signature line that 15 signed contracts already carry change their
status?

**Option B — build contractor signing.** Signing step, `contractor_signed_at`
column, template variables, partial-vs-full status model. *Engineering: L +
migration.* **Legal question:** must this precede reliance on the 15 signed
contracts, and do they need re-issuing?

| | |
|---|---|
| **Owner** | Jacob — this is a business decision with a legal input, not a delegable engineering one |
| **Route** | **If the templates came from a provider, their support is the first and cheaper call** — a provider whose templates ship a contractor signature line will have a stated position on it. **Otherwise, a fixed-fee review from a UK commercial solicitor**, which for five templates plus two questions is a contained scope |
| **Which applies** | Jacob to confirm the templates' origin; `src/lib/contracts/templates.ts` carries no provenance note either way |
| **Date** | Initiate within 7 days. It has the longest lead time on the plan and gates B4 entirely |

**B5 is deliberately outside this gate** — removing a false claim needs no advice.

---

## §4 · Re-test protocol

Rev 3's protocol is not in the repository — not in `areas/motko.md`, `docs/`, or
`AGENTS.md`. **I could not find it to update, so this is reconstructed rather than
revised.** If a written copy exists elsewhere, reconcile against it.

### What currently has no test evidence at all

Round 2 ended at invoice send, so everything downstream is untested since round 1.
Production confirms it is worse than untested — parts have **never run**:

| Step | Evidence | Status |
|---|---|---|
| Voice intake → quote | 17 accepted quotes | Exercised |
| Quote send | 17 | Exercised |
| Contract send + sign | 17 sent, 15 signed | Exercised |
| Deposit invoice | 7 raised, 5 paid | Exercised |
| **Mark work complete** | **0 of 63 jobs** | **Never run** |
| **Final invoice since the completion guard** | 10 paid, all before 28 Aug | **Never run under current rules** |
| **Payment recording / mark-as-paid** | 15 invoices carry `paid_at` | Exercised historically, **not since round 1 fixes** |
| **P0·3 paid-date rule** | Shipped 8 Sep | **Never verified against a real journey** |
| Job completion → settlement | — | **Never run** |

### The protocol

One full journey per re-test round, in order, on a real device, recording pass or
fail at each step. **A round is not complete until every step has a recorded
outcome** — round 2's "no further action could be tested" is the failure this
protocol exists to prevent, and it must be recorded as a blocked step with its
blocker named, not as an untested one.

1. Fresh install → sign in *(B3)*
2. Voice intake, deliberately deflecting one required slot *(N2)*
3. Confirm the captured customer name spelling *(N2.5)*
4. Quote review — check every line has provenance and no line is unattributed *(B2.0)*
5. Fixed price stated as components — check nothing is silently dropped *(B2, B2.2)*
6. Send; if the reconciler fires, check a resolution is offered *(B2.3)*
7. Accept as customer → check the trade is notified on **both** channels *(N4)*
8. Contract send — check the banner names the channels truthfully *(N5)*
9. Sign as customer — check no false completeness claim *(B5)*
10. **Mark the work complete** — the step that has never run *(B1.2)*
11. **Raise a final invoice** — check the guard message is readable if it fires *(B1.1)*
12. Pay → **check `paid_at` against a London calendar date** *(P0·3, never verified)*
13. Settlement / fee collection
14. Stripe onboarding state shown correctly throughout *(N1)*

Steps 10–13 are the ones with no evidence. **They should be walked once before
launch even if no code changes**, because the guard at step 11 has never been
satisfied by anyone.

---

## §5 · Making the rule mechanical

Rev 4's §5 said that if nothing made the `AGENTS.md` rule checkable, expect a rev
5. Nothing did, and this is rev 5. Two cheap changes close it.

### 5.1 · The label goes in the decision template

`AGENTS.md:954-959` already defines the decision record. Add one line:

```
## 2026-08-21 — <the question, one line>
Decision: <what you chose>
Rationale: <why, two lines maximum>
Ticket: #NNN
Effect: PREVENT | REPORT | REMEDIATE      ← new
Reversible: yes
Precedent: yes/no
```

Recorded **at close**, not asserted afterwards. This also supplies the rev 3
baseline rev 4's check 1 lacked: the four instances in the pattern table are
`REPORT` closures on defects that needed `PREVENT`, and that ratio is what a later
plan compares against.

### 5.2 · A PREVENT claim must name a failing test

Every item labelled PREVENT names the test that **fails without the fix and
passes with it**. A PREVENT claim with no failing test is a REPORT item wearing a
label — which is precisely how P0·2, P1·6 and P2·13 closed.

This is not new process: `AGENTS.md` already requires acceptance tests to fail
first, for the same reason. Extending it to the plan's own items makes the
distinction checkable rather than asserted.

**Both changes are documentation-only. Cost: S. No dependency.**

---

## §6 · Proposed sequence

| Order | Item | Why here |
|---|---|---|
| 1 | §0 review the two quotes | Minutes. Both live, both accepted, both signed |
| 2 | **B1.1** digest on the six invoice guards | S. Cheapest blocking fix; root cause known |
| 3 | **B5** delete the false paragraph | S. The product is making an untrue statement now |
| 4 | **B3** safe-area on login + signup | S. Blocking, trivial |
| 5 | **§3** initiate legal review | Longest lead time; gates B4 |
| 6 | **N4.1** surface the push reason | S. Unblocks the APNs diagnosis |
| 7 | **B2.0** mandatory provenance | M. Gates B2.2 |
| 8 | **B2.1** one owner for quote cost | M. Gates B2.2–B2.4, N3 |
| 9 | **B1.2** make completion reachable | Follows B1.1 |
| 10 | **B2.2, B2.3** | The rest of the pricing defect |
| 11 | **N2.1–N2.3** voice gate | Upstream of pricing capture |
| 12 | **N3** quote → SoW | Closes the months-old defect |
| 13 | **§5** template + failing-test rule | Documentation-only; any time |
| 14 | **§4** full journey walk | After 2–12; steps 10–13 have never run |
| 15 | **N1**, **N5**, **N6**, remainder | Independent throughout |

Items 3, 4, 6, 13 and N1 are independent of the B2 chain and can run in parallel.

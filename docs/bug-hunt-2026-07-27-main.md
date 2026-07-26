# Bug hunt — re-run against canonical `main`

**Auditing `main` @ `4fc2b78`** (repo `jacobabuckland/motkoquote`, branch `main`,
the tree Vercel deploys to motko.app). Read-only pass; evidence-required;
severity-ranked. **No remediation performed in this session.**

This supersedes `docs/bug-hunt-2026-07-26.md`, which audited the **non-canonical
Stripe tree** and is retained only for bug-class reference. Production runs the
TrueLayer/open-banking rails, which were **never audited before this pass** — so
the money surface below (`api/truelayer/*`, `collect-fees`, `truelayer-vrp`,
`settle-paid-job`, fee mandate flow) is all first-look, not carried over.

## Headline counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 4 |
| Medium | 9 |
| Low | 6 |

Two findings that entered this pass as *candidate criticals* were **downgraded on
verification** (see "Verified sound"): the webhook is forgery-resistant (JWS/JWKS,
no shared secret) and the pay-in amount is server-pinned at payment creation, so
full-invoice settlement is correct by construction. Naming them here so the zero
is understood, not assumed.

---

## HIGH

### H1 — Fee double-charge when the monthly collection cron re-runs before the webhook settles
- **Files:** `src/lib/collect-fees.ts:172-241` (`runFeeCollectionBatch`), `:328-333` (jobs leave `accrued` only on settle)
- **Evidence:** the batch selects every job with `fee_status = 'accrued'`, rolls them into a **new** `fee_collections` row (`insert … status:'pending'`), and immediately charges the mandate via `chargeMandate` with `idempotencyKey: \`${collection.id}:${attempt}\``. A job only leaves `accrued` inside `settleFeeCollection`, which runs on the *later* `payment_executed` webhook (`:328-333`). There is **no unique constraint** on `fee_collections(contractor_id, period_start)` (checked all migrations — the only fee-adjacent unique is `credit_events_job_consumed_key`, unrelated).
- **Scenario:** the collect-fees cron double-fires (Vercel Cron is at-least-once; also any manual re-invoke, or a second run overlapping before the webhook lands). The same still-`accrued` jobs are rolled into a *second* collection with a *different* `collection.id` → *different* idempotency key → TrueLayer does not dedupe → the trade's mandate is charged **twice** for the same jobs.
- **Amplifier:** combined with **H2** (cron fail-open), if `CRON_SECRET` is unset this endpoint is publicly invokable, so a remote caller can hammer it to re-charge every trade up to the cVRP caps.
- **Confidence:** High (code path). Frequency depends on cron delivery/`CRON_SECRET`.

### H2 — All five crons fail open when `CRON_SECRET` is unset (#13 SURVIVES)
- **Files:** `src/app/api/cron/{collect-fees,retry-fee-collections,chase,purge-accounts,reconcile-free-jobs}/route.ts`
- **Evidence:** every guard is `const secret = process.env.CRON_SECRET; if (secret && …) return 401`. When `secret` is falsy the check is skipped entirely — e.g. `chase/route.ts:32-35`, `collect-fees/route.ts:10-12`.
- **Scenario:** if `CRON_SECRET` is not set in Vercel prod, all five are unauthenticated public endpoints: `collect-fees`/`retry-fee-collections` move real money (H1), `purge-accounts` deletes user data, `chase` sends customer emails/SMS.
- **Immediate action to confirm outside this read-only pass:** verify `CRON_SECRET` is set in the Vercel prod environment. If it is, live impact is contained to accidental double-fires; if not, this is remotely exploitable.
- **Confidence:** High (code). Impact contingent on the env var.

### H3 — Cross-tenant IDOR on the SOW PDF (#1 SURVIVES; relocated to `/api/jobs/[id]/sow-pdf`)
- **File:** `src/app/api/jobs/[id]/sow-pdf/route.ts:26-34`
- **Evidence:** `createAdminClient()` (service-role, bypasses RLS) selects the job by `.eq("id", id)` from the URL with **no `auth.getUser()` and no ownership check**. `/api/jobs/` is **not** in the middleware public allowlist (`middleware.ts:30-46`), so an unauthenticated caller is redirected to `/login` — but any **authenticated** trade satisfies the middleware and can then fetch **any** job's SOW, exposing that job's customer PII (name, email, phone, site address) and the other trade's company details.
- **Confidence:** High.

### H4 — A declined contract can still be signed, raising a deposit invoice from an invalid state
- **File:** `src/app/c/[id]/actions.ts:41,48,58-68`
- **Evidence:** the only guard is `if (status === "signed") return;` (`:41`) plus `.neq("status","signed")` (`:48`). A contract in state `declined` passes both, flips to `signed`, and — if `deposit_pct` is set — raises a **deposit invoice** (`:58-68`) and fires the contractor notification. The `/c/[id]` link is a public capability URL, so anyone holding it can drive `declined → signed`.
- **Note:** the deposit amount itself is correctly server-derived (`Math.round(quote.total * (depositPct/100) * 100)/100`, `:59`) — the defect is the state machine accepting a terminal-declined contract, not the amount.
- **Confidence:** High.

---

## MEDIUM

### M1 — Webhook not idempotent across provider retries (candidate-C1, downgraded)
- **Files:** `src/app/api/truelayer/webhook/route.ts:14-20` (`event_id` typed but never read), `src/lib/collect-fees.ts:345-368` (`failFeeCollection`)
- **Evidence:** `event_id` is in the payload type but never used for dedup. The `payment_executed` settlement paths (`settlePaidJob`, `settleFeeCollection`) are idempotent via atomic status guards, so a redelivered success is a safe no-op. But `failFeeCollection` only bails on `status === 'collected'` (`:357`) — a redelivered `payment_failed` for an already-`failed` collection re-runs `markCollectionFailed`, re-writing `past_due` and **re-sending the "payment didn't go through" email**. TrueLayer legitimately retries webhooks.
- **Impact:** duplicate dunning notifications / redundant `past_due` writes on provider retry. No money is moved twice (signature prevents forgery; settlement guards hold). Hence Medium, not Critical.
- **Confidence:** High.

### M2 — Email HTML injection via unescaped interpolation (#3 SURVIVES)
- **File:** `src/lib/email.ts:35-36, 78-79, 121-122, 168-170, 244-246`
- **Evidence:** template literals inject `${input.customerName}` / `${input.companyName}` / `${input.heading}` raw into the email HTML with no escaping. `customerName` is customer-supplied (captured on the call); `sendContractorNotificationEmail` composes it into `heading`/`subject` and delivers to the **contractor's** inbox — so a malicious customer name injects markup (e.g. a phishing `<a>`) into the trade's email.
- **Impact:** HTML/content injection in email (no JS execution — mail clients sandbox), phishing-link injection. Medium.
- **Confidence:** High.

### M3 — Overdue math uses UTC, not Europe/London (#17 SURVIVES)
- **Evidence:** `due_date` comparisons run on UTC day boundaries rather than London local time; around midnight/DST an invoice is treated as overdue up to a day early/late, shifting chase timing.
- **Confidence:** Medium.

### M4 — Account purge is not atomic (#12 SURVIVES)
- **File:** `src/app/api/cron/purge-accounts/route.ts`
- **Evidence:** the purge performs a multi-step delete/anonymise sequence with no surrounding transaction; a mid-sequence failure leaves a partially purged account.
- **Confidence:** Medium.

### M5 — `ON DELETE CASCADE` destroys financial records instead of anonymising (#16 SURVIVES)
- **Evidence:** deleting a quote/job cascades to `invoices`/`contracts` (e.g. `migrations/…011_contracts.sql:3` `on delete cascade`), erasing issued financial documents that the deletion-email copy promises to *retain in anonymised form* for tax/legal record-keeping. Contradiction between stated policy (`email.ts:208-209`) and schema behaviour.
- **Confidence:** Medium.

### M6 — `free_jobs_remaining` read-modify-write is a lost-update race
- **File:** `src/lib/settle-paid-job.ts:149-166`
- **Evidence:** the free-jobs allowance is decremented by reading the current value and writing back a computed value, rather than an atomic decrement/ledger-driven update. Two concurrent settlements for the same trade can both read the same starting value and both write the same decrement, over-granting the allowance. (The `credit_events` referral-unlock append *is* exactly-once and proven by the race test; this RMW is the residual soft spot.)
- **Confidence:** Medium.

### M7 — Chase double-send under overlapping cron runs (#9 SURVIVES)
- **File:** `src/app/api/cron/chase/route.ts:88-133`
- **Evidence:** per-channel dedup reads `invoice.chase_events` in memory (`alreadySent`, `:91-92`) and inserts the marker only *after* a successful send (`:112-116, :127-131`). There is no unique constraint on `chase_events(invoice_id, channel, template_used)`, so two overlapping runs both observe "not yet sent" and both send the same wave.
- **Confidence:** Medium (requires overlapping runs).

### M8 — Archived jobs keep getting chased (#7 SURVIVES)
- **File:** `src/app/api/cron/chase/route.ts:41-47`
- **Evidence:** the chase query filters only on `invoice.status = 'sent'` and `due_date not null`; nothing excludes invoices whose parent job/quote has been archived. An archived-but-unpaid `sent` invoice keeps generating reminders.
- **Confidence:** Medium.

### M9 — `create-payment` is unauthenticated and overwrites `truelayer_payment_id` every call
- **File:** `src/app/api/truelayer/create-payment/route.ts:54-60, 69, 104-107`
- **Evidence:** no `auth.getUser()`; the admin client is keyed only by the invoice UUID (the intended customer capability), rejects only `status === 'paid'` (`:69`, not `draft`), and rewrites `truelayer_payment_id` on every call (`:104-107`), discarding the prior provider reference. The beneficiary is correctly server-derived, so this is not fund-redirection — but repeated calls churn the stored payment id and a non-`sent` (e.g. draft) invoice can spawn a payment.
- **Confidence:** Medium.

---

## LOW

- **L1 — providerRef fallback writes the collection id as a payment ref.** `webhook/route.ts:66` `providerRef: event.payment_id ?? feeCollectionId` — if `payment_id` is absent on a fee `payment_executed`, the collection's own id is stored as `provider_collection_ref`, corrupting the audit trail. Low.
- **L2 — Twilio inbound STOP handling clobbers JSON contact fields (#11 SURVIVES).** `src/app/api/twilio/inbound/route.ts` is **byte-identical** to the already-audited stale tree, so the 2026-07-26 verdict transfers verbatim. Low.
- **L3 — Residual mic teardown on the voice client (#15 CHANGED — mostly fixed).** Largely remediated on `main`; a minor teardown-ordering residual remains. Low.
- **L4 — N+1 / missing indexes on dashboard and chase queries (#19 SURVIVES).** Low (perf).
- **L5 — Serial + unbounded dashboard queries.** Several dashboard loads run queries serially and without row limits. Low (perf).
- **L6 — Unhandled rejections in the voice client.** `JSON.parse` on datachannel messages and `dc.send` after close can reject unhandled. Low.

---

## Re-verification of transferable findings (from 2026-07-26)

| # | Finding | Verdict on `main` @ 4fc2b78 |
|---|---|---|
| 1 | SOW PDF IDOR | **SURVIVES** — now `/api/jobs/[id]/sow-pdf`, admin client, no owner check (H3) |
| 2 | Client invoice amount unclamped | **SURVIVES** — dashboard `createInvoice` still trusts the contractor-supplied amount; low security impact (contractor owns the job), but no clamp to quote total |
| 3 | Email HTML injection | **SURVIVES** — `email.ts` raw interpolation (M2) |
| 7 | Archived quote keeps chasing | **SURVIVES** — chase query filters only `status='sent'` (M8) |
| 8 | Webhook returns 200 before settle safely | **CHANGED (mitigated)** — settlement now idempotent via atomic guards; redelivery is a safe no-op |
| 9 | Chase double-send race | **SURVIVES** — read-then-insert, no unique constraint (M7) |
| 11 | Twilio STOP JSON clobber | **SURVIVES** — file byte-identical to audited tree (L2) |
| 12 | Purge non-atomic | **SURVIVES** (M4) |
| 13 | Cron fail-open | **SURVIVES** — all five `if (secret && …)` (H2) |
| 15 | Mic teardown | **CHANGED (mostly fixed)** (L3) |
| 16 | CASCADE destroys financial records | **SURVIVES** (M5) |
| 17 | due_date UTC not London | **SURVIVES** (M3) |
| 19 | Missing indexes / N+1 | **SURVIVES** (L4) |

---

## Verified sound (new money surface — first audit)

- **Webhook authenticity.** `truelayer/webhook/route.ts:36-44` verifies every delivery against TrueLayer's JWKS over method/path/body + `X-TL-Webhook-Timestamp`; no shared secret, forgery-resistant. (This is why the "unsigned replay" threat is not Critical.)
- **Pay-in amount is server-pinned.** `create-payment/route.ts:86` sets the payment amount to `Math.round(invoice.amount * 100)` at creation; the customer authorises exactly that in their bank, so the webhook settling the full invoice is correct by construction — no per-event amount re-check is needed. (This is why "no amount verification in the webhook" is not a bug.)
- **Two-layer settlement idempotency.** `settle-paid-job.ts:65-80` per-invoice `.neq("status","paid")` flip + `:87-93` per-job `.is("paid_at", null)` flip — both single-statement conditional UPDATEs, atomic under Postgres. Proven by the both-orders race test.
- **Fee settlement guards.** `collect-fees.ts:319` `.neq("status","collected")`; `:357` `failFeeCollection` bails on `collected`.
- **Server-derived beneficiary** from contractor payout details (`create-payment`), not client input.
- **Fee amounts** computed server-side in pennies; **cVRP caps** enforced in `truelayer-vrp.ts`.
- **Deposit amount** on contract sign is server-derived (`c/[id]/actions.ts:59`).
- **Contract page** renders via auto-escaped React JSX — no markdown/HTML-injection surface (`c/[id]/page.tsx`).
- **Twilio signature validation** is constant-time; **push subscribe** requires `auth.getUser()`; **backdated `paid_at`** validated in `mark-paid-date.ts`.

## Byte-identical carryover (diff-check: stale `~/motkoquote` vs `main`)

Per the constraint "carry over verified-sound items only where the file is
byte-identical between the audited stale tree and main," the following files are
**IDENTICAL** and their prior sound verdicts transfer verbatim:

- `src/lib/twilio.ts` (Twilio signature validation)
- `src/app/api/twilio/inbound/route.ts` (Twilio inbound; also L2's SURVIVES verdict transfers)
- `src/app/c/[id]/page.tsx` (contract page JSX escaping)
- `src/app/api/push/subscribe/route.ts` (push subscribe auth)
- `src/lib/notify-contractor.ts`

**Not carried over** (DIFFERS or ABSENT in the stale tree — audited fresh this
pass): the entire money surface — `truelayer/webhook`, `truelayer/create-payment`,
`settle-paid-job`, `collect-fees`, `truelayer-vrp`, `truelayer`, `mark-paid-date`,
`invoicing` — plus `c/[id]/actions.ts`, `supabase/middleware.ts`, `q/[id]/page.tsx`.
None of these exist (or match) in the Stripe-line stale tree, confirming the money
surface had never been audited before now.
